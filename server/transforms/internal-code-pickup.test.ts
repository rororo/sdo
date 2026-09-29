import { assertEquals, assertRejects } from '@std/assert';
import ExcelJS from 'exceljs';
import { parseInternalCodeWorkbook, PickupListValidationError } from './pickup-list-transform.ts';

Deno.test('internal-code input normalizes digits without JAN padding and skips blank sheets/rows', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('blank');
  workbook.addWorksheet('notes').addRow(['説明']);
  const sheet = workbook.addWorksheet('codes');
  sheet.getCell('C4').value = '任意の見出し';
  sheet.getCell('C5').value = 9279246;
  sheet.getCell('C7').value = ' ９２７９２４５ ';
  sheet.getCell('C8').value = '9279246.0';
  sheet.getCell('C9').value = '0123456';
  sheet.getCell('A100').numFmt = '@';
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const parsed = await parseInternalCodeWorkbook(bytes);
  assertEquals(parsed.sheetName, 'codes');
  assertEquals(parsed.inputRows, 4);
  assertEquals([...parsed.internalCodes], ['9279246', '9279245', '0123456']);
});

Deno.test('internal-code input reads only its own column even when EAN/JAN columns coexist', async () => {
  for (const header of ['自社品番', ' Retailer INTERNAL code ']) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('codes');
    sheet.getRow(100).values = ['EAN', 'JAN', header, '商品名'];
    sheet.addRow(['not an EAN', 'invalid JAN', '9279246', 'テスト']);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    assertEquals([...(await parseInternalCodeWorkbook(bytes)).internalCodes], ['9279246']);
  }
});

Deno.test('internal-code input rejects malformed code values', async () => {
  for (const value of ['9.279246e6', '9279246.5', '927-9246', 'ABC', -1]) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('codes');
    sheet.addRow(['自社品番']);
    sheet.addRow([value]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    await assertRejects(
      () => parseInternalCodeWorkbook(bytes),
      PickupListValidationError,
      '自社品番は数字のみ',
    );
  }
});
