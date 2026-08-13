import { Hono } from 'hono';
import {
  type AuthConfig,
  clearSessionCookie,
  createSessionToken,
  credentialsMatch,
  loadAuthConfig,
  readSessionCookie,
  verifySessionToken,
  writeSessionCookie,
} from './auth.ts';
import {
  createShoeDataSource,
  type ShoeDataSource,
  ShoeDataSourceError,
} from './shoe_data_source.ts';
import { createShoeMasterWorkbook, WorkbookValidationError } from './transformer.ts';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function outputFilename(key: string): string {
  const period = /kiukkn=([^/]+)/.exec(key)?.[1] ?? 'current';
  return `shoe_master_${period}.xlsx`;
}

export function createApp(
  auth: AuthConfig = loadAuthConfig(),
  shoeDataSource: ShoeDataSource = createShoeDataSource(),
) {
  const app = new Hono();

  app.get('/health', (context) => context.json({ status: 'ok' }));

  app.post('/api/auth/login', async (context) => {
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

  app.use('/api/*', async (context, next) => {
    if (context.req.path === '/api/auth/login') return await next();
    const token = readSessionCookie(context);
    if (!token || !await verifySessionToken(auth, token)) {
      return context.json({ error: 'ログインが必要です。' }, 401);
    }
    await next();
  });

  app.get(
    '/api/auth/session',
    (context) => context.json({ authenticated: true, username: auth.username }),
  );

  app.post('/api/auth/logout', (context) => {
    clearSessionCookie(context);
    return context.json({ authenticated: false });
  });

  app.get('/api/shoes', async (context) => {
    const page = positiveInteger(context.req.query('page'), 1, Number.MAX_SAFE_INTEGER);
    const pageSize = positiveInteger(
      context.req.query('pageSize'),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    try {
      const dataset = await shoeDataSource.getDataset();
      const total = dataset.records.length;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const resolvedPage = Math.min(page, pageCount);
      const start = (resolvedPage - 1) * pageSize;
      context.header('Cache-Control', 'no-store');
      return context.json({
        records: dataset.records.slice(start, start + pageSize),
        total,
        page: resolvedPage,
        pageSize,
        pageCount,
        source: {
          bucket: dataset.bucket,
          key: dataset.key,
          etag: dataset.etag,
          lastModified: dataset.lastModified,
          loadedAt: dataset.loadedAt,
        },
      });
    } catch (error) {
      if (error instanceof WorkbookValidationError) {
        return context.json({ error: error.message }, 422);
      }
      if (error instanceof ShoeDataSourceError) {
        return context.json({ error: error.message }, 502);
      }
      return context.json({ error: '商品データを読み込めませんでした。' }, 500);
    }
  });

  app.get('/api/shoes.xlsx', async (context) => {
    try {
      const dataset = await shoeDataSource.getDataset();
      const transformed = await createShoeMasterWorkbook(dataset.records);
      return new Response(Uint8Array.from(transformed.bytes).buffer, {
        status: 200,
        headers: {
          'Content-Type': EXCEL_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename*=UTF-8''${
            encodeURIComponent(outputFilename(dataset.key))
          }`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Processed-Rows': String(transformed.processedRows),
        },
      });
    } catch (error) {
      if (error instanceof WorkbookValidationError) {
        return context.json({ error: error.message }, 422);
      }
      if (error instanceof ShoeDataSourceError) {
        return context.json({ error: error.message }, 502);
      }
      return context.json({ error: 'Excelファイルを生成できませんでした。' }, 500);
    }
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
