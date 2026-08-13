import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

type Status =
  | { kind: 'idle'; message: '' }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

type AuthState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; username: string };

function apiUrl(path: string): string {
  return new URL(path.replace(/^\//, ''), document.baseURI).toString();
}

function formatSize(size: number): string {
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function responseFilename(response: Response): string {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const matched = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  return matched?.[1] ? decodeURIComponent(matched[1]) : 'converted.xlsx';
}

function BrandMark({ login = false }: { login?: boolean }) {
  return (
    <div className={`brand-mark${login ? ' login-mark' : ''}`} aria-hidden='true'>
      <svg viewBox='0 0 32 32'>
        <path d='M8 4h11l5 5v19H8z' />
        <path d='M19 4v6h6M12 16h8M12 21h8' />
      </svg>
    </div>
  );
}

export function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });

  useEffect(() => {
    fetch(apiUrl('api/auth/session'))
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return await response.json() as { username: string };
      })
      .then((session) => setAuth({ kind: 'authenticated', username: session.username }))
      .catch(() => setAuth({ kind: 'anonymous' }));
  }, []);

  const selectFile = (candidate: File | null) => {
    setStatus({ kind: 'idle', message: '' });
    if (!candidate) {
      setFile(null);
      return;
    }
    if (!candidate.name.toLowerCase().endsWith('.xlsx')) {
      setFile(null);
      setStatus({ kind: 'error', message: '.xlsx ファイルを選択してください。' });
      return;
    }
    if (candidate.size > MAX_FILE_SIZE) {
      setFile(null);
      setStatus({ kind: 'error', message: 'ファイルサイズは20MB以下にしてください。' });
      return;
    }
    setFile(candidate);
  };

  const clearFile = () => {
    if (inputRef.current) inputRef.current.value = '';
    selectFile(null);
  };

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
      setAuth({ kind: 'authenticated', username: body.username });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'ログインに失敗しました。');
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    await fetch(apiUrl('api/auth/logout'), { method: 'POST' }).catch(() => undefined);
    clearFile();
    setAuth({ kind: 'anonymous' });
  };

  const transform = async () => {
    if (!file || status.kind === 'loading') return;
    setStatus({ kind: 'loading', message: 'ファイルを処理しています。' });

    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(apiUrl('api/transform'), { method: 'POST', body: form });
      if (response.status === 401) {
        setAuth({ kind: 'anonymous' });
        throw new Error('セッションの有効期限が切れました。もう一度ログインしてください。');
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? '変換に失敗しました。しばらくしてから再試行してください。');
      }

      const processedRows = Number(response.headers.get('X-Processed-Rows') ?? 0);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = responseFilename(response);
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus({
        kind: 'success',
        message: processedRows > 0
          ? `${
            processedRows.toLocaleString('ja-JP')
          }件を変換しました。ダウンロードを確認してください。`
          : '変換が完了しました。ダウンロードを確認してください。',
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '変換に失敗しました。',
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
          <p className='eyebrow'>WORKBOOK PROCESSOR</p>
          <h1 id='login-title'>ログイン</h1>
          <p className='login-lead'>シューズマスタ変換を利用するにはログインしてください。</p>
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
    <main className='shell'>
      <header className='hero'>
        <BrandMark />
        <div>
          <p className='eyebrow'>WORKBOOK PROCESSOR</p>
          <h1>シューズマスタ変換</h1>
          <p className='lead'>
            抽出データをアップロードすると、登録用のマスタデータを生成します。
          </p>
        </div>
        <div className='account'>
          <span>{auth.username}</span>
          <button type='button' onClick={logout}>ログアウト</button>
        </div>
      </header>

      <section className='panel' aria-labelledby='upload-title'>
        <div className='step'>
          <span>処理 01</span> シューズマスタ作成
        </div>
        <h2 id='upload-title'>抽出データのExcelファイル</h2>

        <label
          className={`drop-zone${dragging ? ' is-dragging' : ''}`}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            setDragging(false);
            selectFile(event.dataTransfer.files[0] ?? null);
          }}
        >
          <input
            ref={inputRef}
            type='file'
            accept='.xlsx'
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              selectFile(event.target.files?.[0] ?? null)}
          />
          <span className='upload-icon' aria-hidden='true'>↑</span>
          <strong>ここにファイルをドロップ</strong>
          <span>またはクリックして選択</span>
          <small>.xlsx / 最大20MB</small>
        </label>

        {file && (
          <div className='selected-file'>
            <div>
              <strong>{file.name}</strong>
              <span>{formatSize(file.size)}</span>
            </div>
            <button type='button' onClick={clearFile} aria-label='選択を解除'>×</button>
          </div>
        )}

        <button
          className='primary-button'
          type='button'
          disabled={!file || status.kind === 'loading'}
          onClick={transform}
        >
          {status.kind === 'loading' ? 'マスタデータを生成しています…' : 'マスタデータを生成'}
        </button>
        <p className={`message ${status.kind}`} role='status' aria-live='polite'>
          {status.message}
        </p>
      </section>

      <section className='notes' aria-label='処理について'>
        <article>
          <span>02</span>
          <div>
            <strong>変換処理</strong>
            <p>部門・品種・品目を固定マスタと照合し、21列の登録形式へ変換します。</p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <strong>結果を取得</strong>
            <p>処理完了後、自動でダウンロードが始まります。</p>
          </div>
        </article>
      </section>
    </main>
  );
}
