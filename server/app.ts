import { Hono } from 'hono';
import { requireApiAuth } from './middleware/require-auth.ts';
import {
  createShoeProductsRepository,
  type ShoeProductsRepository,
} from './repositories/shoe-products-repository.ts';
import {
  createStoreInventoryRepository,
  type StoreInventoryRepository,
} from './repositories/store-inventory-repository.ts';
import { createAuthRoutes } from './routes/auth-routes.ts';
import { createHealthRoutes } from './routes/health-routes.ts';
import { createPickupListRoutes } from './routes/pickup-list-routes.ts';
import { createShoesRoutes } from './routes/shoes-routes.ts';
import { type AuthConfig, loadAuthConfig } from './utils/auth-session.ts';

const CLIENT_ROOT = new URL('../dist/client/', import.meta.url);
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function createApp(
  auth: AuthConfig = loadAuthConfig(),
  shoeProductsRepository: ShoeProductsRepository = createShoeProductsRepository(),
  storeInventoryRepository: StoreInventoryRepository = createStoreInventoryRepository(),
): Hono {
  const app = new Hono();
  app.route('/', createHealthRoutes());
  app.use('/api/*', requireApiAuth(auth));
  app.route('/api', createAuthRoutes(auth));
  app.route('/api', createShoesRoutes(shoeProductsRepository));
  app.route('/api', createPickupListRoutes(storeInventoryRepository));
  return app;
}

export function createRequestHandler(
  app: Hono = createApp(),
  clientRoot: URL = CLIENT_ROOT,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health' || pathname.startsWith('/api/')) {
      return await app.fetch(request);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    return await staticResponse(pathname, request.method === 'HEAD', clientRoot);
  };
}

async function staticResponse(pathname: string, head: boolean, clientRoot: URL): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (decoded.includes('..') || decoded.includes('\\')) {
    return new Response('Not found', { status: 404 });
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  try {
    const body = await Deno.readFile(new URL(relative, clientRoot));
    return new Response(head ? null : body, {
      headers: { 'Content-Type': contentType(relative) },
    });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    const body = await Deno.readFile(new URL('index.html', clientRoot));
    return new Response(head ? null : body, {
      headers: { 'Content-Type': CONTENT_TYPES['.html']! },
    });
  }
}

function contentType(pathname: string): string {
  const extension = pathname.includes('.') ? `.${pathname.split('.').at(-1)}` : '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

export type App = ReturnType<typeof createApp>;

if (import.meta.main) {
  const app = createApp();
  Deno.serve({ port: 8000 }, createRequestHandler(app));
}
