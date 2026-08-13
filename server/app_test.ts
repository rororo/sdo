import { assertEquals, assertStringIncludes } from '@std/assert';
import ExcelJS from 'exceljs';
import { createApp } from './app.ts';
import type { AuthConfig } from './auth.ts';
import { type ShoeDataset, type ShoeDataSource, ShoeDataSourceError } from './shoe_data_source.ts';
import { OUTPUT_HEADERS, type ShoeProductRecord } from './transformer.ts';

const auth: AuthConfig = { username: 'test-user', password: 'test-password' };

const sampleProduct: ShoeProductRecord = {
  department: '302',
  departmentName: 'Ｍスキーブーツ',
  category: '1',
  categoryName: 'レギュラーブーツ',
  item: '2',
  itemName: 'フリーライドブーツ',
  internalCode: '8692462',
  brand: 'K2',
  ean: '0196222995795',
  manufacturerModel: 'KS240068 BFC 110 BOA',
  commercialName: 'BFC 110 BOA',
  size: '25.5',
  sizeSystem: 'JP',
};

function dataset(records: readonly ShoeProductRecord[] = [sampleProduct]): ShoeDataset {
  return {
    records,
    bucket: 'scanalytics-report',
    key: 'sdo/shoe_products/kiukkn=202609_202703/shoe_products.csv',
    etag: 'test-etag',
    lastModified: '2026-08-13T06:15:00.000Z',
    loadedAt: '2026-08-13T06:20:00.000Z',
  };
}

function source(records: readonly ShoeProductRecord[] = [sampleProduct]): ShoeDataSource {
  return { getDataset: () => Promise.resolve(dataset(records)) };
}

async function loginCookie(): Promise<string> {
  const response = await createApp(auth, source()).request('/api/auth/login', {
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
  const response = await createApp(auth, source()).request('/health');
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: 'ok' });
});

Deno.test('application APIs reject unauthenticated requests', async () => {
  const app = createApp(auth, source());
  assertEquals((await app.request('/api/auth/session')).status, 401);
  assertEquals((await app.request('/api/shoes')).status, 401);
  assertEquals((await app.request('/api/shoes.xlsx')).status, 401);
});

Deno.test('login rejects incorrect credentials', async () => {
  const response = await createApp(auth, source()).request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: auth.username, password: 'incorrect' }),
  });
  assertEquals(response.status, 401);
  assertEquals(response.headers.get('set-cookie'), null);
});

Deno.test('login creates a session and logout clears it', async () => {
  const cookie = await loginCookie();
  const app = createApp(auth, source());
  const session = await app.request('/api/auth/session', { headers: { Cookie: cookie } });
  assertEquals(session.status, 200);
  assertEquals(await session.json(), { authenticated: true, username: auth.username });

  const logout = await app.request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assertEquals(logout.status, 200);
  assertStringIncludes(logout.headers.get('set-cookie') ?? '', 'Max-Age=0');
});

Deno.test('authenticated shoes endpoint returns paginated S3 data', async () => {
  const records = Array.from({ length: 55 }, (_, index) => ({
    ...sampleProduct,
    internalCode: String(8_692_462 + index),
  }));
  const dataSource: ShoeDataSource = {
    getDataset: () => Promise.resolve(dataset(records)),
  };
  const response = await createApp(auth, dataSource).request(
    '/api/shoes?page=2&pageSize=50',
    { headers: { Cookie: await loginCookie() } },
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assertEquals(body.total, 55);
  assertEquals(body.page, 2);
  assertEquals(body.pageCount, 2);
  assertEquals(body.records.length, 5);
  assertEquals(body.records[0].internalCode, String(8_692_462 + 50));
  assertEquals(body.source.key, dataset().key);
});

Deno.test('authenticated Excel download returns converted master data', async () => {
  const response = await createApp(auth, source()).request('/api/shoes.xlsx', {
    headers: { Cookie: await loginCookie() },
  });

  assertEquals(response.status, 200);
  assertStringIncludes(
    response.headers.get('content-disposition') ?? '',
    'shoe_master_202609_202703.xlsx',
  );
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

Deno.test('Excel download reports an unregistered master key', async () => {
  const unknown = {
    ...sampleProduct,
    department: '999',
    departmentName: '未登録部門',
    category: '9',
    categoryName: '未登録品種',
    item: '9',
    itemName: '未登録品目',
  };
  const response = await createApp(auth, source([unknown])).request('/api/shoes.xlsx', {
    headers: { Cookie: await loginCookie() },
  });
  assertEquals(response.status, 422);
  assertEquals(await response.json(), {
    error: '2行目の部門・品種・品目（999 / 9 / 9）は固定マスタに登録されていません。',
  });
});

Deno.test('S3 read failure returns a gateway error', async () => {
  const failedSource: ShoeDataSource = {
    getDataset: () => {
      throw new ShoeDataSourceError('S3の商品CSVを取得できませんでした。');
    },
  };
  const response = await createApp(auth, failedSource).request('/api/shoes', {
    headers: { Cookie: await loginCookie() },
  });
  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: 'S3の商品CSVを取得できませんでした。' });
});
