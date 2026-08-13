import { type FormEvent, useCallback, useEffect, useState } from 'react';

const PAGE_SIZE = 50;

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
  source: {
    bucket: string;
    key: string;
    etag: string | null;
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

function apiUrl(path: string): string {
  return new URL(path.replace(/^\//, ''), document.baseURI).toString();
}

function responseFilename(response: Response): string {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const matched = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  return matched?.[1] ? decodeURIComponent(matched[1]) : 'shoe_master.xlsx';
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
  const [data, setData] = useState<ShoeDataResponse | null>(null);
  const [dataStatus, setDataStatus] = useState<RequestStatus>({
    kind: 'idle',
    message: '',
  });
  const [downloadStatus, setDownloadStatus] = useState<RequestStatus>({
    kind: 'idle',
    message: '',
  });

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
    if (auth.kind !== 'authenticated') return;
    void loadData(page);
    const timer = globalThis.setInterval(() => void loadData(page), 60 * 60 * 1000);
    return () => globalThis.clearInterval(timer);
  }, [auth.kind, loadData, page]);

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
      anchor.download = responseFilename(response);
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
    <main className='sheet-app'>
      <header className='sheet-toolbar'>
        <div className='sheet-title'>
          <BrandMark />
          <h1>商品一覧</h1>
        </div>
        <div className='toolbar-actions'>
          <button
            className='download-button'
            type='button'
            onClick={downloadExcel}
            disabled={!data || downloadStatus.kind === 'loading'}
          >
            <span aria-hidden='true'>↓</span>
            {downloadStatus.kind === 'loading' ? 'Excel生成中…' : 'Excelをダウンロード'}
          </button>
          <span className='account-name'>{auth.username}</span>
          <button className='logout-button' type='button' onClick={logout}>ログアウト</button>
        </div>
      </header>

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
          <span>更新 {formatDate(data?.source.lastModified ?? null)}</span>
          {data && (
            <span
              className='source-meta'
              title={`s3://${data.source.bucket}/${data.source.key}`}
            >
              s3://{data.source.bucket}/{data.source.key}
            </span>
          )}
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
    </main>
  );
}
