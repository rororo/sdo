import { assertEquals, assertStringIncludes } from '@std/assert';
import ExcelJS from 'exceljs';
import { createApp, createRequestHandler } from './app.ts';
import {
  S3ShoeProductsRepository,
  type ShoeProductsDataset,
  type ShoeProductsRepository,
  ShoeProductsRepositoryError,
} from './repositories/shoe-products-repository.ts';
import type {
  StoreInventoryDataset,
  StoreInventoryRepository,
} from './repositories/store-inventory-repository.ts';
import {
  PICKUP_SUBMISSION_HEADERS,
  SAFE_SIZE_HEADERS,
  type StoreInventoryRecord,
} from './transforms/pickup-list-transform.ts';
import {
  OUTPUT_HEADERS,
  SHOE_PRODUCT_FIELDS,
  type ShoeProductRecord,
  SOURCE_HEADERS,
} from './transforms/shoes-master-transform.ts';
import { type AuthConfig, createPasswordHash } from './utils/auth-session.ts';

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
  ecId: '00012345678901234567',
  ecUrl: 'https://www.supersports.com/ja-jp/xebio/products/00012345678901234567',
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

function dataset(records: readonly ShoeProductRecord[] = [sampleProduct]): ShoeProductsDataset {
  return {
    records,
    bucket: 'scanalytics-report',
    key: 'sdo/shoe_products/kiukkn=202609_202703/shoe_products.csv',
    etag: 'test-etag',
    lastModified: '2026-08-13T06:15:00.000Z',
    loadedAt: '2026-08-13T06:20:00.000Z',
  };
}

function source(records: readonly ShoeProductRecord[] = [sampleProduct]): ShoeProductsRepository {
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
): StoreInventoryRepository {
  return { getDataset: () => Promise.resolve(inventoryDataset(records)) };
}

async function errorListFile(
  eans: readonly string[],
  headers: readonly string[] = SAFE_SIZE_HEADERS,
): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SafeSize errors');
  sheet.addRow([...headers]);
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

Deno.test('request handler serves client assets and the SPA fallback', async () => {
  const clientRootPath = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${clientRootPath}/index.html`,
      '<!doctype html><title>Spreadsheet console</title>',
    );
    await Deno.writeTextFile(`${clientRootPath}/app.css`, 'body { color: black; }');
    const clientRoot = new URL(`file://${clientRootPath}/`);
    const handler = createRequestHandler(createApp(auth, source(), inventorySource()), clientRoot);

    const asset = await handler(new Request('http://localhost/app.css'));
    assertEquals(asset.status, 200);
    assertEquals(asset.headers.get('content-type'), 'text/css; charset=utf-8');
    assertEquals(await asset.text(), 'body { color: black; }');

    const fallback = await handler(new Request('http://localhost/pickup-list'));
    assertEquals(fallback.status, 200);
    assertEquals(fallback.headers.get('content-type'), 'text/html; charset=utf-8');
    assertStringIncludes(await fallback.text(), 'Spreadsheet console');

    const methodNotAllowed = await handler(
      new Request('http://localhost/pickup-list', { method: 'POST' }),
    );
    assertEquals(methodNotAllowed.status, 405);
  } finally {
    await Deno.remove(clientRootPath, { recursive: true });
  }
});

Deno.test('application APIs reject unauthenticated requests', async () => {
  const app = createApp(auth, source());
  assertEquals((await app.request('/api/auth/session')).status, 401);
  assertEquals((await app.request('/api/shoes')).status, 401);
  assertEquals((await app.request('/api/kyoka-products', { method: 'POST' })).status, 401);
  assertEquals((await app.request('/api/kyoka-products.xlsx', { method: 'POST' })).status, 401);
  assertEquals((await app.request('/api/shoes.xlsx')).status, 401);
  assertEquals((await app.request('/api/kyoka-pickup-list', { method: 'POST' })).status, 401);
  assertEquals((await app.request('/api/kyoka-pickup-list.xlsx', { method: 'POST' })).status, 401);
  assertEquals((await app.request('/api/pickup-list.xlsx', { method: 'POST' })).status, 401);
  assertEquals((await app.request('/api/pickup-list', { method: 'POST' })).status, 401);
});

Deno.test('unsupported login methods remain public 404 responses', async () => {
  const app = createApp(auth, source(), inventorySource());
  for (const method of ['GET', 'PUT', 'OPTIONS']) {
    const response = await app.request('/api/auth/login', { method });
    assertEquals(response.status, 404, method);
    assertEquals(await response.text(), '404 Not Found', method);
  }
});

Deno.test('unsupported protected API methods still require authentication', async () => {
  const app = createApp(auth, source(), inventorySource());
  for (
    const [method, path] of [
      ['POST', '/api/auth/session'],
      ['GET', '/api/auth/logout'],
      ['POST', '/api/shoes'],
      ['GET', '/api/pickup-list'],
      ['GET', '/api/unknown'],
    ] as const
  ) {
    const response = await app.request(path, { method });
    assertEquals(response.status, 401, `${method} ${path}`);
    assertEquals(await response.json(), { error: 'ログインが必要です。' }, `${method} ${path}`);
  }
});

Deno.test('feature routes authenticate only once at the session expiry boundary', async () => {
  const cookie = await loginCookie();
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const encodedPayload = token.split('.')[0];
  if (!encodedPayload) throw new Error('Session token payload was not returned.');
  const payload = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.fromBase64(encodedPayload, { alphabet: 'base64url' }),
    ),
  ) as { expiresAt?: number };
  if (typeof payload.expiresAt !== 'number') {
    throw new Error('Session token expiry was not returned.');
  }

  const originalNow = Date.now;
  const requestAtBoundary = async (request: () => Response | Promise<Response>) => {
    let checks = 0;
    Date.now = () => ++checks === 1 ? payload.expiresAt! - 1 : payload.expiresAt! + 1;
    try {
      const response = await request();
      assertEquals(checks, 1);
      return response;
    } finally {
      Date.now = originalNow;
    }
  };

  const app = createApp(auth, source(), inventorySource());
  const session = await requestAtBoundary(() =>
    app.request('/api/auth/session', { headers: { Cookie: cookie } })
  );
  assertEquals(session.status, 200);

  const shoes = await requestAtBoundary(() =>
    app.request('/api/shoes', { headers: { Cookie: cookie } })
  );
  assertEquals(shoes.status, 200);

  const pickup = await requestAtBoundary(() =>
    app.request('/api/pickup-list', {
      method: 'POST',
      headers: { Cookie: cookie },
    })
  );
  assertEquals(pickup.status, 400);
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
  const repository: ShoeProductsRepository = {
    getDataset: () => Promise.resolve(dataset(records)),
  };
  const response = await createApp(auth, repository).request(
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
  assertEquals(body.records[0].ecId, sampleProduct.ecId);
  assertEquals(body.records[0].ecUrl, sampleProduct.ecUrl);
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
  assertEquals(sheet.getCell('V5').value, sampleProduct.ecId);
  assertEquals(sheet.getCell('W5').value, sampleProduct.ecUrl);
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

Deno.test('new SQL CSV flows through S3, authenticated API, and Excel with nullable EC data', async () => {
  // Keep the extractor's header literal so a parser/header change cannot mask incompatibility.
  const csv =
    '\uFEFF部門,部門名,品種,品種名,品目,品目名,自社品番,ブランド,スキャンコード(JAN),メーカー品番,商品名(EN),Size,SizeSys,EC-ID,EC-URL\r\n' +
    '302,Ｍスキーブーツ,1,レギュラーブーツ,2,フリーライドブーツ,8692462,K2,0196222995795,KS240068 BFC 110 BOA,BFC 110 BOA,25.5,JP,00012345678901234567,https://www.supersports.com/ja-jp/xebio/products/00012345678901234567\r\n' +
    '302,Ｍスキーブーツ,1,レギュラーブーツ,2,フリーライドブーツ,8692463,K2,0196222995796,KS240068 BFC 110 BOA,BFC 110 BOA,26,,,\r\n';
  const repository = new S3ShoeProductsRepository({
    send: () =>
      Promise.resolve({
        Body: { transformToString: () => Promise.resolve(csv) },
      }),
  });
  const app = createApp(auth, repository);
  const headers = { Cookie: await loginCookie() };
  const listing = await app.request('/api/shoes', { headers });
  assertEquals(listing.status, 200);
  const body = await listing.json();
  assertEquals(body.total, 2);
  assertEquals(body.records[0].ecId, sampleProduct.ecId);
  assertEquals(body.records[0].ecUrl, sampleProduct.ecUrl);
  assertEquals(body.records[1].ecId, '');
  assertEquals(body.records[1].ecUrl, '');

  const download = await app.request('/api/shoes.xlsx', { headers });
  assertEquals(download.status, 200);
  assertEquals(download.headers.get('x-processed-rows'), '2');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    new Uint8Array(await download.arrayBuffer()) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  const sheet = workbook.getWorksheet('Master Data2026FW②')!;
  assertEquals(sheet.getCell('V4').value, 'EC-ID');
  assertEquals(sheet.getCell('W4').value, 'EC-URL');
  assertEquals(sheet.getCell('V5').value, sampleProduct.ecId);
  assertEquals(sheet.getCell('W5').value, sampleProduct.ecUrl);
  assertEquals(sheet.getCell('V6').text, '');
  assertEquals(sheet.getCell('W6').text, '');
  assertEquals(sheet.autoFilter, 'A4:W6');
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

for (
  const endpoint of [
    '/api/pickup-list',
    '/api/pickup-list.xlsx',
    '/api/kyoka-pickup-list',
    '/api/kyoka-pickup-list.xlsx',
  ]
) {
  Deno.test(`${endpoint} accepts a single-column scan list with an arbitrary header`, async () => {
    const form = new FormData();
    form.set(
      'file',
      await errorListFile([
        endpoint.includes('kyoka') ? sampleInventory.internalCode : sampleInventory.ean,
      ], ['スキャンした商品コード']),
    );
    const response = await createApp(auth, source(), inventorySource()).request(
      endpoint,
      {
        method: 'POST',
        headers: { Cookie: await loginCookie() },
        body: form,
      },
    );
    assertEquals(response.status, 200);

    let bytes: Uint8Array;
    if (endpoint.endsWith('.xlsx')) {
      assertEquals(response.headers.get('x-input-rows'), '1');
      assertEquals(response.headers.get('x-matched-rows'), '1');
      assertEquals(response.headers.get('x-processed-rows'), '1');
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      const body = await response.json();
      assertEquals(body.stats, { inputRows: 1, matchedRows: 1, outputRows: 1 });
      assertEquals(body.rows[0][15], sampleInventory.internalCode);
      bytes = Uint8Array.from(atob(body.workbookBase64), (value) => value.charCodeAt(0));
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    assertEquals(
      workbook.getWorksheet('ピックアップ')?.getCell('P3').value,
      sampleInventory.internalCode,
    );
    assertEquals(
      workbook.getWorksheet('ピックアップ')?.getCell('Q3').value,
      sampleInventory.storeCode,
    );
  });
}

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

Deno.test('product list and Excel retain unknown master products with blank attributes', async () => {
  const unknown = {
    ...sampleProduct,
    department: '775',
    departmentName: '陸上シューズ',
    category: '3',
    categoryName: '陸上トレーニング',
    item: '9',
    itemName: '他陸上トレーニング',
    internalCode: '9365720',
    manufacturerModel: 'N-1093A208-101',
  };
  const records = [sampleProduct, unknown, { ...sampleProduct, internalCode: '8692463' }];
  const csv = [
    SOURCE_HEADERS.join(','),
    ...records.map((record) => SHOE_PRODUCT_FIELDS.map(({ key }) => record[key]).join(',')),
  ].join('\n');
  const repository = new S3ShoeProductsRepository({
    send: () => Promise.resolve({ Body: { transformToString: () => Promise.resolve(csv) } }),
  });
  const app = createApp(auth, repository);
  const headers = { Cookie: await loginCookie() };
  for (let page = 1; page <= records.length; page++) {
    const response = await app.request(`/api/shoes?page=${page}&pageSize=1`, { headers });
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.total, records.length);
    assertEquals(body.records, [records[page - 1]]);
  }

  const response = await app.request('/api/shoes.xlsx', { headers });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('x-processed-rows'), '3');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    new Uint8Array(await response.arrayBuffer()) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  const sheet = workbook.getWorksheet('Master Data2026FW②')!;
  assertEquals(sheet.rowCount, 7);
  for (const column of ['E', 'F', 'I', 'M']) {
    assertEquals(sheet.getCell(`${column}6`).text, '');
  }
  assertEquals(sheet.getCell('K6').value, unknown.manufacturerModel);
  records.forEach((record, index) => {
    assertEquals(sheet.getCell(`L${index + 5}`).value, record.internalCode);
  });
  assertEquals(sheet.getCell('E5').value, 'Male');
  assertEquals(sheet.getCell('F5').value, 'Adult');
  assertEquals(sheet.getCell('I5').value, 'Ski');
  assertEquals(sheet.getCell('K5').value, `${sampleProduct.manufacturerModel}MaleAdult`);
});

Deno.test('product data read failure returns a generic gateway error', async () => {
  const failedRepository: ShoeProductsRepository = {
    getDataset: () => {
      throw new ShoeProductsRepositoryError(
        '商品データを取得できませんでした。しばらくしてから再試行してください。',
      );
    },
  };
  const response = await createApp(auth, failedRepository).request('/api/shoes', {
    headers: { Cookie: await loginCookie() },
  });
  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: '商品データを取得できませんでした。しばらくしてから再試行してください。',
  });
});

Deno.test('authenticated kyoka upload matches internal codes without reading product data', async () => {
  const products: ShoeProductsRepository = {
    getDataset: () => {
      throw new Error('Product data must not be read');
    },
  };
  const app = createApp(auth, products, inventorySource());
  const form = new FormData();
  form.set('file', await errorListFile([sampleInventory.internalCode], ['自社品番']));
  const response = await app.request('/api/kyoka-pickup-list', {
    method: 'POST',
    headers: { Cookie: await loginCookie() },
    body: form,
  });
  assertEquals(response.status, 200);
  const result = await response.json();
  assertEquals(result.stats, { inputRows: 1, matchedRows: 1, outputRows: 1 });
  assertEquals(result.rows[0][15], sampleInventory.internalCode);
});
