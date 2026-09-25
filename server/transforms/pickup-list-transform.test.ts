import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import {
  parseSafeSizeWorkbook,
  parseStoreInventoryCsv,
  PICKUP_LIST_HEADERS,
  PICKUP_SUBMISSION_HEADERS,
  PickupListValidationError,
  SAFE_SIZE_HEADERS,
  step1JoinInventoryWithErrors,
  step2RemoveDuplicateProducts,
  step3CreateSubmissionWorkbook,
  STORE_INVENTORY_HEADERS,
} from './pickup-list-transform.ts';

const inventoryCsv = `${STORE_INVENTORY_HEADERS.join(',')}
4900000000001,775,陸上シューズ,010,MODEL-A,ＡＳＩＣＳ,SHOE A,ＡＷ用陸上スパイク,ＡＷ走高飛スパイク,8507010,24.0,10309,店舗A
4900000000001,775,陸上シューズ,010,MODEL-A,ＡＳＩＣＳ,SHOE A,ＡＷ用陸上スパイク,ＡＷ走高飛スパイク,8507010,25.0,10309,店舗A
4900000000001,775,陸上シューズ,010,MODEL-A,ＡＳＩＣＳ,SHOE A,ＡＷ用陸上スパイク,ＡＷ走高飛スパイク,8507010,26.0,10319,店舗B
4900000000002,411,Ｍゴルフシューズ,789,MODEL-B,ecco,SHOE B,スパイクレス,スポーツ型ＳＰレス,8939789,27.0,10319,店舗B
4900000000002,411,Ｍゴルフシューズ,789,MODEL-B,ecco,SHOE B,スパイクレス,スポーツ型ＳＰレス,8939789,27.0,99999,対象外店舗
`;

async function safeSizeWorkbook(
  eans: readonly ExcelJS.CellValue[],
  headers: readonly string[] = SAFE_SIZE_HEADERS,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('errors');
  sheet.addRow([...headers]);
  eans.forEach((ean) => sheet.addRow([ean]));
  return Uint8Array.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array);
}

function conditionalFormattings(
  sheet: ExcelJS.Worksheet,
): Array<{ ref: string; rules: Array<{ type: string }> }> {
  return (sheet as unknown as {
    conditionalFormattings: Array<{ ref: string; rules: Array<{ type: string }> }>;
  }).conditionalFormattings;
}

function cellValue(cell: ExcelJS.Cell): unknown {
  return cell.formula ? { formula: cell.formula, result: cell.result } : cell.value;
}

Deno.test('pickup list follows inventory order and removes duplicate internal codes', () => {
  const inventory = parseStoreInventoryCsv(inventoryCsv);
  assertEquals(inventory.length, 4);
  const joined = step1JoinInventoryWithErrors(
    inventory,
    new Set(['4900000000001', '4900000000002']),
  );
  const records = step2RemoveDuplicateProducts(joined);
  assertEquals(joined.length, 4);
  assertEquals(records.length, 2);
  assertEquals(records[0], {
    department: '775',
    departmentName: '陸上シューズ',
    threeDigitCode: '010',
    manufacturerModel: 'MODEL-A',
    brand: 'ＡＳＩＣＳ',
    productName: 'SHOE A',
    categoryName: 'ＡＷ用陸上スパイク',
    itemName: 'ＡＷ走高飛スパイク',
    internalCode: '8507010',
    storeCode: '10309',
    storeName: '店舗A',
  });
  assertEquals(records[1]?.storeCode, '10319');
});

Deno.test('SafeSize workbook parser finds its 14-column header', async () => {
  const bytes = await safeSizeWorkbook(['4900000000001', '4900000000002']);
  const parsed = await parseSafeSizeWorkbook(bytes);
  assertEquals(parsed.sheetName, 'errors');
  assertEquals(parsed.inputRows, 2);
  assertEquals([...parsed.eans], ['4900000000001', '4900000000002']);
});

Deno.test('SafeSize workbook parser accepts an EAN-only scan list', async () => {
  const bytes = await safeSizeWorkbook(['0196222995795', 196222995795, 4068818003251], ['EAN']);
  const parsed = await parseSafeSizeWorkbook(bytes);
  assertEquals(parsed.sheetName, 'errors');
  assertEquals(parsed.inputRows, 3);
  assertEquals([...parsed.eans], ['0196222995795', '4068818003251']);
});

for (const headers of [SAFE_SIZE_HEADERS, [' \u200Bean\u3000']]) {
  Deno.test(`SafeSize parser reads sparse rows with ${headers.length} header columns`, async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('notes').addRow(['メモ']);
    const sheet = workbook.addWorksheet('scanlist');
    sheet.getRow(100).values = [...headers];
    sheet.getCell('A101').value = '4900000000001';
    sheet.getCell('A104').value = '4900000000002';
    sheet.getCell('B104').numFmt = '@';
    const bytes = Uint8Array.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array);
    const parsed = await parseSafeSizeWorkbook(bytes);
    assertEquals(parsed.sheetName, 'scanlist');
    assertEquals(parsed.inputRows, 2);
    assertEquals([...parsed.eans], ['4900000000001', '4900000000002']);
  });
}

Deno.test('EAN-only scan lists reject invalid or missing EAN data', async () => {
  const invalid = await safeSizeWorkbook(['not-an-ean'], ['EAN']);
  await assertRejects(
    () => parseSafeSizeWorkbook(invalid),
    PickupListValidationError,
    '「errors」シートの2行目のEANは数字のみで入力してください。',
  );
  const empty = await safeSizeWorkbook([], ['EAN']);
  await assertRejects(
    () => parseSafeSizeWorkbook(empty),
    PickupListValidationError,
    'エラーリストにEANのデータ行がありません。',
  );
});

Deno.test('pickup workbook fills the approved submission layout', async () => {
  const inventory = parseStoreInventoryCsv(inventoryCsv);
  const errorData = await parseSafeSizeWorkbook(
    await safeSizeWorkbook(['4900000000001', '4900000000002']),
  );
  const joined = step1JoinInventoryWithErrors(inventory, errorData.eans);
  const records = step2RemoveDuplicateProducts(joined);
  const bytes = await step3CreateSubmissionWorkbook(records);
  assertEquals(errorData.inputRows, 2);
  assertEquals(joined.length, 4);
  assertEquals(records.length, 2);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  assertEquals(workbook.worksheets.map((sheet) => sheet.name), ['集計表', 'ピックアップ']);
  const sheet = workbook.getWorksheet('ピックアップ');
  if (!sheet) throw new Error('Pickup list worksheet was not generated.');
  assertEquals(
    Array.from(
      { length: PICKUP_SUBMISSION_HEADERS.length },
      (_, index) => sheet.getCell(2, index + 1).value,
    ),
    [...PICKUP_SUBMISSION_HEADERS],
  );
  assertEquals(
    Array.from(
      { length: PICKUP_LIST_HEADERS.length },
      (_, index) => sheet.getCell(3, index + 8).value,
    ),
    [
      '775',
      '陸上シューズ',
      '010',
      'MODEL-A',
      'ＡＳＩＣＳ',
      'SHOE A',
      'ＡＷ用陸上スパイク',
      'ＡＷ走高飛スパイク',
      '8507010',
      '10309',
      '店舗A',
    ],
  );
  assertEquals(sheet.getCell('G3').value, 1);
  assertEquals(sheet.getCell('G4').result, 2);
  assertEquals(sheet.getCell('F3').formula, 'IF(COUNTA(B3:E3)=4, "完了", "")');
  assertEquals(workbook.getWorksheet('集計表')?.getCell('B5').result, 2);
  assertEquals(workbook.getWorksheet('集計表')?.getCell('B7').result, 2);
});

Deno.test('pickup workbook preserves the complete submission template format', async () => {
  const templateBytes = await Deno.readFile(
    new URL('../data/pickup-list-template.xlsx', import.meta.url),
  );
  const template = new ExcelJS.Workbook();
  await template.xlsx.load(
    templateBytes as unknown as Parameters<typeof template.xlsx.load>[0],
  );
  const templateOutput = template.getWorksheet('ピックアップ');
  if (!templateOutput) throw new Error('Template output sheet was not found.');

  const records = Array.from({ length: 31 }, (_, index) => {
    const row = index + 3;
    return {
      department: String(templateOutput.getCell(row, 8).value ?? ''),
      departmentName: String(templateOutput.getCell(row, 9).value ?? ''),
      threeDigitCode: String(templateOutput.getCell(row, 10).value ?? ''),
      manufacturerModel: String(templateOutput.getCell(row, 11).value ?? ''),
      brand: String(templateOutput.getCell(row, 12).value ?? ''),
      productName: String(templateOutput.getCell(row, 13).value ?? ''),
      categoryName: String(templateOutput.getCell(row, 14).value ?? ''),
      itemName: String(templateOutput.getCell(row, 15).value ?? ''),
      internalCode: String(templateOutput.getCell(row, 16).value ?? ''),
      storeCode: String(templateOutput.getCell(row, 17).value ?? ''),
      storeName: String(templateOutput.getCell(row, 18).value ?? ''),
    };
  });
  const generated = new ExcelJS.Workbook();
  await generated.xlsx.load(
    await step3CreateSubmissionWorkbook(records, templateBytes) as unknown as Parameters<
      typeof generated.xlsx.load
    >[0],
  );
  const expectedWorkbook = new ExcelJS.Workbook();
  await expectedWorkbook.xlsx.load(
    templateBytes as unknown as Parameters<typeof expectedWorkbook.xlsx.load>[0],
  );

  assertEquals(generated.worksheets.map((sheet) => sheet.name), ['集計表', 'ピックアップ']);
  for (const sheetName of ['集計表', 'ピックアップ']) {
    const expected = expectedWorkbook.getWorksheet(sheetName);
    const actual = generated.getWorksheet(sheetName);
    if (!expected || !actual) throw new Error(`${sheetName} was not generated.`);
    assertEquals(actual.dimensions, expected.dimensions);
    assertEquals(actual.autoFilter, expected.autoFilter);
    assertEquals(actual.views, expected.views);
    if (sheetName === 'ピックアップ') {
      const formatting = conditionalFormattings(actual);
      assertEquals(formatting.length, 1);
      assertEquals(formatting[0]?.ref, 'P1:P816 P893:P1048576');
    }
    for (let column = 1; column <= expected.columnCount; column++) {
      assertEquals(actual.getColumn(column).width, expected.getColumn(column).width);
    }
    for (let row = 1; row <= expected.rowCount; row++) {
      assertEquals(actual.getRow(row).height, expected.getRow(row).height);
      for (let column = 1; column <= expected.columnCount; column++) {
        const expectedCell = expected.getCell(row, column);
        const actualCell = actual.getCell(row, column);
        assertEquals(cellValue(actualCell), cellValue(expectedCell));
        assertEquals(actualCell.style, expectedCell.style);
      }
    }
  }
});

Deno.test('pickup workbook preserves a valid duplicate-value formatting rule', async () => {
  const bytes = await step3CreateSubmissionWorkbook([{
    department: '302',
    departmentName: 'Ｍスキーブーツ',
    threeDigitCode: '012',
    manufacturerModel: 'KS240068 BFC 110 BOA',
    brand: 'K2',
    productName: 'BFC 110 BOA',
    categoryName: 'レギュラーブーツ',
    itemName: 'フリーライドブーツ',
    internalCode: '8692462',
    storeCode: '10309',
    storeName: 'テスト店舗',
  }]);
  const archive = unzipSync(bytes);
  const worksheetXmls = Object.entries(archive)
    .filter(([path]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .map(([, content]) => strFromU8(content));
  const pickupXml = worksheetXmls.find((xml) => xml.includes('sqref="P1:P816 P893:P1048576"'));
  if (!pickupXml) throw new Error('Pickup list worksheet XML was not generated.');

  assertStringIncludes(
    pickupXml,
    '<cfRule type="duplicateValues" dxfId="0" priority="1"/>',
  );
  assertEquals(
    pickupXml.includes('<conditionalFormatting sqref="P1:P816 P893:P1048576"/>'),
    false,
  );
});

Deno.test('SafeSize workbook without the required headers is rejected', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('wrong').addRow(['EAN', '別フォーマット']);
  const bytes = Uint8Array.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array);
  await assertRejects(
    () => parseSafeSizeWorkbook(bytes),
    PickupListValidationError,
    'エラーリストのヘッダーが見つかりません。',
  );
});
