import { build } from 'esbuild';

async function run(command: string, args: string[]) {
  const result = await new Deno.Command(command, { args, stdout: 'inherit', stderr: 'inherit' })
    .output();
  if (!result.success) throw new Error(`${command} exited with code ${result.code}`);
}

try {
  await Deno.remove('dist', { recursive: true });
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}

await run('deno', ['run', '-A', 'npm:vite', 'build', '--config', 'client/vite-config.ts']);
await build({
  entryPoints: ['server/app.ts'],
  outfile: 'dist/app.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  banner: {
    js:
      "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);",
  },
});

await Deno.mkdir('dist/data', { recursive: true });
await Deno.copyFile(
  'server/data/department-item-master.csv',
  'dist/data/department-item-master.csv',
);
await Deno.copyFile(
  'server/data/pickup-list-template.xlsx',
  'dist/data/pickup-list-template.xlsx',
);
