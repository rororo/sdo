import { assertEquals } from '@std/assert';
import {
  parseSafeSizeWorkbook,
  parseStoreInventoryCsv,
  PICKUP_LIST_HEADERS,
  step1JoinInventoryWithErrors,
  step2RemoveDuplicateProducts,
  step3CreateSubmissionWorkbook,
  STORE_INVENTORY_HEADERS,
} from '../server/transforms/pickup-list-transform.ts';
import {
  assertWorksheetValuesEqual,
  loadWorkbook,
  requireWorksheet,
  worksheetRangeAsCsv,
} from './workbook-test-utils.ts';

const FIXTURE = new URL('./pickup-list.xlsx', import.meta.url);
const INVENTORY_SHEET = 'base1_在庫抽出データ';
const EXPECTED_SHEET = 'step2_結合データ商品重複削除(ピックアップリスト)';
const INVENTORY_FIRST_ROW = 1;
const INVENTORY_LAST_ROW = 19_523;
const EXPECTED_INPUT_ROWS = 4_618;
const EXPECTED_MATCHED_ROWS = 263;
const EXPECTED_OUTPUT_ROWS = 31;
const TEXT_COLUMNS = new Set(
  Array.from({ length: PICKUP_LIST_HEADERS.length }, (_, index) => index + 1),
);

Deno.test('pickup list transform matches every row in the real workbook', async () => {
  const fixtureBytes = await Deno.readFile(FIXTURE);
  const fixture = await loadWorkbook(fixtureBytes);
  const inventorySheet = requireWorksheet(fixture, INVENTORY_SHEET);
  const expected = requireWorksheet(fixture, EXPECTED_SHEET);
  const inventoryCsv = worksheetRangeAsCsv(
    inventorySheet,
    INVENTORY_FIRST_ROW,
    INVENTORY_LAST_ROW,
    STORE_INVENTORY_HEADERS.length,
  );
  const inventory = parseStoreInventoryCsv(inventoryCsv);

  const errorData = await parseSafeSizeWorkbook(fixtureBytes);
  const joined = step1JoinInventoryWithErrors(inventory, errorData.eans);
  const records = step2RemoveDuplicateProducts(joined);
  const bytes = await step3CreateSubmissionWorkbook(records);

  assertEquals(errorData.inputRows, EXPECTED_INPUT_ROWS);
  assertEquals(joined.length, EXPECTED_MATCHED_ROWS);
  assertEquals(records.length, EXPECTED_OUTPUT_ROWS);

  const generated = await loadWorkbook(bytes);
  const actual = requireWorksheet(generated, 'ピックアップ');
  assertWorksheetValuesEqual(actual, expected, {
    actualFirstRow: 3,
    expectedFirstRow: 2,
    rowCount: EXPECTED_OUTPUT_ROWS,
    columnCount: PICKUP_LIST_HEADERS.length,
    actualFirstColumn: 8,
    textColumns: TEXT_COLUMNS,
  });

  assertEquals(actual.getCell('G3').value, 1);
  assertEquals(actual.getCell('G33').result, EXPECTED_OUTPUT_ROWS);
  assertEquals(requireWorksheet(generated, '集計表').getCell('B5').result, EXPECTED_OUTPUT_ROWS);
});
