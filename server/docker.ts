import { createApp } from './app.ts';

const api = createApp();
const clientRoot = new URL('../dist/client/', import.meta.url);
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function contentType(pathname: string): string {
  const extension = pathname.includes('.') ? `.${pathname.split('.').at(-1)}` : '';
  return contentTypes[extension] ?? 'application/octet-stream';
}

async function staticResponse(pathname: string): Promise<Response> {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('..') || decoded.includes('\\')) {
    return new Response('Not found', { status: 404 });
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  try {
    const body = await Deno.readFile(new URL(relative, clientRoot));
    return new Response(body, { headers: { 'Content-Type': contentType(relative) } });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    const body = await Deno.readFile(new URL('index.html', clientRoot));
    return new Response(body, { headers: { 'Content-Type': contentTypes['.html']! } });
  }
}

Deno.serve({ port: 8000 }, async (request) => {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/health' || pathname.startsWith('/api/')) return await api.fetch(request);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  return await staticResponse(pathname);
});
