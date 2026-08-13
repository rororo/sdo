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

const SHOE_COLUMN_WIDTHS = [62, 116, 62, 116, 62, 130, 112, 132, 142, 128, 230, 60, 74];
const PICKUP_COLUMN_WIDTHS = [
  54,
  58,
  112,
  54,
  126,
  128,
  210,
  112,
  126,
  110,
  58,
  118,
];

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

interface ToastMessage {
  id: number;
  kind: 'success' | 'error';
  message: string;
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function initialsFor(username: string): string {
  const words = username
    .replace(/[^A-Za-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('') || 'U';
}

function Spinner() {
  return <span className='spinner' aria-hidden='true' />;
}

function BrandLine() {
  return (
    <div className='brand-line' aria-hidden='true'>
      <span />
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
      <path d='M8 2v7.5M4.75 6.75 8 10l3.25-3.25M2.5 11.5v1A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-1' />
    </svg>
  );
}

function ProductIcon() {
  return (
    <svg className='nav-icon' aria-hidden='true' viewBox='0 0 16 16'>
      <path d='M2.6 3.4h10.8v9.2H2.6zM2.6 6.4h10.8M6.4 6.4v6.2' />
    </svg>
  );
}

function PickupIcon() {
  return (
    <svg className='nav-icon' aria-hidden='true' viewBox='0 0 16 16'>
      <path d='M4.2 2.6h4.6l3 3v7.8H4.2zM8.8 2.6v3h3M6 9.4l1.5 1.5 2.6-2.9' />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
      <path d='M13.5 7.5a5.5 5.5 0 0 0-9.9-3.1M2.5 8.5a5.5 5.5 0 0 0 9.9 3.1M3.2 2v2.6h2.6M12.8 14v-2.6h-2.6' />
    </svg>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const dragDepth = useRef(0);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((message: string, kind: ToastMessage['kind'] = 'success') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, kind, message }]);
    globalThis.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);

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
    if (!accountMenuOpen) return;
    const closeMenu = (event: globalThis.MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    globalThis.addEventListener('pointerdown', closeMenu);
    globalThis.addEventListener('keydown', closeOnEscape);
    return () => {
      globalThis.removeEventListener('pointerdown', closeMenu);
      globalThis.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountMenuOpen]);

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
      setShowPassword(false);
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
    setAccountMenuOpen(false);
    setToasts([]);
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
      showToast('商品一覧のExcelをダウンロードしました。');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Excelを生成できませんでした。';
      setDownloadStatus({
        kind: 'error',
        message,
      });
      showToast(message, 'error');
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
      showToast('提出用フォーマットを表示しました。');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'ピックアップリストを生成できませんでした。';
      setPickupStatus({
        kind: 'error',
        message,
      });
      showToast(message, 'error');
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
      showToast('ピックアップリストのExcelをダウンロードしました。');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Excelをダウンロードできませんでした。';
      setPickupStatus({
        kind: 'error',
        message,
      });
      showToast(message, 'error');
    }
  };

  if (auth.kind === 'loading') {
    return (
      <div className='app-frame'>
        <BrandLine />
        <main className='auth-shell'>
          <Spinner />
          <span className='sr-only'>読み込んでいます</span>
        </main>
      </div>
    );
  }

  if (auth.kind === 'anonymous') {
    return (
      <div className='app-frame'>
        <BrandLine />
        <main className='auth-shell'>
          <section className='login-card' aria-labelledby='login-title'>
            <header className='login-card-header'>
              <h1 id='login-title'>ログイン</h1>
            </header>
            <form className='login-form' onSubmit={login}>
              <label htmlFor='username'>ユーザー名</label>
              <input
                id='username'
                name='username'
                autoComplete='username'
                placeholder='例: shoes.admin'
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
              />
              <label htmlFor='password'>パスワード</label>
              <div className='password-field'>
                <input
                  id='password'
                  name='password'
                  type={showPassword ? 'text' : 'password'}
                  autoComplete='current-password'
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type='button'
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                >
                  {showPassword ? '隠す' : '表示'}
                </button>
              </div>
              <button className='login-button' type='submit' disabled={loggingIn}>
                {loggingIn
                  ? <Spinner />
                  : (
                    <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
                      <path d='M7 3.5h4.5A1.5 1.5 0 0 1 13 5v6a1.5 1.5 0 0 1-1.5 1.5H7M5.5 5.5 8 8l-2.5 2.5M8 8H2.6' />
                    </svg>
                  )}
                <span>{loggingIn ? 'ログイン中' : 'ログイン'}</span>
              </button>
              {loginError && (
                <div className='alert-message' role='alert'>
                  <span aria-hidden='true'>!</span>
                  <p>{loginError}</p>
                </div>
              )}
            </form>
          </section>
        </main>
      </div>
    );
  }

  const productStatus = dataStatus.kind === 'error'
    ? '取得失敗'
    : dataStatus.kind === 'loading'
    ? data ? 'ページ更新中' : '取得中'
    : downloadStatus.kind === 'loading'
    ? 'Excel生成中'
    : data
    ? '取得済'
    : '取得中';
  const pickupState = pickupStatus.kind === 'loading'
    ? '処理中'
    : pickupStatus.kind === 'error'
    ? '処理失敗'
    : pickupConfirmation
    ? '完了'
    : '未確定';
  const shownPages = data
    ? Array.from({ length: data.pageCount }, (_, index) => index + 1).filter((candidate) =>
      candidate === 1 || candidate === data.pageCount || Math.abs(candidate - data.page) <= 1
    )
    : [];

  return (
    <main
      className='sheet-app'
      onDragEnter={beginFileDrag}
      onDragOver={continueFileDrag}
      onDragLeave={endFileDrag}
      onDrop={dropPickupFile}
    >
      <BrandLine />

      {isDraggingFile && (
        <div className='file-drop-overlay' role='status' aria-live='polite'>
          <div>
            <strong>Excelファイルをドロップ</strong>
            <span>.xlsx 形式、1ファイル、20MBまで</span>
          </div>
        </div>
      )}

      <header className='sheet-toolbar'>
        <nav className='view-switcher' aria-label='画面切り替え'>
          <a
            href={VIEW_PATHS.products}
            className={view === 'products' ? 'active' : ''}
            aria-current={view === 'products' ? 'page' : undefined}
            onClick={(event) => switchView(event, 'products')}
          >
            <ProductIcon />
            <span>商品一覧</span>
          </a>
          <a
            href={VIEW_PATHS.pickup}
            className={view === 'pickup' ? 'active' : ''}
            aria-current={view === 'pickup' ? 'page' : undefined}
            onClick={(event) => switchView(event, 'pickup')}
          >
            <PickupIcon />
            <span>ピックアップリスト</span>
          </a>
        </nav>

        <div className='toolbar-actions'>
          <button
            className='download-button'
            type='button'
            onClick={view === 'products' ? downloadExcel : downloadPickupExcel}
            disabled={view === 'products'
              ? !data || downloadStatus.kind === 'loading'
              : !pickupConfirmation || pickupStatus.kind === 'loading'}
            title={view === 'products'
              ? '表示中の商品データをExcelでダウンロード'
              : pickupConfirmation
              ? '表示中のピックアップリストをExcelでダウンロード'
              : 'アップロード確定後に利用できます'}
          >
            {view === 'products' && downloadStatus.kind === 'loading'
              ? <Spinner />
              : <DownloadIcon />}
            <span>
              {view === 'products' && downloadStatus.kind === 'loading'
                ? 'Excel生成中'
                : 'Excelダウンロード'}
            </span>
          </button>
          <span className='toolbar-divider' aria-hidden='true' />
          <div className='account-menu' ref={accountMenuRef}>
            <button
              className={`avatar-button${accountMenuOpen ? ' active' : ''}`}
              type='button'
              aria-haspopup='menu'
              aria-expanded={accountMenuOpen}
              aria-label={`アカウントメニュー: ${auth.username}`}
              title={auth.username}
              onClick={() => setAccountMenuOpen((current) => !current)}
            >
              {initialsFor(auth.username)}
            </button>
            {accountMenuOpen && (
              <div className='account-popover' role='menu'>
                <div className='account-summary'>
                  <span className='account-avatar-small' aria-hidden='true'>
                    {initialsFor(auth.username)}
                  </span>
                  <span>
                    <strong>{auth.username}</strong>
                    <small>ログイン中</small>
                  </span>
                </div>
                <button type='button' role='menuitem' onClick={logout}>
                  <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
                    <path d='M9.5 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h5.5M11 5.5 13.5 8 11 10.5M13.5 8H6.5' />
                  </svg>
                  <span>ログアウト</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className='workspace'>
        {view === 'products' && (
          <>
            <section className='data-panel' aria-label='商品一覧'>
              {!data && dataStatus.kind === 'error' && (
                <div className='empty-state error-state' role='alert'>
                  <span className='state-icon' aria-hidden='true'>!</span>
                  <strong>商品データを取得できませんでした</strong>
                  <p>{dataStatus.message}</p>
                  <button
                    className='secondary-button'
                    type='button'
                    onClick={() =>
                      void loadData(1)}
                  >
                    <RefreshIcon />
                    <span>再試行</span>
                  </button>
                </div>
              )}

              {!data && dataStatus.kind !== 'error' && (
                <div className='loading-table' aria-busy='true' aria-live='polite'>
                  <div className='skeleton-heading'>データを読み込み中</div>
                  {Array.from({ length: 13 }, (_, row) => (
                    <div className='skeleton-row' key={row}>
                      {[56, 92, 48, 104, 120, 76, 132, 60].map((width, column) => (
                        <span
                          key={column}
                          style={{ width: width - row % 3 * 6 }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {data && data.records.length === 0 && dataStatus.kind !== 'loading' && (
                <div className='empty-state'>
                  <span className='empty-table-icon' aria-hidden='true' />
                  <strong>表示できる商品データがありません</strong>
                  <p>
                    取得は正常に完了しましたが、該当する商品がありませんでした。時間をおいて再度確認してください。
                  </p>
                </div>
              )}

              {data && data.records.length > 0 && (
                <div className='table-scroll' aria-busy={dataStatus.kind === 'loading'}>
                  <table className='product-table'>
                    <thead>
                      <tr>
                        {SHOE_FIELDS.map(([, label], index) => (
                          <th
                            key={label}
                            scope='col'
                            style={{
                              width: SHOE_COLUMN_WIDTHS[index],
                              minWidth: SHOE_COLUMN_WIDTHS[index],
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.records.map((record, rowIndex) => (
                        <tr key={`${record.internalCode}-${record.ean}-${rowIndex}`} tabIndex={0}>
                          {SHOE_FIELDS.map(([key], columnIndex) => (
                            <td
                              key={key}
                              title={record[key] || '—'}
                              className={[0, 2, 4, 6, 8, 9, 11].includes(columnIndex)
                                ? 'mono-cell'
                                : ''}
                            >
                              {record[key] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data && dataStatus.kind === 'loading' && (
                <div className='paging-progress' role='status' aria-label='ページを更新中'>
                  <span />
                </div>
              )}
            </section>

            <footer className='sheet-footer'>
              <div className='sheet-meta'>
                <span>
                  商品件数 {data ? data.total.toLocaleString('ja-JP') : '—'} 件
                  {data && data.total > 0 && (
                    <>
                      （{((data.page - 1) * data.pageSize + 1).toLocaleString('ja-JP')}–
                      {Math.min(data.page * data.pageSize, data.total).toLocaleString('ja-JP')}{' '}
                      表示）
                    </>
                  )}
                </span>
                <span>最終更新 {formatDate(data?.metadata.lastModified ?? null)}</span>
                <span
                  className={`status-badge${dataStatus.kind === 'error' ? ' error' : ''}`}
                  role='status'
                  aria-live='polite'
                >
                  {productStatus}
                </span>
              </div>

              {data && data.pageCount > 0 && (
                <nav className='pagination' aria-label='商品一覧のページ切り替え'>
                  <button
                    type='button'
                    onClick={() =>
                      setPage(1)}
                    disabled={data.page <= 1 || dataStatus.kind === 'loading'}
                    aria-label='最初のページ'
                  >
                    <span aria-hidden='true'>«</span>
                    <span className='pager-label'>最初</span>
                  </button>
                  <button
                    type='button'
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))}
                    disabled={data.page <= 1 || dataStatus.kind === 'loading'}
                    aria-label='前のページ'
                  >
                    <span aria-hidden='true'>‹</span>
                    <span className='pager-label'>前</span>
                  </button>
                  {shownPages.map((shownPage, index) => (
                    <span className='page-number-group' key={shownPage}>
                      {index > 0 && shownPage - (shownPages[index - 1] ?? 0) > 1 && (
                        <span className='pagination-gap' aria-hidden='true'>…</span>
                      )}
                      <button
                        type='button'
                        className={shownPage === data.page ? 'current' : ''}
                        aria-current={shownPage === data.page ? 'page' : undefined}
                        aria-label={`${shownPage}ページ目`}
                        onClick={() =>
                          setPage(shownPage)}
                        disabled={dataStatus.kind === 'loading' && shownPage !== data.page}
                      >
                        {shownPage}
                      </button>
                    </span>
                  ))}
                  <button
                    type='button'
                    onClick={() => setPage((current) => Math.min(data.pageCount, current + 1))}
                    disabled={data.page >= data.pageCount || dataStatus.kind === 'loading'}
                    aria-label='次のページ'
                  >
                    <span className='pager-label'>次</span>
                    <span aria-hidden='true'>›</span>
                  </button>
                  <button
                    type='button'
                    onClick={() => setPage(data.pageCount)}
                    disabled={data.page >= data.pageCount || dataStatus.kind === 'loading'}
                    aria-label='最後のページ'
                  >
                    <span className='pager-label'>最後</span>
                    <span aria-hidden='true'>»</span>
                  </button>
                </nav>
              )}
            </footer>
          </>
        )}

        {view === 'pickup' && (
          <>
            {pickupConfirmation
              ? (
                <div className='upload-compact'>
                  <span className='success-check' aria-hidden='true'>✓</span>
                  <strong title={pickupFile?.name}>{pickupFile?.name}</strong>
                  <span>{pickupFile ? formatFileSize(pickupFile.size) : ''}</span>
                  <label className='secondary-file-button'>
                    <RefreshIcon />
                    <span>別のファイルを選択</span>
                    <input type='file' accept='.xlsx' onChange={selectPickupFile} />
                  </label>
                </div>
              )
              : (
                <section className='upload-panel' aria-labelledby='pickup-file-title'>
                  <span className='xlsx-icon' aria-hidden='true'>XLS</span>
                  <h1 id='pickup-file-title'>Excelファイルをドロップ、または選択</h1>
                  <p>画面のどこへドロップしても受け付けます。.xlsx 形式、1ファイル、20MBまで。</p>
                  <div className='upload-actions'>
                    <label className='file-button'>
                      <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
                        <path d='M2.5 12.5v-8A1.5 1.5 0 0 1 4 3h2.2l1.2 1.6H12a1.5 1.5 0 0 1 1.5 1.5v6.4A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5Z' />
                      </svg>
                      <span>ファイルを選択</span>
                      <input type='file' accept='.xlsx' onChange={selectPickupFile} />
                    </label>
                    {pickupFile && (
                      <button
                        className='confirm-button'
                        type='button'
                        onClick={confirmPickupUpload}
                        disabled={pickupStatus.kind === 'loading'}
                      >
                        {pickupStatus.kind === 'loading'
                          ? <Spinner />
                          : (
                            <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
                              <path d='m3.2 8.4 3 3 6.6-6.8' />
                            </svg>
                          )}
                        <span>
                          {pickupStatus.kind === 'loading' ? '確認中' : 'アップロードを確定'}
                        </span>
                      </button>
                    )}
                  </div>
                  {pickupFile && (
                    <div className='selected-file'>
                      <strong title={pickupFile.name}>{pickupFile.name}</strong>
                      <span>{formatFileSize(pickupFile.size)}</span>
                      <button type='button' onClick={() => updatePickupFile(null)}>選択解除</button>
                    </div>
                  )}
                  {pickupStatus.kind === 'error' && (
                    <div className='alert-message upload-error' role='alert'>
                      <span aria-hidden='true'>!</span>
                      <p>{pickupStatus.message}</p>
                    </div>
                  )}
                </section>
              )}

            <section className='data-panel pickup-result-panel' aria-label='出力フォーマット'>
              {pickupConfirmation
                ? (
                  <>
                    <header className='result-heading'>
                      <h2>出力フォーマット</h2>
                      <span>出力 {pickupConfirmation.rows.length.toLocaleString('ja-JP')} 件</span>
                    </header>
                    <div className='table-scroll'>
                      <table className='pickup-preview-table'>
                        <thead>
                          <tr>
                            {pickupConfirmation.headers.slice(6).map((header, index) => (
                              <th
                                key={`${header}-${index}`}
                                scope='col'
                                style={{
                                  width: PICKUP_COLUMN_WIDTHS[index],
                                  minWidth: PICKUP_COLUMN_WIDTHS[index],
                                }}
                              >
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pickupConfirmation.rows.map((row, rowIndex) => (
                            <tr key={`pickup-output-${rowIndex}`} tabIndex={0}>
                              {row.slice(6).map((value, columnIndex) => (
                                <td
                                  key={`${rowIndex}-${columnIndex}`}
                                  title={String(value)}
                                  className={columnIndex === 0 || columnIndex === 1 ||
                                      columnIndex === 3 || columnIndex === 4 ||
                                      columnIndex === 9 || columnIndex === 10
                                    ? 'mono-cell'
                                    : ''}
                                >
                                  {value}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
                : pickupStatus.kind === 'error' && pickupFile
                ? (
                  <div className='empty-state error-state' role='alert'>
                    <span className='state-icon' aria-hidden='true'>!</span>
                    <strong>処理に失敗しました</strong>
                    <p>
                      入力ファイルは保持しています。再試行するか、別のファイルを選択してください。
                    </p>
                    <button
                      className='secondary-button'
                      type='button'
                      onClick={confirmPickupUpload}
                    >
                      <RefreshIcon />
                      <span>再試行</span>
                    </button>
                  </div>
                )
                : (
                  <div className='empty-state'>
                    <span className='empty-table-icon' aria-hidden='true' />
                    <strong>結果はまだ表示されていません</strong>
                    <p>
                      Excelファイルを選択し、アップロードを確定すると出力フォーマットを表示します。
                    </p>
                  </div>
                )}
            </section>

            <footer className='sheet-footer'>
              <div className='sheet-meta'>
                <span>
                  入力件数 {pickupConfirmation
                    ? pickupConfirmation.stats.inputRows.toLocaleString('ja-JP')
                    : '—'}
                </span>
                <span>
                  在庫照合件数 {pickupConfirmation
                    ? pickupConfirmation.stats.matchedRows.toLocaleString('ja-JP')
                    : '—'}
                </span>
                <span>
                  出力件数 {pickupConfirmation
                    ? pickupConfirmation.stats.outputRows.toLocaleString('ja-JP')
                    : '—'}
                </span>
                <span
                  className={`status-badge${pickupStatus.kind === 'error' ? ' error' : ''}${
                    pickupConfirmation ? ' success' : ''
                  }`}
                  role='status'
                  aria-live='polite'
                >
                  {pickupState}
                </span>
              </div>
            </footer>
          </>
        )}
      </div>

      <div className='toast-region' aria-live='polite'>
        {toasts.map((toast) => (
          <div className={`toast ${toast.kind}`} key={toast.id}>
            <span aria-hidden='true' />
            <p>{toast.message}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
