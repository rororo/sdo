import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const COOKIE_NAME = 'excel_transformer_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

export type AuthConfig = {
  username: string;
  password: string;
};

export function loadAuthConfig(): AuthConfig {
  const username = Deno.env.get('APP_USER')?.trim();
  const password = Deno.env.get('APP_PASSWORD');
  if (!username || !password) {
    throw new Error('APP_USER and APP_PASSWORD must be configured.');
  }
  return { username, password };
}

function base64Url(bytes: Uint8Array): string {
  return Uint8Array.from(bytes).toBase64({ alphabet: 'base64url', omitPadding: true });
}

function decodeBase64Url(value: string): Uint8Array {
  return Uint8Array.fromBase64(value, { alphabet: 'base64url' });
}

async function sessionKey(config: AuthConfig): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${config.username}\0${config.password}\0excel-transformer-session`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function credentialsMatch(
  config: AuthConfig,
  username: string,
  password: string,
): Promise<boolean> {
  const [expected, received] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(`${config.username}\0${config.password}`)),
    crypto.subtle.digest('SHA-256', encoder.encode(`${username}\0${password}`)),
  ]);
  const left = new Uint8Array(expected);
  const right = new Uint8Array(received);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export async function createSessionToken(config: AuthConfig): Promise<string> {
  const payload = base64Url(
    encoder.encode(
      JSON.stringify({
        username: config.username,
        expiresAt: Date.now() + 1000 * SESSION_TTL_SECONDS,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await sessionKey(config),
    encoder.encode(payload),
  );
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(config: AuthConfig, token: string): Promise<boolean> {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;

  try {
    const verified = await crypto.subtle.verify(
      'HMAC',
      await sessionKey(config),
      Uint8Array.from(decodeBase64Url(signature)).buffer,
      encoder.encode(payload),
    );
    if (!verified) return false;
    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as {
      username?: string;
      expiresAt?: number;
    };
    return session.username === config.username &&
      typeof session.expiresAt === 'number' &&
      session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function secureCookie(context: Context): boolean {
  const hostname = new URL(context.req.url).hostname;
  return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
}

export function readSessionCookie(context: Context): string | undefined {
  return getCookie(context, COOKIE_NAME);
}

export function writeSessionCookie(context: Context, token: string): void {
  setCookie(context, COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: secureCookie(context),
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(context: Context): void {
  deleteCookie(context, COOKIE_NAME, {
    path: '/',
    secure: secureCookie(context),
  });
}
