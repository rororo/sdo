import { assertEquals, assertStringIncludes } from '@std/assert';
import ExcelJS from 'exceljs';
import { createApp } from './app.ts';
import type { AuthConfig } from './auth.ts';
import { OUTPUT_HEADERS, SOURCE_HEADERS } from './transformer.ts';

const auth: AuthConfig = { username: 'test-user', password: 'test-password' };

async function workbookFile(name = 'sales.xlsx'): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('抽出データ');
  sheet.addRow([...SOURCE_HEADERS]);
  sheet.addRow([
    302,
    'Ｍスキーブーツ',
    1,
    'レギュラーブーツ',
    2,
    'フリーライドブーツ',
    '8692462',
    'K2',
    196222995795,
    'KS240068 BFC 110 BOA',
    'BFC 110 BOA',
    25.5,
    'JP',
  ]);
  return new File([await workbook.xlsx.writeBuffer()], name);
}

async function loginCookie(): Promise<string> {
  const response = await createApp(auth).request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: auth.username, password: auth.password }),
  });
  assertEquals(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Session cookie was not returned.');
  return cookie;
}

Deno.test('health endpoint is public', async () => {
  const response = await createApp(auth).request('/health');
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: 'ok' });
});

Deno.test('application APIs reject unauthenticated requests', async () => {
  const session = await createApp(auth).request('/api/auth/session');
  assertEquals(session.status, 401);

  const transform = await createApp(auth).request('/api/transform', { method: 'POST' });
  assertEquals(transform.status, 401);
});

Deno.test('login rejects incorrect credentials', async () => {
  const response = await createApp(auth).request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: auth.username, password: 'incorrect' }),
  });
  assertEquals(response.status, 401);
  assertEquals(response.headers.get('set-cookie'), null);
});

Deno.test('login creates a session and logout clears it', async () => {
  const cookie = await loginCookie();
  const session = await createApp(auth).request('/api/auth/session', {
    headers: { Cookie: cookie },
  });
  assertEquals(session.status, 200);
  assertEquals(await session.json(), { authenticated: true, username: auth.username });

  const logout = await createApp(auth).request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assertEquals(logout.status, 200);
  assertStringIncludes(logout.headers.get('set-cookie') ?? '', 'Max-Age=0');
});

Deno.test('authenticated transform returns converted master data', async () => {
  const form = new FormData();
  form.append('file', await workbookFile());
  const response = await createApp(auth).request('/api/transform', {
    method: 'POST',
    headers: { Cookie: await loginCookie() },
    body: form,
  });

  assertEquals(response.status, 200);
  assertStringIncludes(response.headers.get('content-disposition') ?? '', 'sales_master_data.xlsx');
  assertEquals(response.headers.get('x-processed-rows'), '1');

  const workbook = new ExcelJS.Workbook();
  const result = new Uint8Array(await response.arrayBuffer()) as unknown as Parameters<
    typeof workbook.xlsx.load
  >[0];
  await workbook.xlsx.load(result);
  assertEquals(workbook.worksheets.map((sheet) => sheet.name), ['Master Data2026FW②']);
  const sheet = workbook.getWorksheet('Master Data2026FW②');
  if (!sheet) throw new Error('Output sheet was not generated.');
  assertEquals(
    Array.from({ length: OUTPUT_HEADERS.length }, (_, index) => sheet.getCell(4, index + 1).value),
    [...OUTPUT_HEADERS],
  );
  assertEquals(Array.from({ length: 13 }, (_, index) => sheet.getCell(5, index + 1).value), [
    'K2',
    '0196222995795',
    'KS240068 BFC 110 BOA',
    'BFC 110 BOA',
    'Male',
    'Adult',
    25.5,
    'JP',
    'Ski',
    null,
    'KS240068 BFC 110 BOAMaleAdult',
    '8692462',
    null,
  ]);
});

Deno.test('authenticated transform reports an unregistered master key', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('抽出データ');
  sheet.addRow([...SOURCE_HEADERS]);
  sheet.addRow([
    999,
    '未登録部門',
    9,
    '未登録品種',
    9,
    '未登録品目',
    '1',
    'BRAND',
    '1234567890123',
    'MODEL',
    'NAME',
    25,
    'JP',
  ]);
  const form = new FormData();
  form.append('file', new File([await workbook.xlsx.writeBuffer()], 'unknown.xlsx'));

  const response = await createApp(auth).request('/api/transform', {
    method: 'POST',
    headers: { Cookie: await loginCookie() },
    body: form,
  });
  assertEquals(response.status, 422);
  assertEquals(await response.json(), {
    error: '2行目の部門・品種・品目（999 / 9 / 9）は固定マスタに登録されていません。',
  });
});

Deno.test('authenticated transform rejects non-xlsx files', async () => {
  const form = new FormData();
  form.append('file', new File(['a,b\n1,2'], 'sales.csv', { type: 'text/csv' }));
  const response = await createApp(auth).request('/api/transform', {
    method: 'POST',
    headers: { Cookie: await loginCookie() },
    body: form,
  });
  assertEquals(response.status, 415);
});
