import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import {
  createPickupList,
  createPickupListRecords,
  createPickupListWorkbook,
  parseSafeSizeWorkbook,
  parseStoreInventoryCsv,
  PICKUP_LIST_HEADERS,
  PICKUP_SUBMISSION_HEADERS,
  PickupListValidationError,
  SAFE_SIZE_HEADERS,
  STORE_INVENTORY_HEADERS,
} from './pickup_list.ts';

const inventoryCsv = `${STORE_INVENTORY_HEADERS.join(',')}
4900000000001,775,陸上シューズ,010,MODEL-A,ＡＳＩＣＳ,SHOE A,ＡＷ用陸上スパイク,ＡＷ走高飛スパイク,8507010,24.0,10309,店舗A
4900000000001,775,陸上シューズ,010,MODEL-A,ＡＳＩＣＳ,SHOE A,ＡＷ用陸上スパイク,ＡＷ走高飛スパイク,8507010,25.0,10309,店舗A
4900000000001,775,陸上シューズ,010,MODEL-A,ＡＳＩＣＳ,SHOE A,ＡＷ用陸上スパイク,ＡＷ走高飛スパイク,8507010,26.0,10319,店舗B
4900000000002,411,Ｍゴルフシューズ,789,MODEL-B,ecco,SHOE B,スパイクレス,スポーツ型ＳＰレス,8939789,27.0,10319,店舗B
4900000000002,411,Ｍゴルフシューズ,789,MODEL-B,ecco,SHOE B,スパイクレス,スポーツ型ＳＰレス,8939789,27.0,99999,対象外店舗
`;

async function safeSizeWorkbook(eans: readonly string[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('errors');
  sheet.addRow([...SAFE_SIZE_HEADERS]);
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
  const result = createPickupListRecords(
    inventory,
    new Set(['4900000000001', '4900000000002']),
  );
  assertEquals(result.matchedRows, 4);
  assertEquals(result.records.length, 2);
  assertEquals(result.records[0], {
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
  assertEquals(result.records[1]?.storeCode, '10319');
});

Deno.test('SafeSize workbook parser finds its 14-column header', async () => {
  const bytes = await safeSizeWorkbook(['4900000000001', '4900000000002']);
  const parsed = await parseSafeSizeWorkbook(bytes);
  assertEquals(parsed.sheetName, 'errors');
  assertEquals(parsed.inputRows, 2);
  assertEquals([...parsed.eans], ['4900000000001', '4900000000002']);
});

Deno.test('pickup workbook fills the approved submission layout', async () => {
  const result = await createPickupList(
    parseStoreInventoryCsv(inventoryCsv),
    await safeSizeWorkbook(['4900000000001', '4900000000002']),
  );
  assertEquals(result.inputRows, 2);
  assertEquals(result.matchedRows, 4);
  assertEquals(result.outputRows, 2);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    result.bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
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
    new URL('../docs/pickup_list_output.xlsx', import.meta.url),
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
    await createPickupListWorkbook(records, templateBytes) as unknown as Parameters<
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
  const bytes = await createPickupListWorkbook([{
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
