import ExcelJS from 'exceljs';
import { assertEquals } from '@std/assert';

export type ComparableCellValue = string | number | boolean | Date | null;

export async function loadWorkbook(source: string | URL | Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  if (source instanceof Uint8Array) {
    await workbook.xlsx.load(
      source as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } else {
    await workbook.xlsx.readFile(source instanceof URL ? source.pathname : source);
  }
  return workbook;
}

export function requireWorksheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
): ExcelJS.Worksheet {
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error(`Worksheet not found: ${sheetName}`);
  return worksheet;
}

export function comparableCellValue(value: unknown): ComparableCellValue {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'object') {
    if ('result' in value) return comparableCellValue(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((run) =>
        typeof run === 'object' && run !== null && 'text' in run ? String(run.text) : ''
      ).join('');
    }
    if ('text' in value) return String(value.text);
  }
  return String(value);
}

function comparableTextCellValue(value: unknown): string | null {
  const comparable = comparableCellValue(value);
  if (comparable === null) return null;
  return comparable instanceof Date ? comparable.toISOString() : String(comparable);
}

function csvCell(value: unknown): string {
  const cellValue = comparableCellValue(value);
  const text = cellValue === null
    ? ''
    : cellValue instanceof Date
    ? cellValue.toISOString()
    : String(cellValue);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function worksheetRangeAsCsv(
  worksheet: ExcelJS.Worksheet,
  firstRow: number,
  lastRow: number,
  columnCount: number,
): string {
  const rows: string[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    rows.push(
      Array.from(
        { length: columnCount },
        (_, index) => csvCell(worksheet.getCell(row, index + 1).value),
      ).join(','),
    );
  }
  return `${rows.join('\n')}\n`;
}

export function assertWorksheetValuesEqual(
  actual: ExcelJS.Worksheet,
  expected: ExcelJS.Worksheet,
  options: {
    actualFirstRow: number;
    expectedFirstRow: number;
    rowCount: number;
    columnCount: number;
    actualFirstColumn?: number;
    expectedFirstColumn?: number;
    textColumns?: ReadonlySet<number>;
  },
): void {
  for (let rowOffset = 0; rowOffset < options.rowCount; rowOffset++) {
    for (let columnOffset = 0; columnOffset < options.columnCount; columnOffset++) {
      const actualRow = options.actualFirstRow + rowOffset;
      const expectedRow = options.expectedFirstRow + rowOffset;
      const actualColumn = (options.actualFirstColumn ?? 1) + columnOffset;
      const expectedColumn = (options.expectedFirstColumn ?? 1) + columnOffset;
      const isTextColumn = options.textColumns?.has(columnOffset + 1) ?? false;
      assertEquals(
        isTextColumn
          ? comparableTextCellValue(actual.getCell(actualRow, actualColumn).value)
          : comparableCellValue(actual.getCell(actualRow, actualColumn).value),
        isTextColumn
          ? comparableTextCellValue(expected.getCell(expectedRow, expectedColumn).value)
          : comparableCellValue(expected.getCell(expectedRow, expectedColumn).value),
        `Cell mismatch: actual ${actual.name}!${
          actual.getCell(actualRow, actualColumn).address
        }, ` +
          `expected ${expected.name}!${expected.getCell(expectedRow, expectedColumn).address}`,
      );
    }
  }
}
