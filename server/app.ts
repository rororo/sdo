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
import { transformWorkbook, WorkbookValidationError } from './transformer.ts';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function outputFilename(input: string): string {
  const stem = input.replace(/\.xlsx$/i, '') || 'workbook';
  return `${stem}_master_data.xlsx`;
}

export function createApp(auth: AuthConfig = loadAuthConfig()) {
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

  app.post('/api/transform', async (context) => {
    const contentLength = Number(context.req.header('content-length') ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
      return context.json({ error: 'ファイルサイズは20MB以下にしてください。' }, 413);
    }

    let form: FormData;
    try {
      form = await context.req.raw.formData();
    } catch {
      return context.json({ error: 'アップロード内容を読み込めませんでした。' }, 400);
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return context.json({ error: 'Excelファイルを選択してください。' }, 400);
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      return context.json({ error: '.xlsx ファイルを選択してください。' }, 415);
    }
    if (file.size === 0) return context.json({ error: 'ファイルが空です。' }, 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return context.json({ error: 'ファイルサイズは20MB以下にしてください。' }, 413);
    }

    try {
      const transformed = await transformWorkbook(new Uint8Array(await file.arrayBuffer()));
      return new Response(Uint8Array.from(transformed.bytes).buffer, {
        status: 200,
        headers: {
          'Content-Type': EXCEL_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename*=UTF-8''${
            encodeURIComponent(outputFilename(file.name))
          }`,
          'X-Content-Type-Options': 'nosniff',
          'X-Processed-Rows': String(transformed.processedRows),
        },
      });
    } catch (error) {
      if (error instanceof WorkbookValidationError) {
        return context.json({ error: error.message }, 422);
      }
      return context.json(
        { error: 'Excelファイルを読み込めませんでした。内容を確認してください。' },
        422,
      );
    }
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
