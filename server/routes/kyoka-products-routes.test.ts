import { assertEquals, assertStringIncludes } from '@std/assert';
import ExcelJS from 'exceljs';
import { createKyokaProductsRoutes } from './kyoka-products-routes.ts';
import {
  type ShoeProductsDataset,
  ShoeProductsRepositoryError,
} from '../repositories/shoe-products-repository.ts';
import { type ShoeProductRecord } from '../transforms/shoes-master-transform.ts';

const product: ShoeProductRecord = {
  department: '411',
  departmentName: 'Ｍゴルフシューズ',
  category: '4',
  categoryName: 'スパイクレス',
  item: '4',
  itemName: 'スポーツ型ＳＰレス',
  internalCode: '9279246',
  brand: 'TEST',
  ean: '4900000000001',
  manufacturerModel: 'MODEL',
  commercialName: 'SHOE',
  size: '25',
  sizeSystem: 'JP',
  ecId: '00001234',
  ecUrl: 'https://example.test/products/00001234',
};
function dataset(): ShoeProductsDataset {
  return {
    bucket: 'test',
    key: 'sdo/shoe_products/kiukkn=202609_202703/shoe_products.csv',
    etag: 'v1',
    lastModified: '2026-10-15T00:00:00Z',
    loadedAt: '2026-10-15T00:00:00Z',
    records: [
      ...Array.from(
        { length: 61 },
        (_, i) => ({ ...product, ean: String(4900000000001 + i), size: String(20 + i / 2) }),
      ),
      { ...product, internalCode: '9279245', ean: '4900000000100' },
      { ...product, internalCode: '9999999', ean: '4900000000200' },
    ],
  };
}
async function upload(codes = ['9279246', '9279245', '1234567', '9279246']) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('codes');
  sheet.addRow(['EAN', 'メモ', '自社品番']);
  codes.forEach((code) => sheet.addRow(['EANは照合しない', 'テスト', code]));
  const form = new FormData();
  form.set('file', new File([new Uint8Array(await workbook.xlsx.writeBuffer())], 'list.xlsx'));
  return { method: 'POST', body: form };
}

Deno.test('kyoka products filters all sizes, reports unmatched codes and exports every page with EC fields', async () => {
  const source = dataset();
  const app = createKyokaProductsRoutes({ getDataset: () => Promise.resolve(source) });
  const response = await app.request('/kyoka-products', await upload());
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('cache-control'), 'no-store');
  const first = await response.json();
  assertEquals(first.stats, { inputRows: 4, uniqueCodes: 3, matchedCodes: 2 });
  assertEquals(first.unmatchedCodes, ['1234567']);
  assertEquals(first.total, 62);
  assertEquals(first.records.length, 50);
  assertEquals(first.records[0].ean, '4900000000001');
  assertEquals(first.metadata.period, '202609_202703');
  const last =
    await (await app.request(`/kyoka-products?page=2&version=${first.version}`, await upload()))
      .json();
  assertEquals(last.records.length, 12);
  assertEquals(last.records[0].ean, '4900000000051');
  assertEquals(last.version, first.version);
  const xlsx = await app.request(`/kyoka-products.xlsx?version=${first.version}`, await upload());
  assertEquals(xlsx.status, 200);
  assertEquals(xlsx.headers.get('x-processed-rows'), '62');
  assertStringIncludes(
    xlsx.headers.get('content-disposition')!,
    'kyoka_shoe_master_202609_202703.xlsx',
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    new Uint8Array(await xlsx.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets[0]!;
  assertEquals(sheet.rowCount, 66);
  assertEquals(sheet.getCell('L66').value, '9279245');
  assertEquals(sheet.getCell('V5').value, '00001234');
  assertEquals(sheet.getCell('W5').value, product.ecUrl);
  assertEquals(sheet.getCell('V4').value, 'EC-ID');
});

Deno.test('version checks reject changed data, period or upload and survive independent app instances', async () => {
  let source = dataset();
  const repo = { getDataset: () => Promise.resolve(source) };
  const app = createKyokaProductsRoutes(repo);
  const first = await (await app.request('/kyoka-products', await upload())).json();
  const other = createKyokaProductsRoutes(repo);
  assertEquals(
    (await other.request(`/kyoka-products?page=2&version=${first.version}`, await upload())).status,
    200,
  );
  assertEquals(
    (await app.request(`/kyoka-products.xlsx?version=${first.version}`, await upload(['9279245'])))
      .status,
    409,
  );
  for (
    const next of [
      { ...dataset(), etag: 'v2' },
      { ...dataset(), key: 'sdo/shoe_products/kiukkn=202703_202709/shoe_products.csv' },
      { ...dataset(), records: [{ ...product, commercialName: 'Changed' }] },
    ]
  ) {
    source = next;
    for (const endpoint of ['kyoka-products?page=2&', 'kyoka-products.xlsx?']) {
      const response = await app.request(`/${endpoint}version=${first.version}`, await upload());
      assertEquals(response.status, 409);
      assertEquals((await response.json()).code, 'DATA_CHANGED');
    }
  }
  const refreshed = await app.request('/kyoka-products', await upload());
  assertEquals(refreshed.status, 200);
});

Deno.test('empty matches are visible but cannot be downloaded; invalid uploads never read products', async () => {
  let reads = 0;
  const app = createKyokaProductsRoutes({
    getDataset: () => {
      reads++;
      return Promise.resolve(dataset());
    },
  });
  for (const endpoint of ['/kyoka-products', '/kyoka-products.xlsx?version=test']) {
    assertEquals((await app.request(endpoint, { method: 'POST' })).status, 400);
    assertEquals((await app.request(endpoint, await upload(['not-a-code']))).status, 422);
  }
  assertEquals(reads, 0);
  assertEquals((await app.request('/kyoka-products?page=2', await upload())).status, 400);
  assertEquals((await app.request('/kyoka-products.xlsx', await upload())).status, 400);
  const empty = await (await app.request('/kyoka-products', await upload(['1234567']))).json();
  assertEquals(empty.total, 0);
  assertEquals(empty.unmatchedCodes, ['1234567']);
  assertEquals(
    (await app.request(`/kyoka-products.xlsx?version=${empty.version}`, await upload(['1234567'])))
      .status,
    422,
  );
  const failed = createKyokaProductsRoutes({
    getDataset: () => Promise.reject(new ShoeProductsRepositoryError('failed')),
  });
  assertEquals((await failed.request('/kyoka-products', await upload())).status, 502);
});

Deno.test('product exports do not inherit the pickup 812 product limit', async () => {
  const source = {
    ...dataset(),
    records: Array.from(
      { length: 813 },
      (_, i) => ({ ...product, internalCode: String(9000000 + i), ean: String(4900000000000 + i) }),
    ),
  };
  const app = createKyokaProductsRoutes({ getDataset: () => Promise.resolve(source) });
  const codes = source.records.map((record) => record.internalCode);
  const first = await (await app.request('/kyoka-products', await upload(codes))).json();
  assertEquals(first.total, 813);
  assertEquals(first.stats.matchedCodes, 813);
  const response = await app.request(
    `/kyoka-products.xlsx?version=${first.version}`,
    await upload(codes),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('x-processed-rows'), '813');
  await response.arrayBuffer();
});
