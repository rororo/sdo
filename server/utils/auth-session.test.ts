import { assert, assertEquals } from '@std/assert';
import { createPasswordHash, credentialsMatch } from './auth-session.ts';

Deno.test('password hashes validate the matching credential only', async () => {
  const passwordHash = await createPasswordHash('correct-horse-battery-staple', {
    salt: new Uint8Array(16),
    iterations: 2,
  });
  const config = { username: 'admin', passwordHash };

  assert(passwordHash.startsWith('pbkdf2-sha256$2$'));
  assertEquals(await credentialsMatch(config, 'admin', 'correct-horse-battery-staple'), true);
  assertEquals(await credentialsMatch(config, 'admin', 'incorrect'), false);
  assertEquals(await credentialsMatch(config, 'other', 'correct-horse-battery-staple'), false);
});

Deno.test('malformed password hashes never authenticate', async () => {
  assertEquals(
    await credentialsMatch({ username: 'admin', passwordHash: 'invalid' }, 'admin', 'password'),
    false,
  );
});
