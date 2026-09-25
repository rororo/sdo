import { assertEquals, assertThrows } from '@std/assert';
import ExcelJS from 'exceljs';
import {
  OUTPUT_HEADERS,
  parseShoeProductCsv,
  SOURCE_HEADERS,
  step1ConvertSourceRows,
  step2CreateMasterWorkbook,
  WorkbookValidationError,
} from './shoes-master-transform.ts';

const validRow = [
  '302',
  'Ｍスキーブーツ',
  '1',
  'レギュラーブーツ',
  '2',
  'フリーライドブーツ',
  '8692462',
  'K2',
  '0196222995795',
  'KS240068 BFC 110 BOA',
  'BFC 110 BOA',
  '25.5',
  'JP',
];

Deno.test('product CSV parser accepts BOM, normalized headers, and quoted values', () => {
  const header: string[] = [...SOURCE_HEADERS];
  header[8] = 'スキャンコード(JAN)';
  header[10] = '商品名(EN)';
  header[11] = 'Size';
  header[12] = 'SizeSys';
  const row = [...validRow];
  row[10] = 'BFC 110, BOA';
  const csv = `\uFEFF${header.join(',')}\r\n${
    row.map((value) => value.includes(',') ? `"${value}"` : value).join(',')
  }\r\n`;
  const products = parseShoeProductCsv(csv);
  assertEquals(products.length, 1);
  assertEquals(products[0]?.ean, '0196222995795');
  assertEquals(products[0]?.commercialName, 'BFC 110, BOA');
});

Deno.test('product CSV parser rejects an invalid column count', () => {
  const csv = `${SOURCE_HEADERS.join(',')}\n${validRow.slice(0, 12).join(',')}\n`;
  try {
    parseShoeProductCsv(csv);
    throw new Error('Expected parser failure.');
  } catch (error) {
    assertEquals(error instanceof WorkbookValidationError, true);
    assertEquals((error as Error).message, '商品CSVの2行目は13列必要です。');
  }
});

Deno.test('CSV product data is converted to the master workbook', async () => {
  const products = parseShoeProductCsv(`${SOURCE_HEADERS.join(',')}\n${validRow.join(',')}\n`);
  const rows = step1ConvertSourceRows(products);
  const bytes = await step2CreateMasterWorkbook(rows);
  assertEquals(rows.length, 1);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.getWorksheet('Master Data2026FW②');
  if (!sheet) throw new Error('Output sheet was not generated.');
  assertEquals(
    Array.from({ length: OUTPUT_HEADERS.length }, (_, index) => sheet.getCell(4, index + 1).value),
    [...OUTPUT_HEADERS],
  );
  assertEquals(sheet.getCell('B5').value, '0196222995795');
  assertEquals(sheet.getCell('G5').value, 25.5);
});

Deno.test('CSV product validation rejects unknown fixed-master keys', () => {
  const row = [...validRow];
  row[0] = '999';
  row[2] = '9';
  row[4] = '9';
  const products = parseShoeProductCsv(`${SOURCE_HEADERS.join(',')}\n${row.join(',')}\n`);
  assertThrows(
    () => step1ConvertSourceRows(products),
    WorkbookValidationError,
    '2行目の部門・品種・品目（999 / 9 / 9）',
  );
});
