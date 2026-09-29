import { assertEquals, assertStringIncludes } from '@std/assert';
import ExcelJS from 'exceljs';
import {
  type StoreInventoryRepository,
  StoreInventoryRepositoryError,
} from '../repositories/store-inventory-repository.ts';
import type { StoreInventoryRecord } from '../transforms/pickup-list-transform.ts';
import { createKyokaPickupRoutes } from './kyoka-pickup-routes.ts';

const sample: StoreInventoryRecord = {
  ean: '0196222995795',
  department: '302',
  departmentName: 'スキー',
  threeDigitCode: '012',
  manufacturerModel: 'MODEL',
  brand: 'K2',
  productName: 'SHOE',
  categoryName: 'ブーツ',
  itemName: 'ブーツ',
  internalCode: '9279246',
  sizeName: '25',
  storeCode: '10319',
  storeName: '店舗B',
};
const metadata = {
  bucket: 'test',
  key: 'test.csv',
  etag: null,
  lastModified: '2026-09-28T01:15:00Z',
  loadedAt: '2026-09-28T01:20:00Z',
};
function inventory(records: StoreInventoryRecord[]): StoreInventoryRepository {
  return { getDataset: () => Promise.resolve({ ...metadata, records }) };
}

async function upload(
  codes: readonly ExcelJS.CellValue[] = [sample.internalCode],
  headers: readonly string[] = ['自社品番'],
  column = 1,
): Promise<RequestInit> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('品番リスト');
  sheet.addRow([...headers]);
  for (const code of codes) sheet.getCell(sheet.rowCount + 1, column).value = code;
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array(await workbook.xlsx.writeBuffer())], 'internal-codes.xlsx'),
  );
  return { method: 'POST', body: form };
}

Deno.test('kyoka joins internal codes across sizes and stores without restricting to former SQL products', async () => {
  const app = createKyokaPickupRoutes(inventory([
    { ...sample, storeCode: '99999' },
    { ...sample, internalCode: '9999999' }, // Same EAN must not make this a match.
    sample,
    { ...sample, ean: '4900000000002', sizeName: '26' },
    { ...sample, ean: '4900000000003', storeCode: '10309', storeName: '店舗A' },
    { ...sample, internalCode: '9279245', ean: '4900000000004' },
  ]));
  const response = await app.request(
    '/kyoka-pickup-list',
    await upload([9279246, '９２７９２４５', '9279246']),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assertEquals(result.stats, { inputRows: 3, matchedRows: 4, outputRows: 2 });
  assertEquals(result.rows.map((row: string[]) => row.slice(15)), [
    ['9279246', '10319', '店舗B'],
    ['9279245', '10319', '店舗B'],
  ]);
  assertEquals(result.metadata, { inventoryLastModified: metadata.lastModified });
  assertStringIncludes(result.filename, 'kyoka_pickup_list_');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Uint8Array.fromBase64(result.workbookBase64) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  assertEquals(workbook.worksheets.map((sheet) => sheet.name), ['集計表', 'ピックアップ']);
  assertEquals(workbook.getWorksheet('ピックアップ')!.getCell('P3').value, '9279246');
  assertEquals(workbook.getWorksheet('ピックアップ')!.getCell('Q3').value, '10319');
  assertEquals(workbook.getWorksheet('集計表')!.getCell('B5').result, 2);
});

Deno.test('kyoka rejects EAN matching, missing inventory and output beyond template capacity', async () => {
  const app = createKyokaPickupRoutes(inventory([sample]));
  for (const code of [sample.ean, '9999999']) {
    const response = await app.request('/kyoka-pickup-list', await upload([code], ['EAN']));
    assertEquals(response.status, 422);
    assertStringIncludes(
      (await response.json()).error,
      '自社品番に一致する対象店舗在庫がありません',
    );
  }
  const records = Array.from(
    { length: 813 },
    (_, i) => ({ ...sample, internalCode: String(9000000 + i) }),
  );
  const response = await createKyokaPickupRoutes(inventory(records))
    .request('/kyoka-pickup-list', await upload(records.map((record) => record.internalCode)));
  assertEquals(response.status, 422);
  assertStringIncludes((await response.json()).error, '812件まで');
});

Deno.test('kyoka reports inventory read and validation failures', async () => {
  const failed: StoreInventoryRepository = {
    getDataset: () => Promise.reject(new StoreInventoryRepositoryError('在庫取得失敗')),
  };
  assertEquals(
    (await createKyokaPickupRoutes(failed).request('/kyoka-pickup-list', await upload())).status,
    502,
  );
});

Deno.test('kyoka validates upload and internal-code column before reading inventory', async () => {
  let reads = 0;
  const app = createKyokaPickupRoutes({
    getDataset: () => {
      reads++;
      return inventory([sample]).getDataset();
    },
  });
  assertEquals((await app.request('/kyoka-pickup-list')).status, 404);
  for (const endpoint of ['/kyoka-pickup-list', '/kyoka-pickup-list.xlsx']) {
    assertEquals((await app.request(endpoint, { method: 'POST' })).status, 400);
    const invalid = new FormData();
    invalid.set('file', new File(['invalid'], 'list.csv'));
    assertEquals((await app.request(endpoint, { method: 'POST', body: invalid })).status, 400);
    assertEquals(
      (await app.request(endpoint, {
        method: 'POST',
        headers: { 'Content-Length': String(22 * 1024 * 1024) },
      })).status,
      413,
    );
    for (
      const request of [
        await upload([], ['自社品番']),
        await upload(['invalid']),
        await upload([sample.ean], ['EAN', '商品名']),
        await upload([sample.internalCode], ['自社品番', 'Retailer internal code']),
      ]
    ) {
      const response = await app.request(endpoint, request);
      assertEquals(response.status, 422);
      assertEquals('workbookBase64' in await response.json(), false);
    }
  }
  assertEquals(reads, 0);
});

Deno.test('kyoka direct Excel uses internal-code headers in any column or arbitrary single-column headers', async () => {
  const app = createKyokaPickupRoutes(inventory([sample]));
  for (
    const [headers, column] of [
      [['任意の見出し'], 1],
      [['EAN', '商品名', ' 自社品番 '], 3],
      [['ＥＡＮ', ' retailer INTERNAL code '], 2],
    ] as const
  ) {
    const response = await app.request(
      '/kyoka-pickup-list.xlsx',
      await upload([sample.internalCode], headers, column),
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get('x-input-rows'), '1');
    assertEquals(response.headers.get('x-processed-rows'), '1');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      new Uint8Array(await response.arrayBuffer()) as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0],
    );
    assertEquals(workbook.getWorksheet('ピックアップ')!.getCell('P3').value, '9279246');
  }
});
