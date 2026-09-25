import { Hono } from 'hono';
import {
  type AuthConfig,
  clearSessionCookie,
  createSessionToken,
  credentialsMatch,
  writeSessionCookie,
} from '../utils/auth-session.ts';

export function createAuthRoutes(auth: AuthConfig): Hono {
  const routes = new Hono();

  routes.post('/auth/login', async (context) => {
    let body: { username?: unknown; password?: unknown };
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'ユーザー名とパスワードを入力してください。' }, 400);
    }
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      return context.json({ error: 'ユーザー名とパスワードを入力してください。' }, 400);
    }
    if (!await credentialsMatch(auth, body.username, body.password)) {
      return context.json({ error: 'ユーザー名またはパスワードが正しくありません。' }, 401);
    }

    writeSessionCookie(context, await createSessionToken(auth));
    return context.json({ authenticated: true, username: auth.username });
  });

  routes.get(
    '/auth/session',
    (context) => context.json({ authenticated: true, username: auth.username }),
  );

  routes.post('/auth/logout', (context) => {
    clearSessionCookie(context);
    return context.json({ authenticated: false });
  });

  return routes;
}
