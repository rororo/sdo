import { assertEquals } from '@std/assert';
import { currentShoeProductKey, S3ShoeDataSource } from './shoe_data_source.ts';
import { SOURCE_HEADERS } from './transformer.ts';

const productCsv = `${
  SOURCE_HEADERS.join(',')
}\n302,Ｍスキーブーツ,1,レギュラーブーツ,2,フリーライドブーツ,8692462,K2,0196222995795,KS240068 BFC 110 BOA,BFC 110 BOA,25.5,JP\n`;

Deno.test('current product key follows the JST accounting-period boundaries', () => {
  assertEquals(
    currentShoeProductKey(new Date('2026-01-15T00:00:00Z')),
    'sdo/shoe_products/kiukkn=202603_202609/shoe_products.csv',
  );
  assertEquals(
    currentShoeProductKey(new Date('2026-03-31T14:59:59Z')),
    'sdo/shoe_products/kiukkn=202603_202609/shoe_products.csv',
  );
  assertEquals(
    currentShoeProductKey(new Date('2026-03-31T15:00:00Z')),
    'sdo/shoe_products/kiukkn=202609_202703/shoe_products.csv',
  );
  assertEquals(
    currentShoeProductKey(new Date('2026-09-30T14:59:59Z')),
    'sdo/shoe_products/kiukkn=202609_202703/shoe_products.csv',
  );
  assertEquals(
    currentShoeProductKey(new Date('2026-09-30T15:00:00Z')),
    'sdo/shoe_products/kiukkn=202703_202709/shoe_products.csv',
  );
});

Deno.test('S3 data source caches CSV for one hour', async () => {
  let requests = 0;
  let now = new Date('2026-08-13T06:20:00Z');
  const client = {
    send: () => {
      requests++;
      return Promise.resolve({
        Body: { transformToString: () => Promise.resolve(productCsv) },
        ContentLength: productCsv.length,
        ETag: '"etag-value"',
        LastModified: new Date('2026-08-13T06:15:00Z'),
      });
    },
  };
  const dataSource = new S3ShoeDataSource(
    client,
    'test-bucket',
    'test/products.csv',
    () => now,
  );

  const first = await dataSource.getDataset();
  const cached = await dataSource.getDataset();
  now = new Date('2026-08-13T07:20:00.001Z');
  const refreshed = await dataSource.getDataset();
  assertEquals(first.records.length, 1);
  assertEquals(first.etag, 'etag-value');
  assertEquals(first.lastModified, '2026-08-13T06:15:00.000Z');
  assertEquals(cached, first);
  assertEquals(refreshed.records.length, 1);
  assertEquals(requests, 2);
});
