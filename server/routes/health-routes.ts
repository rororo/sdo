import { Hono } from 'hono';

export function createHealthRoutes(): Hono {
  const routes = new Hono();
  routes.get('/health', (context) => context.json({ status: 'ok' }));
  return routes;
}
