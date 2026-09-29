import { assertEquals, assertThrows } from '@std/assert';
import ExcelJS from 'exceljs';
import {
  LEGACY_SOURCE_HEADERS,
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
  '00012345678901234567',
  'https://www.supersports.com/ja-jp/xebio/products/00012345678901234567',
];

Deno.test('product CSV parser accepts BOM, normalized headers, and quoted values', () => {
  const header: string[] = [...SOURCE_HEADERS];
  header[8] = 'スキャンコード(JAN)';
  header[10] = '商品名(EN)';
  header[11] = 'Size';
  header[12] = 'SizeSys';
  header[13] = ' ＥＣ－ＩＤ ';
  header[14] = ' ec-url ';
  const row = [...validRow];
  row[10] = 'BFC 110, BOA';
  const csv = `\uFEFF${header.join(',')}\r\n${
    row.map((value) => value.includes(',') ? `"${value}"` : value).join(',')
  }\r\n`;
  const products = parseShoeProductCsv(csv);
  assertEquals(products.length, 1);
  assertEquals(products[0]?.ean, '0196222995795');
  assertEquals(products[0]?.commercialName, 'BFC 110, BOA');
  assertEquals(products[0]?.ecId, validRow[13]);
  assertEquals(products[0]?.ecUrl, validRow[14]);
});

Deno.test('product CSV parser rejects an invalid column count', () => {
  const csv = `${SOURCE_HEADERS.join(',')}\n${validRow.slice(0, 12).join(',')}\n`;
  try {
    parseShoeProductCsv(csv);
    throw new Error('Expected parser failure.');
  } catch (error) {
    assertEquals(error instanceof WorkbookValidationError, true);
    assertEquals((error as Error).message, '商品CSVの2行目は15列必要です。');
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
  assertEquals(sheet.getCell('V5').value, validRow[13]);
  assertEquals(sheet.getCell('W5').value, validRow[14]);
  assertEquals(sheet.columnCount, 23);
  assertEquals(sheet.autoFilter, 'A4:W5');
  assertEquals(sheet.getColumn(23).width, 70);
});

Deno.test('legacy CSV and unmatched EC joins produce empty EC fields', async () => {
  for (const legacy of [true, false]) {
    const headers = legacy ? LEGACY_SOURCE_HEADERS : SOURCE_HEADERS;
    const row = legacy ? validRow.slice(0, 13) : [...validRow.slice(0, 13), '', ''];
    const products = parseShoeProductCsv(`${headers.join(',')}\n${row.join(',')}\n`);
    assertEquals(products[0]?.ecId, '');
    assertEquals(products[0]?.ecUrl, '');
    const rows = step1ConvertSourceRows(products);
    assertEquals(rows[0]?.slice(21), ['', '']);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      await step2CreateMasterWorkbook(rows) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet('Master Data2026FW②')!;
    assertEquals(sheet.getCell('V5').text, '');
    assertEquals(sheet.getCell('W5').text, '');
  }
});

Deno.test('product CSV rejects partial EC schemas, swapped headers, and mismatched rows', () => {
  for (
    const headers of [
      SOURCE_HEADERS.slice(0, 14),
      [...LEGACY_SOURCE_HEADERS, 'EC-URL', 'EC-ID'],
      [...SOURCE_HEADERS, 'unexpected'],
    ]
  ) {
    assertThrows(
      () => parseShoeProductCsv(`${headers.join(',')}\n${validRow.join(',')}\n`),
      WorkbookValidationError,
      'ヘッダー',
    );
  }
  for (const headers of [LEGACY_SOURCE_HEADERS, SOURCE_HEADERS]) {
    const row = headers.length === 13 ? validRow : validRow.slice(0, 13);
    assertThrows(
      () => parseShoeProductCsv(`${headers.join(',')}\n${row.join(',')}\n`),
      WorkbookValidationError,
      `${headers.length}列必要`,
    );
  }
});

Deno.test('EC values are preserved as text including XML and formula-like characters', async () => {
  const ecId = '=1+1';
  const ecUrl = 'https://www.supersports.com/ja-jp/xebio/products/1?a=1&b=<test>';
  const products = parseShoeProductCsv(
    `${SOURCE_HEADERS.join(',')}\n${[...validRow.slice(0, 13), ecId, ecUrl].join(',')}\n`,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    await step2CreateMasterWorkbook(step1ConvertSourceRows(products)) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  const sheet = workbook.getWorksheet('Master Data2026FW②')!;
  assertEquals(sheet.getCell('V5').value, ecId);
  assertEquals(sheet.getCell('W5').value, ecUrl);
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
