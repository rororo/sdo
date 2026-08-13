import {
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type View, VIEW_PATHS, viewFromPathname } from './routing.ts';

const PAGE_SIZE = 50;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface ShoeProductRecord {
  department: string;
  departmentName: string;
  category: string;
  categoryName: string;
  item: string;
  itemName: string;
  internalCode: string;
  brand: string;
  ean: string;
  manufacturerModel: string;
  commercialName: string;
  size: string;
  sizeSystem: string;
}

interface ShoeDataResponse {
  records: ShoeProductRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  metadata: {
    lastModified: string | null;
    loadedAt: string;
  };
}

const SHOE_FIELDS = [
  ['department', '部門'],
  ['departmentName', '部門名'],
  ['category', '品種'],
  ['categoryName', '品種名'],
  ['item', '品目'],
  ['itemName', '品目名'],
  ['internalCode', '自社品番'],
  ['brand', 'ブランド'],
  ['ean', 'スキャンコード(JAN)'],
  ['manufacturerModel', 'メーカー品番'],
  ['commercialName', '商品名(EN)'],
  ['size', 'Size'],
  ['sizeSystem', 'SizeSys'],
] as const satisfies readonly [keyof ShoeProductRecord, string][];

type AuthState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; username: string };

type RequestStatus =
  | { kind: 'idle'; message: '' }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

interface PickupStats {
  inputRows: number;
  matchedRows: number;
  outputRows: number;
}

interface PickupConfirmation {
  filename: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  stats: PickupStats;
  workbookBase64: string;
}

function apiUrl(path: string): string {
  return new URL(path.startsWith('/') ? path : `/${path}`, globalThis.location.origin).toString();
}

function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const matched = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  return matched?.[1] ? decodeURIComponent(matched[1]) : fallback;
}

function formatDate(value: string | null): string {
  if (!value) return '取得できません';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function BrandMark({ login = false }: { login?: boolean }) {
  return (
    <div className={`brand-mark${login ? ' login-mark' : ''}`} aria-hidden='true'>
      <svg viewBox='0 0 32 32'>
        <path d='M6 22c4-1 6-5 8-11l4 7c2 2 5 3 8 3v5H6z' />
        <path d='M8 26h18M15 15l4-2M18 19l4-2' />
      </svg>
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>(() =>
    viewFromPathname(globalThis.location.pathname) ?? 'products'
  );
  const [data, setData] = useState<ShoeDataResponse | null>(null);
  const [dataStatus, setDataStatus] = useState<RequestStatus>({
    kind: 'idle',
    message: '',
  });
  const [downloadStatus, setDownloadStatus] = useState<RequestStatus>({
    kind: 'idle',
    message: '',
  });
  const [pickupFile, setPickupFile] = useState<File | null>(null);
  const [pickupStatus, setPickupStatus] = useState<RequestStatus>({
    kind: 'idle',
    message: '',
  });
  const [pickupConfirmation, setPickupConfirmation] = useState<PickupConfirmation | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepth = useRef(0);

  const navigateToView = useCallback((nextView: View) => {
    const nextPath = VIEW_PATHS[nextView];
    if (globalThis.location.pathname !== nextPath) {
      globalThis.history.pushState(null, '', nextPath);
    }
    setView(nextView);
  }, []);

  const switchView = (event: ReactMouseEvent<HTMLAnchorElement>, nextView: View) => {
    if (
      event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
      event.shiftKey || event.altKey
    ) return;

    event.preventDefault();
    navigateToView(nextView);
  };

  useEffect(() => {
    const syncViewWithUrl = () => {
      const nextView = viewFromPathname(globalThis.location.pathname);
      if (!nextView) {
        globalThis.history.replaceState(null, '', VIEW_PATHS.products);
        setView('products');
        return;
      }

      const canonicalPath = VIEW_PATHS[nextView];
      if (globalThis.location.pathname !== canonicalPath) {
        globalThis.history.replaceState(null, '', canonicalPath);
      }
      setView(nextView);
    };

    syncViewWithUrl();
    globalThis.addEventListener('popstate', syncViewWithUrl);
    return () => globalThis.removeEventListener('popstate', syncViewWithUrl);
  }, []);

  useEffect(() => {
    fetch(apiUrl('api/auth/session'))
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return await response.json() as { username: string };
      })
      .then((session) => setAuth({ kind: 'authenticated', username: session.username }))
      .catch(() => setAuth({ kind: 'anonymous' }));
  }, []);

  const loadData = useCallback(async (requestedPage: number) => {
    setDataStatus({
      kind: 'loading',
      message: '商品データを読み込んでいます…',
    });
    try {
      const query = new URLSearchParams({
        page: String(requestedPage),
        pageSize: String(PAGE_SIZE),
      });
      const response = await fetch(apiUrl(`api/shoes?${query}`));
      if (response.status === 401) {
        setAuth({ kind: 'anonymous' });
        throw new Error('セッションの有効期限が切れました。もう一度ログインしてください。');
      }
      const body = await response.json() as ShoeDataResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? '商品データを取得できませんでした。');
      setData(body);
      setPage(body.page);
      setDataStatus({ kind: 'success', message: '' });
    } catch (error) {
      setDataStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '商品データを取得できませんでした。',
      });
    }
  }, []);

  useEffect(() => {
    if (auth.kind !== 'authenticated' || view !== 'products') return;
    void loadData(page);
    const timer = globalThis.setInterval(() => void loadData(page), 60 * 60 * 1000);
    return () => globalThis.clearInterval(timer);
  }, [auth.kind, loadData, page, view]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      const response = await fetch(apiUrl('api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json() as { error?: string; username?: string };
      if (!response.ok || !body.username) {
        throw new Error(body.error ?? 'ログインに失敗しました。');
      }
      setPassword('');
      setPage(1);
      setAuth({ kind: 'authenticated', username: body.username });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'ログインに失敗しました。');
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    await fetch(apiUrl('api/auth/logout'), { method: 'POST' }).catch(() => undefined);
    setData(null);
    setPage(1);
    setDownloadStatus({ kind: 'idle', message: '' });
    setPickupFile(null);
    setPickupStatus({ kind: 'idle', message: '' });
    setPickupConfirmation(null);
    setAuth({ kind: 'anonymous' });
  };

  const downloadExcel = async () => {
    if (downloadStatus.kind === 'loading') return;
    setDownloadStatus({ kind: 'loading', message: 'Excelを生成しています…' });
    try {
      const response = await fetch(apiUrl('api/shoes.xlsx'));
      if (response.status === 401) {
        setAuth({ kind: 'anonymous' });
        throw new Error('セッションの有効期限が切れました。もう一度ログインしてください。');
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Excelを生成できませんでした。');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = responseFilename(response, 'shoe_master.xlsx');
      anchor.click();
      URL.revokeObjectURL(url);
      const count = Number(response.headers.get('X-Processed-Rows') ?? data?.total ?? 0);
      setDownloadStatus({
        kind: 'success',
        message: `${count.toLocaleString('ja-JP')}件のExcelをダウンロードしました。`,
      });
    } catch (error) {
      setDownloadStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Excelを生成できませんでした。',
      });
    }
  };

  const updatePickupFile = (file: File | null) => {
    if (pickupStatus.kind === 'loading') return;
    setPickupConfirmation(null);
    if (!file) {
      setPickupFile(null);
      setPickupStatus({ kind: 'idle', message: '' });
      return;
    }
    if (file.size === 0) {
      setPickupFile(null);
      setPickupStatus({ kind: 'error', message: '空のファイルはアップロードできません。' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setPickupFile(null);
      setPickupStatus({
        kind: 'error',
        message: 'アップロードできるExcelファイルは20MBまでです。',
      });
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setPickupFile(null);
      setPickupStatus({ kind: 'error', message: 'Excel（.xlsx）ファイルを選択してください。' });
      return;
    }
    setPickupFile(file);
    setPickupStatus({ kind: 'success', message: `${file.name} を選択しました。` });
  };

  const selectPickupFile = (event: ChangeEvent<HTMLInputElement>) => {
    updatePickupFile(event.target.files?.[0] ?? null);
    event.target.value = '';
  };

  const hasDraggedFiles = (event: ReactDragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes('Files');

  const beginFileDrag = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDraggingFile(true);
  };

  const continueFileDrag = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const endFileDrag = (event: ReactDragEvent<HTMLElement>) => {
    if (!isDraggingFile) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggingFile(false);
  };

  const dropPickupFile = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event) && event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    dragDepth.current = 0;
    setIsDraggingFile(false);
    navigateToView('pickup');

    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      setPickupFile(null);
      setPickupConfirmation(null);
      setPickupStatus({ kind: 'error', message: 'Excelファイルを1件だけドロップしてください。' });
      return;
    }
    updatePickupFile(files[0] ?? null);
  };

  const confirmPickupUpload = async () => {
    if (!pickupFile || pickupStatus.kind === 'loading') return;
    setPickupStatus({ kind: 'loading', message: 'アップロードしたファイルを確認しています…' });
    setPickupConfirmation(null);
    try {
      const form = new FormData();
      form.set('file', pickupFile);
      const response = await fetch(apiUrl('api/pickup-list'), {
        method: 'POST',
        body: form,
      });
      if (response.status === 401) {
        setAuth({ kind: 'anonymous' });
        throw new Error('セッションの有効期限が切れました。もう一度ログインしてください。');
      }
      const body = await response.json() as PickupConfirmation & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'ピックアップリストを生成できませんでした。');
      if (
        !body.filename || !body.workbookBase64 || !Array.isArray(body.headers) ||
        body.headers.length !== 18 || !Array.isArray(body.rows) || !body.stats ||
        body.rows.some((row) => row.length !== body.headers.length)
      ) {
        throw new Error('出力フォーマットを表示できませんでした。');
      }
      setPickupConfirmation(body);
      setPickupStatus({
        kind: 'success',
        message: `${pickupFile.name} のアップロードを確定しました。`,
      });
    } catch (error) {
      setPickupStatus({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : 'ピックアップリストを生成できませんでした。',
      });
    }
  };

  const downloadPickupExcel = () => {
    if (!pickupConfirmation) return;
    try {
      const binary = atob(pickupConfirmation.workbookBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: EXCEL_CONTENT_TYPE }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = pickupConfirmation.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setPickupStatus({
        kind: 'success',
        message: `${
          pickupConfirmation.stats.outputRows.toLocaleString('ja-JP')
        }件のExcelをダウンロードしました。`,
      });
    } catch (error) {
      setPickupStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Excelをダウンロードできませんでした。',
      });
    }
  };

  if (auth.kind === 'loading') {
    return (
      <main className='auth-shell'>
        <p className='auth-loading'>読み込んでいます…</p>
      </main>
    );
  }

  if (auth.kind === 'anonymous') {
    return (
      <main className='auth-shell'>
        <section className='login-card' aria-labelledby='login-title'>
          <BrandMark login />
          <p className='eyebrow'>SHOE DATA HUB</p>
          <h1 id='login-title'>ログイン</h1>
          <p className='login-lead'>シューズ商品データを閲覧するにはログインしてください。</p>
          <form className='login-form' onSubmit={login}>
            <label>
              <span>ユーザー名</span>
              <input
                name='username'
                autoComplete='username'
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              <span>パスワード</span>
              <input
                name='password'
                type='password'
                autoComplete='current-password'
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className='primary-button' type='submit' disabled={loggingIn}>
              {loggingIn ? '確認しています…' : 'ログイン'}
            </button>
            <p className='message error' role='alert'>{loginError}</p>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main
      className='sheet-app'
      onDragEnter={beginFileDrag}
      onDragOver={continueFileDrag}
      onDragLeave={endFileDrag}
      onDrop={dropPickupFile}
    >
      {isDraggingFile && (
        <div className='file-drop-overlay' role='status' aria-live='polite'>
          <div>
            <span className='file-drop-icon' aria-hidden='true'>↓</span>
            <strong>Excelファイルをドロップ</strong>
          </div>
        </div>
      )}
      <header className='sheet-toolbar'>
        <div className='sheet-heading'>
          <div className='sheet-title'>
            <BrandMark />
            <h1>{view === 'products' ? '商品一覧' : 'ピックアップリスト作成'}</h1>
          </div>
          <nav className='view-switcher' aria-label='機能選択'>
            <a
              href={VIEW_PATHS.products}
              className={view === 'products' ? 'active' : ''}
              aria-current={view === 'products' ? 'page' : undefined}
              onClick={(event) => switchView(event, 'products')}
            >
              商品一覧
            </a>
            <a
              href={VIEW_PATHS.pickup}
              className={view === 'pickup' ? 'active' : ''}
              aria-current={view === 'pickup' ? 'page' : undefined}
              onClick={(event) => switchView(event, 'pickup')}
            >
              ピックアップリスト
            </a>
          </nav>
        </div>
        <div className='toolbar-actions'>
          {view === 'products' && (
            <button
              className='download-button'
              type='button'
              onClick={downloadExcel}
              disabled={!data || downloadStatus.kind === 'loading'}
            >
              <span aria-hidden='true'>↓</span>
              {downloadStatus.kind === 'loading' ? 'Excel生成中…' : 'Excelをダウンロード'}
            </button>
          )}
          {view === 'pickup' && (
            <button
              className='download-button'
              type='button'
              onClick={downloadPickupExcel}
              disabled={!pickupConfirmation || pickupStatus.kind === 'loading'}
            >
              <span aria-hidden='true'>↓</span>
              Excelをダウンロード
            </button>
          )}
          <span className='account-name'>{auth.username}</span>
          <button className='logout-button' type='button' onClick={logout}>ログアウト</button>
        </div>
      </header>

      {view === 'products' && (
        <>
          <section className='sheet-body' aria-label='商品一覧'>
            {!data && dataStatus.kind === 'error' && (
              <div className='empty-state'>
                <strong>商品データを表示できません</strong>
                <p>{dataStatus.message}</p>
                <button
                  className='secondary-button'
                  type='button'
                  onClick={() => void loadData(1)}
                >
                  再試行
                </button>
              </div>
            )}

            {!data && dataStatus.kind !== 'error' && (
              <div className='loading-table' aria-label='商品データを読み込み中'>
                <span />
                <span />
                <span />
              </div>
            )}

            {data && (
              <div className='table-scroll' aria-busy={dataStatus.kind === 'loading'}>
                <table>
                  <thead>
                    <tr>
                      {SHOE_FIELDS.map(([, label]) => <th key={label}>{label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((record, index) => (
                      <tr key={`${record.internalCode}-${record.ean}-${index}`}>
                        {SHOE_FIELDS.map(([key]) => <td key={key}>{record[key] || '—'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <footer className='sheet-footer'>
            <div className='sheet-meta'>
              <span>
                <strong>{data ? data.total.toLocaleString('ja-JP') : '—'}</strong>件
              </span>
              <span>更新 {formatDate(data?.metadata.lastModified ?? null)}</span>
              {(dataStatus.message || downloadStatus.message) && (
                <span
                  className={`footer-message ${
                    dataStatus.kind === 'error' || downloadStatus.kind === 'error' ? 'error' : ''
                  }`}
                  role='status'
                  aria-live='polite'
                >
                  {downloadStatus.message || dataStatus.message}
                </span>
              )}
            </div>

            {data && (
              <div className='pagination'>
                <span>
                  {((data.page - 1) * data.pageSize + 1).toLocaleString('ja-JP')}–
                  {Math.min(data.page * data.pageSize, data.total).toLocaleString('ja-JP')}
                </span>
                <button
                  type='button'
                  onClick={() => setPage(1)}
                  disabled={data.page <= 1 || dataStatus.kind === 'loading'}
                  aria-label='最初のページ'
                >
                  «
                </button>
                <button
                  type='button'
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={data.page <= 1 || dataStatus.kind === 'loading'}
                  aria-label='前のページ'
                >
                  ‹
                </button>
                <span>
                  {data.page.toLocaleString('ja-JP')} / {data.pageCount.toLocaleString('ja-JP')}
                </span>
                <button
                  type='button'
                  onClick={() => setPage((current) => Math.min(data.pageCount, current + 1))}
                  disabled={data.page >= data.pageCount || dataStatus.kind === 'loading'}
                  aria-label='次のページ'
                >
                  ›
                </button>
                <button
                  type='button'
                  onClick={() => setPage(data.pageCount)}
                  disabled={data.page >= data.pageCount || dataStatus.kind === 'loading'}
                  aria-label='最後のページ'
                >
                  »
                </button>
              </div>
            )}
          </footer>
        </>
      )}

      {view === 'pickup' && (
        <>
          <section
            className={`sheet-body pickup-body${pickupConfirmation ? ' has-preview' : ''}`}
            aria-labelledby='pickup-file-title'
          >
            <div className='pickup-workspace'>
              <div className='pickup-sheet'>
                <div className='pickup-file-row' data-has-file={pickupFile ? 'true' : 'false'}>
                  <span className='pickup-file-icon' aria-hidden='true'>XLSX</span>
                  <div className='pickup-file-copy'>
                    <strong id='pickup-file-title'>
                      {pickupFile ? pickupFile.name : 'エラーリストをドロップ'}
                    </strong>
                    <span>
                      {pickupConfirmation
                        ? `${pickupConfirmation.stats.outputRows.toLocaleString('ja-JP')}件を表示中`
                        : '画面のどこにドロップしても選択できます'}
                    </span>
                  </div>
                  <div className='pickup-file-actions'>
                    <label className='file-button'>
                      ファイルを選択
                      <input type='file' accept='.xlsx' onChange={selectPickupFile} />
                    </label>
                    <button
                      className='confirm-button'
                      type='button'
                      onClick={confirmPickupUpload}
                      disabled={!pickupFile || pickupStatus.kind === 'loading' ||
                        Boolean(pickupConfirmation)}
                    >
                      {pickupStatus.kind === 'loading'
                        ? '確認中…'
                        : pickupConfirmation
                        ? '確定済み'
                        : 'アップロードを確定'}
                    </button>
                  </div>
                </div>
              </div>

              {pickupConfirmation && (
                <section className='pickup-preview-panel' aria-labelledby='pickup-preview-title'>
                  <div className='pickup-preview-heading'>
                    <strong id='pickup-preview-title'>出力フォーマット</strong>
                    <span>{pickupConfirmation.rows.length.toLocaleString('ja-JP')}件</span>
                  </div>
                  <div className='pickup-preview-scroll'>
                    <table className='pickup-preview-table'>
                      <thead>
                        <tr>
                          {pickupConfirmation.headers.map((header, index) => (
                            <th key={`${header}-${index}`}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pickupConfirmation.rows.map((row, rowIndex) => (
                          <tr key={`pickup-output-${rowIndex}`}>
                            {row.map((value, columnIndex) => (
                              <td key={`${rowIndex}-${columnIndex}`}>{value}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          </section>

          <footer className='sheet-footer'>
            <div className='sheet-meta'>
              {pickupConfirmation
                ? (
                  <>
                    <span>
                      入力{' '}
                      <strong>
                        {pickupConfirmation.stats.inputRows.toLocaleString('ja-JP')}
                      </strong>件
                    </span>
                    <span>
                      在庫一致{' '}
                      <strong>
                        {pickupConfirmation.stats.matchedRows.toLocaleString('ja-JP')}
                      </strong>件
                    </span>
                    <span>
                      出力{' '}
                      <strong>
                        {pickupConfirmation.stats.outputRows.toLocaleString('ja-JP')}
                      </strong>件
                    </span>
                  </>
                )
                : <span>エラーリストを選択してください</span>}
              {pickupStatus.message && (
                <span
                  className={`footer-message ${pickupStatus.kind === 'error' ? 'error' : ''}`}
                  role='status'
                  aria-live='polite'
                >
                  {pickupStatus.message}
                </span>
              )}
            </div>
          </footer>
        </>
      )}
    </main>
  );
}
