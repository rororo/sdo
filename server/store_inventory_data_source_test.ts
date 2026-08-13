import { assertEquals } from '@std/assert';
import { S3StoreInventoryDataSource } from './store_inventory_data_source.ts';
import { STORE_INVENTORY_HEADERS } from './pickup_list.ts';

const inventoryCsv = `${STORE_INVENTORY_HEADERS.join(',')}
4900000000001,775,陸上シューズ,010,MODEL-A,ＡＳＩＣＳ,SHOE A,ＡＷ用陸上スパイク,ＡＷ走高飛スパイク,8507010,24.0,10309,店舗A
`;

Deno.test('S3 store inventory source caches the fixed dataset for one hour', async () => {
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
  const source = new S3StoreInventoryDataSource(
    client,
    'test-bucket',
    'test/inventory.csv',
    () => now,
  );

  const first = await source.getDataset();
  const cached = await source.getDataset();
  now = new Date('2026-08-13T07:20:00.001Z');
  const refreshed = await source.getDataset();
  assertEquals(first.records.length, 1);
  assertEquals(first.etag, 'inventory-etag');
  assertEquals(first.lastModified, '2026-08-13T06:15:00.000Z');
  assertEquals(cached, first);
  assertEquals(refreshed.records.length, 1);
  assertEquals(requests, 2);
});
