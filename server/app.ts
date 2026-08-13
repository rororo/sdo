import { type Context, Hono } from 'hono';
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
import {
  createPickupList,
  createPickupSubmissionRows,
  PICKUP_SUBMISSION_HEADERS,
  PickupListValidationError,
} from './pickup_list.ts';
import {
  createStoreInventoryDataSource,
  type StoreInventoryDataSource,
  StoreInventoryDataSourceError,
} from './store_inventory_data_source.ts';
import { createShoeMasterWorkbook, WorkbookValidationError } from './transformer.ts';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

class PickupUploadError extends Error {
  constructor(message: string, readonly status: 400 | 413) {
    super(message);
    this.name = 'PickupUploadError';
  }
}

async function readPickupUpload(context: Context): Promise<Uint8Array> {
  const contentLength = Number(context.req.header('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    throw new PickupUploadError('アップロードできるExcelファイルは20MBまでです。', 413);
  }

  let form: FormData;
  try {
    form = await context.req.formData();
  } catch {
    throw new PickupUploadError('エラーリストのExcelファイルを選択してください。', 400);
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    throw new PickupUploadError('エラーリストのExcelファイルを選択してください。', 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new PickupUploadError('アップロードできるExcelファイルは20MBまでです。', 413);
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new PickupUploadError('Excel（.xlsx）ファイルを選択してください。', 400);
  }

  const uploaded = new Uint8Array(await file.arrayBuffer());
  if (uploaded[0] !== 0x50 || uploaded[1] !== 0x4b) {
    throw new PickupUploadError('Excel（.xlsx）ファイルを選択してください。', 400);
  }
  return uploaded;
}

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function outputFilename(key: string): string {
  const period = /kiukkn=([^/]+)/.exec(key)?.[1] ?? 'current';
  return `shoe_master_${period}.xlsx`;
}

function pickupOutputFilename(now = new Date()): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now).replaceAll('-', '');
  return `pickup_list_${date}.xlsx`;
}

export function createApp(
  auth: AuthConfig = loadAuthConfig(),
  shoeDataSource: ShoeDataSource = createShoeDataSource(),
  storeInventoryDataSource: StoreInventoryDataSource = createStoreInventoryDataSource(),
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
        metadata: {
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

  app.post('/api/pickup-list.xlsx', async (context) => {
    try {
      const uploaded = await readPickupUpload(context);
      const inventory = await storeInventoryDataSource.getDataset();
      const result = await createPickupList(inventory.records, uploaded);
      return new Response(Uint8Array.from(result.bytes).buffer, {
        status: 200,
        headers: {
          'Content-Type': EXCEL_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename*=UTF-8''${pickupOutputFilename()}`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Input-Rows': String(result.inputRows),
          'X-Matched-Rows': String(result.matchedRows),
          'X-Processed-Rows': String(result.outputRows),
        },
      });
    } catch (error) {
      if (error instanceof PickupUploadError) {
        return context.json({ error: error.message }, error.status);
      }
      if (error instanceof PickupListValidationError) {
        return context.json({ error: error.message }, 422);
      }
      if (error instanceof StoreInventoryDataSourceError) {
        return context.json({ error: error.message }, 502);
      }
      return context.json({ error: 'ピックアップリストを生成できませんでした。' }, 500);
    }
  });

  app.post('/api/pickup-list', async (context) => {
    try {
      const uploaded = await readPickupUpload(context);
      const inventory = await storeInventoryDataSource.getDataset();
      const result = await createPickupList(inventory.records, uploaded);
      context.header('Cache-Control', 'no-store');
      context.header('X-Content-Type-Options', 'nosniff');
      return context.json({
        filename: pickupOutputFilename(),
        headers: [...PICKUP_SUBMISSION_HEADERS],
        rows: createPickupSubmissionRows(result.records),
        stats: {
          inputRows: result.inputRows,
          matchedRows: result.matchedRows,
          outputRows: result.outputRows,
        },
        workbookBase64: encodeBase64(result.bytes),
      });
    } catch (error) {
      if (error instanceof PickupUploadError) {
        return context.json({ error: error.message }, error.status);
      }
      if (error instanceof PickupListValidationError) {
        return context.json({ error: error.message }, 422);
      }
      if (error instanceof StoreInventoryDataSourceError) {
        return context.json({ error: error.message }, 502);
      }
      return context.json({ error: 'ピックアップリストを生成できませんでした。' }, 500);
    }
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
