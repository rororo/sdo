const commands = [
  new Deno.Command('deno', {
    args: ['task', 'dev:server'],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn(),
  new Deno.Command('deno', {
    args: ['task', 'dev:client'],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn(),
];

const stop = () =>
  commands.forEach((command) => {
    try {
      command.kill('SIGTERM');
    } catch {
      // Process already exited.
    }
  });

Deno.addSignalListener('SIGINT', stop);
Deno.addSignalListener('SIGTERM', stop);
const results = await Promise.all(commands.map((command) => command.status));
if (results.some((result) => !result.success)) Deno.exit(1);
