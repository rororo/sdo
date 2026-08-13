import { build } from 'esbuild';

async function run(command: string, args: string[]) {
  const result = await new Deno.Command(command, { args, stdout: 'inherit', stderr: 'inherit' })
    .output();
  if (!result.success) throw new Error(`${command} exited with code ${result.code}`);
}

await run('deno', ['run', '-A', 'npm:vite', 'build', '--config', 'client/vite.config.ts']);
for (
  const [entry, output] of [
    ['server/main.ts', 'dist/server.js'],
    ['server/docker.ts', 'dist/docker.js'],
  ]
) {
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js:
        "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);",
    },
  });
}

await Deno.mkdir('dist/data', { recursive: true });
await Deno.copyFile(
  'server/data/department_item_master.csv',
  'dist/data/department_item_master.csv',
);
await Deno.copyFile(
  'docs/pickup_list_output.xlsx',
  'dist/data/pickup_list_template.xlsx',
);
