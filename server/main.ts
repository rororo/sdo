import { createApp } from './app.ts';

let app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(request: Request): Response | Promise<Response> {
    app ??= createApp();
    return app.fetch(request);
  },
};
