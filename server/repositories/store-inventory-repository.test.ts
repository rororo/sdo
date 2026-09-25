import { assertEquals } from '@std/assert';
import { STORE_INVENTORY_HEADERS } from '../transforms/pickup-list-transform.ts';
import { S3StoreInventoryRepository } from './store-inventory-repository.ts';

const inventoryCsv = `${STORE_INVENTORY_HEADERS.join(',')}
4900000000001,775,陸上シューズ,010,MODEL-A,ＡＳＩＣＳ,SHOE A,ＡＷ用陸上スパイク,ＡＷ走高飛スパイク,8507010,24.0,10309,店舗A
`;

Deno.test('S3 store inventory repository caches the fixed dataset for one hour', async () => {
  let requests = 0;
  let now = new Date('2026-08-13T06:20:00Z');
  const client = {
    send: () => {
      requests++;
      return Promise.resolve({
        Body: { transformToString: () => Promise.resolve(inventoryCsv) },
        ContentLength: inventoryCsv.length,
        ETag: '"inventory-etag"',
        LastModified: new Date('2026-08-13T06:15:00Z'),
      });
    },
  };
  const repository = new S3StoreInventoryRepository(
    client,
    'test-bucket',
    'test/inventory.csv',
    () => now,
  );

  const first = await repository.getDataset();
  const cached = await repository.getDataset();
  now = new Date('2026-08-13T07:20:00.001Z');
  const refreshed = await repository.getDataset();
  assertEquals(first.records.length, 1);
  assertEquals(first.etag, 'inventory-etag');
  assertEquals(first.lastModified, '2026-08-13T06:15:00.000Z');
  assertEquals(cached, first);
  assertEquals(refreshed.records.length, 1);
  assertEquals(requests, 2);
});
