import { assertEquals } from '@std/assert';
import {
  LEGACY_SOURCE_HEADERS,
  OUTPUT_HEADERS,
  parseShoeProductCsv,
  step1ConvertSourceRows,
  step2CreateMasterWorkbook,
} from '../server/transforms/shoes-master-transform.ts';
import {
  assertWorksheetValuesEqual,
  loadWorkbook,
  requireWorksheet,
  worksheetRangeAsCsv,
} from './workbook-test-utils.ts';

const FIXTURE = new URL('./shoes-master.xlsx', import.meta.url);
const SOURCE_SHEET = '（作業用）抽出データ貼り付け＆加工';
const OUTPUT_SHEET = 'Master Data2026FW②';
const SOURCE_FIRST_ROW = 2;
const SOURCE_LAST_ROW = 61_765;
const OUTPUT_FIRST_ROW = 5;
const EXPECTED_ROWS = 61_763;
const TEXT_COLUMNS = new Set(
  Array.from({ length: OUTPUT_HEADERS.length }, (_, index) => index + 1).filter(
    (column) => column !== 7,
  ),
);

Deno.test('shoe master transform matches every row in the real workbook', async () => {
  const fixture = await loadWorkbook(FIXTURE);
  const source = requireWorksheet(fixture, SOURCE_SHEET);
  const expected = requireWorksheet(fixture, OUTPUT_SHEET);
  const sourceCsv = worksheetRangeAsCsv(
    source,
    SOURCE_FIRST_ROW,
    SOURCE_LAST_ROW,
    LEGACY_SOURCE_HEADERS.length,
  );

  const rows = step1ConvertSourceRows(parseShoeProductCsv(sourceCsv));
  const bytes = await step2CreateMasterWorkbook(rows);

  assertEquals(rows.length, EXPECTED_ROWS);
  const actualWorkbook = await loadWorkbook(bytes);
  assertEquals(actualWorkbook.worksheets.map((sheet) => sheet.name), [OUTPUT_SHEET]);
  const actual = requireWorksheet(actualWorkbook, OUTPUT_SHEET);
  assertEquals(
    Array.from(
      { length: OUTPUT_HEADERS.length },
      (_, index) => actual.getCell(4, index + 1).value,
    ),
    [...OUTPUT_HEADERS],
  );
  assertWorksheetValuesEqual(actual, expected, {
    actualFirstRow: OUTPUT_FIRST_ROW,
    expectedFirstRow: OUTPUT_FIRST_ROW,
    rowCount: EXPECTED_ROWS,
    columnCount: OUTPUT_HEADERS.length,
    textColumns: TEXT_COLUMNS,
  });
});
