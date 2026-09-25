import { type FormEvent, useState } from 'react';
import { BrandMark } from '../components/brand-mark.tsx';
import { apiUrl } from '../utils/api.ts';

interface LoginPageProps {
  onAuthenticated: (username: string) => void;
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

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
      onAuthenticated(body.username);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'ログインに失敗しました。');
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div className='app-frame'>
      <BrandMark />
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
                ? <span className='spinner' aria-hidden='true' />
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
