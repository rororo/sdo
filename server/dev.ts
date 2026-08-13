import { createApp } from './app.ts';

const app = createApp();
Deno.serve({ hostname: '127.0.0.1', port: 8000 }, app.fetch);
