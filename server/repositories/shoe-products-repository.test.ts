import { assertEquals } from '@std/assert';
import { SOURCE_HEADERS } from '../transforms/shoes-master-transform.ts';
import { currentShoeProductKey, S3ShoeProductsRepository } from './shoe-products-repository.ts';

const productCsv = `${
  SOURCE_HEADERS.join(',')
}\n302,Ｍスキーブーツ,1,レギュラーブーツ,2,フリーライドブーツ,8692462,K2,0196222995795,KS240068 BFC 110 BOA,BFC 110 BOA,25.5,JP,000123,https://www.supersports.com/ja-jp/xebio/products/000123\n`;

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

Deno.test('S3 shoe products repository caches CSV for one hour', async () => {
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
  const repository = new S3ShoeProductsRepository(
    client,
    'test-bucket',
    'test/products.csv',
    () => now,
  );

  const first = await repository.getDataset();
  const cached = await repository.getDataset();
  now = new Date('2026-08-13T07:20:00.001Z');
  const refreshed = await repository.getDataset();
  assertEquals(first.records.length, 1);
  assertEquals(first.records[0]?.ecId, '000123');
  assertEquals(first.records[0]?.ecUrl, 'https://www.supersports.com/ja-jp/xebio/products/000123');
  assertEquals(first.etag, 'etag-value');
  assertEquals(first.lastModified, '2026-08-13T06:15:00.000Z');
  assertEquals(cached, first);
  assertEquals(refreshed.records.length, 1);
  assertEquals(requests, 2);
});
