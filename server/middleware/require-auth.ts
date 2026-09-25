import type { MiddlewareHandler } from 'hono';
import { type AuthConfig, readSessionCookie, verifySessionToken } from '../utils/auth-session.ts';

export function requireAuth(auth: AuthConfig): MiddlewareHandler {
  return async (context, next) => {
    const token = readSessionCookie(context);
    if (!token || !await verifySessionToken(auth, token)) {
      return context.json({ error: 'ログインが必要です。' }, 401);
    }
    await next();
  };
}

export function requireApiAuth(auth: AuthConfig): MiddlewareHandler {
  const authenticate = requireAuth(auth);
  return (context, next) =>
    context.req.path === '/api/auth/login' ? next() : authenticate(context, next);
}
