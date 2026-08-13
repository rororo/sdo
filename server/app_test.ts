import { assertEquals, assertStringIncludes } from '@std/assert';
import ExcelJS from 'exceljs';
import { createApp } from './app.ts';
import { type AuthConfig, createPasswordHash } from './auth.ts';
import {
  PICKUP_SUBMISSION_HEADERS,
  SAFE_SIZE_HEADERS,
  type StoreInventoryRecord,
} from './pickup_list.ts';
import { type ShoeDataset, type ShoeDataSource, ShoeDataSourceError } from './shoe_data_source.ts';
import type {
  StoreInventoryDataset,
  StoreInventoryDataSource,
} from './store_inventory_data_source.ts';
import { OUTPUT_HEADERS, type ShoeProductRecord } from './transformer.ts';

const TEST_PASSWORD = 'test-password';
const auth: AuthConfig = {
  username: 'test-user',
  passwordHash: await createPasswordHash(TEST_PASSWORD, {
    salt: new Uint8Array(16),
    iterations: 1,
  }),
};

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

const sampleInventory: StoreInventoryRecord = {
  ean: '0196222995795',
  department: '302',
  departmentName: 'Ｍスキーブーツ',
  threeDigitCode: '012',
  manufacturerModel: 'KS240068 BFC 110 BOA',
  brand: 'K2',
  productName: 'BFC 110 BOA',
  categoryName: 'レギュラーブーツ',
  itemName: 'フリーライドブーツ',
  internalCode: '8692462',
  sizeName: '25.5',
  storeCode: '10309',
  storeName: 'テスト店舗',
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

function inventoryDataset(
  records: readonly StoreInventoryRecord[] = [sampleInventory],
): StoreInventoryDataset {
  return {
    records,
    bucket: 'scanalytics-report',
    key: 'sdo/shoe_store_inventory/shoe_store_inventory.csv',
    etag: 'inventory-etag',
    lastModified: '2026-08-13T06:15:00.000Z',
    loadedAt: '2026-08-13T06:20:00.000Z',
  };
}

function inventorySource(
  records: readonly StoreInventoryRecord[] = [sampleInventory],
): StoreInventoryDataSource {
  return { getDataset: () => Promise.resolve(inventoryDataset(records)) };
}

async function errorListFile(eans: readonly string[]): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SafeSize errors');
  sheet.addRow([...SAFE_SIZE_HEADERS]);
  eans.forEach((ean) => sheet.addRow([ean]));
  const bytes = Uint8Array.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array);
  return new File([bytes], 'errors.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function loginCookie(): Promise<string> {
  const response = await createApp(auth, source()).request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: auth.username, password: TEST_PASSWORD }),
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
  assertEquals((await app.request('/api/pickup-list.xlsx', { method: 'POST' })).status, 401);
  assertEquals((await app.request('/api/pickup-list', { method: 'POST' })).status, 401);
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

Deno.test('authenticated shoes endpoint returns paginated product data', async () => {
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
  assertEquals(body.metadata, {
    lastModified: dataset().lastModified,
    loadedAt: dataset().loadedAt,
  });
  assertEquals('bucket' in body.metadata, false);
  assertEquals('key' in body.metadata, false);
  assertEquals('etag' in body.metadata, false);
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

Deno.test('authenticated pickup-list upload returns the submission workbook', async () => {
  const form = new FormData();
  form.set('file', await errorListFile([sampleInventory.ean]));
  const response = await createApp(auth, source(), inventorySource()).request(
    '/api/pickup-list.xlsx',
    {
      method: 'POST',
      headers: { Cookie: await loginCookie() },
      body: form,
    },
  );

  assertEquals(response.status, 200);
  assertStringIncludes(response.headers.get('content-disposition') ?? '', 'pickup_list_');
  assertEquals(response.headers.get('x-input-rows'), '1');
  assertEquals(response.headers.get('x-matched-rows'), '1');
  assertEquals(response.headers.get('x-processed-rows'), '1');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    new Uint8Array(await response.arrayBuffer()) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  const sheet = workbook.getWorksheet('ピックアップ');
  if (!sheet) throw new Error('Pickup list worksheet was not generated.');
  assertEquals(sheet.getCell('P3').value, sampleInventory.internalCode);
  assertEquals(sheet.getCell('Q3').value, sampleInventory.storeCode);
});

Deno.test('authenticated pickup-list confirmation returns its preview and workbook', async () => {
  const form = new FormData();
  form.set('file', await errorListFile([sampleInventory.ean]));
  const response = await createApp(auth, source(), inventorySource()).request(
    '/api/pickup-list',
    {
      method: 'POST',
      headers: { Cookie: await loginCookie() },
      body: form,
    },
  );

  assertEquals(response.status, 200);
  assertEquals(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as {
    filename: string;
    headers: string[];
    rows: Array<Array<string | number>>;
    stats: { inputRows: number; matchedRows: number; outputRows: number };
    workbookBase64: string;
  };
  assertStringIncludes(body.filename, 'pickup_list_');
  assertEquals(body.headers, [...PICKUP_SUBMISSION_HEADERS]);
  assertEquals(body.rows, [[
    '',
    '',
    '',
    '',
    '',
    '',
    1,
    '302',
    'Ｍスキーブーツ',
    '012',
    'KS240068 BFC 110 BOA',
    'K2',
    'BFC 110 BOA',
    'レギュラーブーツ',
    'フリーライドブーツ',
    '8692462',
    '10309',
    'テスト店舗',
  ]]);
  assertEquals(body.stats, { inputRows: 1, matchedRows: 1, outputRows: 1 });

  const workbook = new ExcelJS.Workbook();
  const workbookBytes = Uint8Array.from(atob(body.workbookBase64), (value) => value.charCodeAt(0));
  await workbook.xlsx.load(
    workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  assertEquals(workbook.getWorksheet('ピックアップ')?.getCell('P3').value, '8692462');
});

Deno.test('pickup-list confirmation rejects a non-xlsx upload', async () => {
  const form = new FormData();
  form.set('file', new File(['not an Excel workbook'], 'errors.csv'));
  const response = await createApp(auth, source(), inventorySource()).request(
    '/api/pickup-list',
    {
      method: 'POST',
      headers: { Cookie: await loginCookie() },
      body: form,
    },
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: 'Excel（.xlsx）ファイルを選択してください。' });
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

Deno.test('product data read failure returns a generic gateway error', async () => {
  const failedSource: ShoeDataSource = {
    getDataset: () => {
      throw new ShoeDataSourceError(
        '商品データを取得できませんでした。しばらくしてから再試行してください。',
      );
    },
  };
  const response = await createApp(auth, failedSource).request('/api/shoes', {
    headers: { Cookie: await loginCookie() },
  });
  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: '商品データを取得できませんでした。しばらくしてから再試行してください。',
  });
});
