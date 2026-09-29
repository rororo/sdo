import { assert, assertEquals, assertMatch } from '@std/assert';
import type { GetObjectCommand } from '@aws-sdk/client-s3';
import { Buffer } from 'node:buffer';
import ExcelJS from 'exceljs';
import { chromium, type Page } from 'playwright';
import { createApp, createRequestHandler } from '../server/app.ts';
import { S3ShoeProductsRepository } from '../server/repositories/shoe-products-repository.ts';
import { S3StoreInventoryRepository } from '../server/repositories/store-inventory-repository.ts';
import { createPasswordHash } from '../server/utils/auth-session.ts';

const fixtures = new URL('./fixtures/', import.meta.url);
const masterPath = decodeURIComponent(new URL('kyoka-master-20260824.xlsx', fixtures).pathname);
const internalCodePath = decodeURIComponent(
  new URL('kyoka-internal-codes-202609.xlsx', fixtures).pathname,
);
const activePanel = '.pickup-list-page:not([hidden])';

// Replace only S3 I/O. CSV parsing, authentication, API, React and XLSX generation stay real.
async function fixtureApp() {
  const objects = new Map(
    await Promise.all(
      ['shoe-products.csv', 'store-inventory.csv'].map(async (key) =>
        [key, await Deno.readTextFile(new URL(key, fixtures))] as const
      ),
    ),
  );
  const client = {
    send(command: GetObjectCommand) {
      const csv = objects.get(command.input.Key ?? '');
      if (!csv) throw new Error(`Unexpected S3 key: ${command.input.Key}`);
      return Promise.resolve({
        Body: { transformToString: () => Promise.resolve(csv) },
        LastModified: new Date('2026-08-24T00:00:00Z'),
        ETag: 'e2e-fixture',
      });
    },
  };
  return createApp(
    {
      username: 'e2e-user',
      passwordHash: await createPasswordHash('e2e-password', {
        salt: new Uint8Array(16),
        iterations: 1,
      }),
    },
    new S3ShoeProductsRepository(client, 'e2e', 'shoe-products.csv'),
    new S3StoreInventoryRepository(client, 'e2e', 'store-inventory.csv'),
  );
}

async function confirmUpload(page: Page, endpoint: string, stats: Record<string, number>) {
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === endpoint && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'アップロードを確定', exact: true }).click();
  const response = await responsePromise;
  const body = await response.json();
  assertEquals(response.status(), 200, JSON.stringify(body));
  assertEquals(body.stats, stats);
  await page.locator(`${activePanel} tbody tr`).first().waitFor();
}

async function verifyPreviewAndDownload(page: Page, codes: string[], prefix: string) {
  const rows = page.locator(`${activePanel} tbody tr`);
  assertEquals(await rows.count(), codes.length);
  const stores = codes.map((code) => ['9281553', '9279245'].includes(code) ? '10319' : '10309');
  for (let index = 0; index < codes.length; index++) {
    assertEquals(await rows.nth(index).locator('td').count(), 18);
    assertEquals(await rows.nth(index).locator('td').nth(15).innerText(), codes[index]);
    assertEquals(await rows.nth(index).locator('td').nth(16).innerText(), stores[index]);
  }
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excelダウンロード', exact: true }).click();
  const download = await downloadPromise;
  assertMatch(download.suggestedFilename(), new RegExp(`^${prefix}_\\d{8}\\.xlsx$`));
  assertEquals(await download.failure(), null);
  const path = await download.path();
  assert(path);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  assertEquals(workbook.worksheets.map((sheet) => sheet.name), ['集計表', 'ピックアップ']);
  const sheet = workbook.getWorksheet('ピックアップ')!;
  for (let index = 0; index < codes.length; index++) {
    const numberCell = sheet.getCell(`G${index + 3}`);
    assertEquals(numberCell.formula ? numberCell.result : numberCell.value, index + 1);
    assertEquals(String(sheet.getCell(`P${index + 3}`).value), codes[index]);
    assertEquals(String(sheet.getCell(`Q${index + 3}`).value), stores[index]);
  }
  assertEquals(sheet.getCell(`P${codes.length + 3}`).value, null);
  assertEquals(workbook.getWorksheet('集計表')!.getCell('B5').result, codes.length);
  await download.delete();
}

async function scanList(eans: string[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('スキャン一覧');
  sheet.addRow(['自由なヘッダー名 📋']);
  eans.forEach((ean) => sheet.addRow([ean]));
  return {
    name: 'arbitrary-header.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

Deno.test({
  name: 'browser pickup workflows with original EAN master and internal-code list',
  // Playwright owns browser subprocesses and persistent Node transport handles.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const server = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen() {} },
      createRequestHandler(await fixtureApp()),
    );
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ acceptDownloads: true });
      page.setDefaultTimeout(30_000);
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const origin = `http://127.0.0.1:${server.addr.port}`;
      try {
        await page.goto(`${origin}/kyoka-pickup-list`);
        await page.getByLabel('ユーザー名', { exact: true }).fill('e2e-user');
        await page.getByLabel('パスワード', { exact: true }).fill('e2e-password');
        await page.getByRole('button', { name: 'ログイン', exact: true }).click();
        await page.getByRole('link', { name: '強化品番ピックアップ', exact: true }).click();

        assert(
          await t.step(
            'September internal-code list picks up products outside the former SQL list',
            async () => {
              await page.getByRole('button', { name: 'Excelダウンロード' })
                .and(page.locator(':disabled')).waitFor();
              await page.locator(`${activePanel} input[type=file]`).setInputFiles(internalCodePath);
              await confirmUpload(page, '/api/kyoka-pickup-list', {
                inputRows: 29,
                matchedRows: 3,
                outputRows: 2,
              });
              await verifyPreviewAndDownload(page, ['9279246', '9279245'], 'kyoka_pickup_list');
            },
          ),
        );

        assert(
          await t.step('ordinary pickup still matches EANs from the August master', async () => {
            await page.getByRole('link', { name: 'ピックアップリスト', exact: true }).click();
            await page.getByRole('button', { name: 'Excelダウンロード' })
              .and(page.locator(':disabled')).waitFor();
            await page.locator(`${activePanel} input[type=file]`).setInputFiles(masterPath);
            await confirmUpload(page, '/api/pickup-list', {
              inputRows: 25,
              matchedRows: 5,
              outputRows: 3,
            });
            await verifyPreviewAndDownload(page, ['9281551', '9281552', '9281553'], 'pickup_list');
          }),
        );

        assert(
          await t.step(
            'both screens accept arbitrary one-column headers and clear old results',
            async () => {
              for (const mode of ['standard', 'kyoka']) {
                await page.getByRole('link', {
                  name: mode === 'kyoka' ? '強化品番ピックアップ' : 'ピックアップリスト',
                  exact: true,
                }).click();
                // Switching screens retains that screen's previous result until another file is chosen.
                assertEquals(
                  await page.locator(`${activePanel} tbody tr`).count(),
                  mode === 'kyoka' ? 2 : 3,
                );
                await page.locator(`${activePanel} input[type=file]`).setInputFiles(
                  await scanList([mode === 'kyoka' ? '9281551' : '4550674065110']),
                );
                await page.locator(`${activePanel} table`).waitFor({ state: 'hidden' });
                await page.getByRole('button', { name: 'Excelダウンロード' })
                  .and(page.locator(':disabled')).waitFor();
                await confirmUpload(
                  page,
                  mode === 'kyoka' ? '/api/kyoka-pickup-list' : '/api/pickup-list',
                  {
                    inputRows: 1,
                    matchedRows: mode === 'kyoka' ? 3 : 2,
                    outputRows: 1,
                  },
                );
                await verifyPreviewAndDownload(
                  page,
                  ['9281551'],
                  mode === 'kyoka' ? 'kyoka_pickup_list' : 'pickup_list',
                );
              }
            },
          ),
        );

        assert(
          await t.step('no kyoka match shows an error and prevents stale downloads', async () => {
            await page.locator(`${activePanel} input[type=file]`).setInputFiles(
              await scanList(['9999998']),
            );
            const responsePromise = page.waitForResponse((response) =>
              new URL(response.url()).pathname === '/api/kyoka-pickup-list'
            );
            await page.getByRole('button', { name: 'アップロードを確定', exact: true }).click();
            assertEquals((await responsePromise).status(), 422);
            await page.locator(activePanel).getByText(
              'アップロードした自社品番に一致する対象店舗在庫がありませんでした。',
              { exact: true },
            ).waitFor();
            assertEquals(await page.locator(`${activePanel} tbody tr`).count(), 0);
            await page.getByRole('button', { name: 'Excelダウンロード' })
              .and(page.locator(':disabled')).waitFor();
          }),
        );
        assert(
          await t.step(
            'each screen selects its own key from mixed EAN and internal-code columns',
            async () => {
              for (const mode of ['standard', 'kyoka']) {
                await page.getByRole('link', {
                  name: mode === 'kyoka' ? '強化品番ピックアップ' : 'ピックアップリスト',
                  exact: true,
                }).click();
                const workbook = new ExcelJS.Workbook();
                const sheet = workbook.addWorksheet('列順変更');
                sheet.getRow(3).values = [
                  '自社品番',
                  '備考',
                  'EC-ID',
                  ' ＥａＮ ',
                ];
                sheet.addRow(['9281553', 'テスト', '1111111111111', '4550674065110']);
                sheet.addRow(['9281552', 'テスト', '2222222222222', '4550674065295']);
                await page.locator(`${activePanel} input[type=file]`).setInputFiles({
                  name: 'reordered-columns.xlsx',
                  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
                });
                await confirmUpload(
                  page,
                  mode === 'kyoka' ? '/api/kyoka-pickup-list' : '/api/pickup-list',
                  {
                    inputRows: 2,
                    matchedRows: mode === 'kyoka' ? 2 : 3,
                    outputRows: 2,
                  },
                );
                await verifyPreviewAndDownload(
                  page,
                  mode === 'kyoka' ? ['9281552', '9281553'] : ['9281551', '9281552'],
                  mode === 'kyoka' ? 'kyoka_pickup_list' : 'pickup_list',
                );
              }
            },
          ),
        );
        assert(
          await t.step('kyoka reads internal codes from the original August master', async () => {
            await page.locator(`${activePanel} input[type=file]`).setInputFiles(masterPath);
            await confirmUpload(page, '/api/kyoka-pickup-list', {
              inputRows: 25,
              matchedRows: 5,
              outputRows: 3,
            });
            await verifyPreviewAndDownload(
              page,
              ['9281551', '9281552', '9281553'],
              'kyoka_pickup_list',
            );
          }),
        );
        assert(
          await t.step('kyoka never falls back to EAN matching', async () => {
            await page.locator(`${activePanel} input[type=file]`).setInputFiles(
              await scanList(['4550674065110']),
            );
            const responsePromise = page.waitForResponse((response) =>
              new URL(response.url()).pathname === '/api/kyoka-pickup-list'
            );
            await page.getByRole('button', { name: 'アップロードを確定', exact: true }).click();
            assertEquals((await responsePromise).status(), 422);
            await page.locator(activePanel).getByText(
              'アップロードした自社品番に一致する対象店舗在庫がありませんでした。',
              { exact: true },
            ).waitFor();
            assertEquals(await page.locator(`${activePanel} tbody tr`).count(), 0);
            await page.getByRole('button', { name: 'Excelダウンロード' }).and(
              page.locator(':disabled'),
            ).waitFor();
          }),
        );
        assertEquals(pageErrors, []);
      } catch (error) {
        const artifacts = new URL('./artifacts/', import.meta.url);
        await Deno.mkdir(artifacts, { recursive: true });
        await page.screenshot({
          path: decodeURIComponent(new URL('pickup-failure.png', artifacts).pathname),
          fullPage: true,
        });
        throw error;
      }
    } finally {
      await browser?.close();
      await server.shutdown();
    }
  },
});
