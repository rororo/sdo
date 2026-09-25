import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const COOKIE_NAME = 'excel_transformer_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PASSWORD_HASH_ALGORITHM = 'pbkdf2-sha256';
const PASSWORD_HASH_ITERATIONS = 210_000;
const PASSWORD_HASH_BYTES = 32;
const encoder = new TextEncoder();

export type AuthConfig = {
  username: string;
  passwordHash: string;
};

export function loadAuthConfig(): AuthConfig {
  const username = Deno.env.get('APP_USER')?.trim();
  const passwordHash = Deno.env.get('APP_PASSWORD_HASH')?.trim();
  if (!username || !passwordHash || !parsePasswordHash(passwordHash)) {
    throw new Error('APP_USER and a valid APP_PASSWORD_HASH must be configured.');
  }
  return { username, passwordHash };
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
    encoder.encode(`${config.username}\0${config.passwordHash}\0excel-transformer-session`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

type ParsedPasswordHash = {
  iterations: number;
  salt: Uint8Array;
  digest: Uint8Array;
};

function parsePasswordHash(value: string): ParsedPasswordHash | undefined {
  const [algorithm, iterationsText, saltText, digestText, extra] = value.split('$');
  const iterations = Number(iterationsText);
  if (
    algorithm !== PASSWORD_HASH_ALGORITHM || extra || !Number.isSafeInteger(iterations) ||
    iterations < 1 || !saltText || !digestText
  ) return undefined;

  try {
    const salt = decodeBase64Url(saltText);
    const digest = decodeBase64Url(digestText);
    if (salt.length < 16 || digest.length !== PASSWORD_HASH_BYTES) return undefined;
    return { iterations, salt, digest };
  } catch {
    return undefined;
  }
}

async function derivePasswordDigest(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const digest = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations },
    key,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(digest);
}

export async function createPasswordHash(
  password: string,
  options: { salt?: Uint8Array; iterations?: number } = {},
): Promise<string> {
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const iterations = options.iterations ?? PASSWORD_HASH_ITERATIONS;
  if (!password || salt.length < 16 || !Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error('A password, a 16-byte salt, and a positive iteration count are required.');
  }
  const digest = await derivePasswordDigest(password, salt, iterations);
  return [PASSWORD_HASH_ALGORITHM, iterations, base64Url(salt), base64Url(digest)].join('$');
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function credentialsMatch(
  config: AuthConfig,
  username: string,
  password: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(config.passwordHash);
  if (!parsed) return false;

  const [expectedUsername, receivedUsername, receivedPassword] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(config.username)),
    crypto.subtle.digest('SHA-256', encoder.encode(username)),
    derivePasswordDigest(password, parsed.salt, parsed.iterations),
  ]);
  return constantTimeEqual(new Uint8Array(expectedUsername), new Uint8Array(receivedUsername)) &&
    constantTimeEqual(parsed.digest, receivedPassword);
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
