import { assert, assertEquals } from '@std/assert';
import { Buffer } from 'node:buffer';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { createApp, createRequestHandler } from '../server/app.ts';
import { S3ShoeProductsRepository } from '../server/repositories/shoe-products-repository.ts';
import { createPasswordHash } from '../server/utils/auth-session.ts';

async function listFile(codes: string[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('品番リスト');
  sheet.addRow(['EAN', '備考', ' Retailer internal code ']);
  codes.forEach((code) => sheet.addRow(['無視する値', 'test', code]));
  return {
    name: 'codes.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

Deno.test({
  name:
    'kyoka product browser workflow: actual list, sizes, pagination, full export and stale data',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const csv = (await Deno.readTextFile(new URL('./fixtures/shoe-products.csv', import.meta.url)))
      .trim().split('\n');
    const sample = csv[1]!.split(',');
    const rows = Array.from({ length: 58 }, (_, i) => {
      const row = [...sample];
      row[6] = i < 55 ? '9279246' : '9279245';
      row[8] = String(4900000000001 + i);
      row[11] = String(20 + i / 2);
      return row.join(',');
    });
    const sourceCsv = [csv[0], ...rows, csv.at(-1)].join('\n');
    let revision = 1;
    let pausedRead: { started: () => void; resume: Promise<void> } | undefined;
    const repository = new S3ShoeProductsRepository(
      {
        send: async () => {
          const paused = pausedRead;
          pausedRead = undefined;
          if (paused) {
            paused.started();
            await paused.resume;
          }
          return {
            Body: { transformToString: () => Promise.resolve(sourceCsv) },
            ETag: `v${revision}`,
            LastModified: new Date('2026-10-15T00:00:00Z'),
          };
        },
      },
      'test',
      'sdo/shoe_products/kiukkn=202609_202703/shoe_products.csv',
      () => new Date(),
      0,
    );
    const app = createApp(
      {
        username: 'e2e',
        passwordHash: await createPasswordHash('password', {
          salt: new Uint8Array(16),
          iterations: 1,
        }),
      },
      repository,
      {
        getDataset: () => {
          throw new Error('Product list must not read store inventory');
        },
      },
    );
    const server = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen() {} },
      createRequestHandler(app),
    );
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const panel = page.locator('.kyoka-products-page');
      const fileInput = panel.locator('input[type=file]');
      const downloadButton = page.getByRole('button', { name: 'Excelダウンロード', exact: true });
      const confirm = async () => {
        const pending = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/kyoka-products'
        );
        await panel.getByRole('button', { name: 'アップロードを確定' }).click();
        const response = await pending;
        assertEquals(response.status(), 200);
        const body = await response.json();
        await panel.getByText(`商品行数 ${body.total}`, { exact: true }).waitFor();
        return body;
      };
      try {
        await page.goto(`http://127.0.0.1:${server.addr.port}/kyoka-products`);
        await page.getByLabel('ユーザー名', { exact: true }).fill('e2e');
        await page.getByLabel('パスワード', { exact: true }).fill('password');
        await page.getByRole('button', { name: 'ログイン', exact: true }).click();
        await panel.getByRole('heading', { name: '強化品番商品一覧', exact: true }).waitFor();
        assert(
          await t.step(
            'original September list retains all 58 size rows and reports missing codes',
            async () => {
              await fileInput.setInputFiles(
                decodeURIComponent(
                  new URL('./fixtures/kyoka-internal-codes-202609.xlsx', import.meta.url).pathname,
                ),
              );
              const body = await confirm();
              assertEquals(body.stats, { inputRows: 29, uniqueCodes: 29, matchedCodes: 2 });
              assertEquals(body.total, 58);
              assertEquals(body.unmatchedCodes.length, 27);
              assertEquals(await panel.locator('tbody tr').count(), 50);
              assertEquals(await panel.locator('thead th').count(), 15);
              await panel.locator('summary').click();
              await panel.getByText('対象期の商品データに含まれていない品番です。', { exact: true })
                .waitFor();
            },
          ),
        );
        assert(
          await t.step('page two and Excel contain all matches with EC fields', async () => {
            await panel.getByRole('button', { name: '次のページ' }).click();
            await panel.getByText('2 / 2 ページ（全58行）', { exact: true }).waitFor();
            assertEquals(await panel.locator('tbody tr').count(), 8);
            assertEquals(
              await panel.locator('tbody tr').first().locator('td').nth(8).innerText(),
              '4900000000051',
            );
            const pending = page.waitForEvent('download');
            await downloadButton.click();
            const download = await pending;
            assertEquals(download.suggestedFilename(), 'kyoka_shoe_master_202609_202703.xlsx');
            const path = await download.path();
            assert(path);
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(path);
            const sheet = workbook.worksheets[0]!;
            assertEquals(sheet.rowCount, 62);
            assertEquals(sheet.getCell('B62').value, '4900000000058');
            assertEquals(sheet.getCell('L62').value, '9279245');
            assertEquals(sheet.getCell('V5').value, 'test-9281551');
            assertEquals(sheet.getCell('W5').value, 'https://example.test/products/9281551');
            await download.delete();
          }),
        );
        assert(
          await t.step(
            'source updates clear results on download and require reconfirmation',
            async () => {
              revision++;
              await downloadButton.click();
              await panel.getByRole('alert').filter({ hasText: '再確定' }).waitFor();
              assertEquals(await panel.locator('tbody tr').count(), 0);
              await downloadButton.and(page.locator(':disabled')).waitFor();
              await confirm();
              revision++;
              await panel.getByRole('button', { name: '次のページ' }).click();
              await panel.getByRole('alert').filter({ hasText: '再確定' }).waitFor();
              assertEquals(await panel.locator('tbody tr').count(), 0);
              await confirm();
            },
          ),
        );
        assert(
          await t.step(
            'changed and unmatched lists disable stale downloads; duplicate codes keep sizes',
            async () => {
              await fileInput.setInputFiles(await listFile(['1234567']));
              await panel.locator('table').waitFor({ state: 'hidden' });
              await downloadButton.and(page.locator(':disabled')).waitFor();
              const empty = await confirm();
              assertEquals(empty.total, 0);
              await panel.getByText('対象期の商品データに一致する自社品番がありません。', {
                exact: true,
              }).waitFor();
              await downloadButton.and(page.locator(':disabled')).waitFor();
              await fileInput.setInputFiles(await listFile(['9279246', '9279246']));
              const matched = await confirm();
              assertEquals(matched.stats, { inputRows: 2, uniqueCodes: 1, matchedCodes: 1 });
              assertEquals(matched.total, 55);
            },
          ),
        );
        assert(
          await t.step(
            'navigation preserves independent results and file drops target this view',
            async () => {
              await page.getByRole('link', { name: '商品一覧', exact: true }).click();
              await page.locator('.products-page:not([hidden]) tbody tr').first().waitFor();
              await page.getByRole('link', { name: '強化品番商品一覧', exact: true }).click();
              await panel.getByText('商品行数 55', { exact: true }).waitFor();
              const payload = await listFile(['9279245']);
              await panel.evaluate((element, bytes) => {
                const transfer = new DataTransfer();
                transfer.items.add(
                  new File([new Uint8Array(bytes)], 'dropped.xlsx', {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  }),
                );
                element.dispatchEvent(
                  new DragEvent('drop', { bubbles: true, dataTransfer: transfer }),
                );
              }, Array.from(payload.buffer));
              await panel.getByText('dropped.xlsx', { exact: true }).waitFor();
              assertEquals((await confirm()).total, 3);
              assertEquals(new URL(page.url()).pathname, '/kyoka-products');
            },
          ),
        );
        assert(
          await t.step('changing file during a request cannot restore the old result', async () => {
            const started = Promise.withResolvers<void>();
            const resume = Promise.withResolvers<void>();
            pausedRead = { started: () => started.resolve(), resume: resume.promise };
            try {
              await fileInput.setInputFiles(await listFile(['9279246']));
              await panel.getByRole('button', { name: 'アップロードを確定' }).click();
              await started.promise;
              await fileInput.setInputFiles(await listFile(['9279245']));
              await panel.locator('table').waitFor({ state: 'hidden' });
              resume.resolve();
              assertEquals((await confirm()).total, 3);
              assertEquals(await panel.locator('tbody tr').count(), 3);
              assertEquals(
                await panel.locator('tbody tr').first().locator('td').nth(6).innerText(),
                '9279245',
              );
            } finally {
              pausedRead = undefined;
              resume.resolve();
            }
          }),
        );
        assert(
          await t.step(
            'header tabs stay visible without scrolling at every screen width',
            async () => {
              for (const width of [1440, 1024, 800, 760, 390, 320]) {
                await page.setViewportSize({ width, height: 900 });
                const header = page.locator('.sheet-toolbar');
                const navigation = page.getByRole('navigation', { name: '画面切り替え' });
                for (const region of [header, navigation]) {
                  const dimensions = await region.evaluate((element) => ({
                    width: element.clientWidth,
                    scrollWidth: element.scrollWidth,
                    height: element.clientHeight,
                    scrollHeight: element.scrollHeight,
                  }));
                  assert(
                    dimensions.scrollWidth <= dimensions.width,
                    `horizontal overflow at ${width}`,
                  );
                  assert(
                    dimensions.scrollHeight <= dimensions.height,
                    `vertical overflow at ${width}`,
                  );
                }
                const headerBounds = await header.boundingBox();
                assert(headerBounds);
                assertEquals(await navigation.getByRole('link').count(), 4);
                for (
                  const control of [...await navigation.getByRole('link').all(), downloadButton]
                ) {
                  const bounds = await control.boundingBox();
                  assert(bounds);
                  assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
                  assert(bounds.y >= headerBounds.y);
                  assert(bounds.y + bounds.height <= headerBounds.y + headerBounds.height);
                }
              }
            },
          ),
        );
        await page.setViewportSize({ width: 1440, height: 1000 });
        await Deno.mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
        await page.screenshot({
          path: decodeURIComponent(
            new URL('./artifacts/kyoka-products.png', import.meta.url).pathname,
          ),
          fullPage: true,
        });
        assertEquals(errors, []);
        assert(
          await t.step('expired session returns to login', async () => {
            await page.context().clearCookies();
            await panel.getByRole('button', { name: 'アップロードを確定' }).click();
            await page.getByRole('button', { name: 'ログイン', exact: true }).waitFor();
          }),
        );
      } catch (error) {
        await Deno.mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
        await page.screenshot({
          path: decodeURIComponent(
            new URL('./artifacts/kyoka-products-failure.png', import.meta.url).pathname,
          ),
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
