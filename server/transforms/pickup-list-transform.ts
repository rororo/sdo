import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseCsv } from '../utils/csv.ts';

export const STORE_INVENTORY_HEADERS = [
  'スキャンコード',
  '部門コード',
  '部門名',
  '３桁',
  '自社メーカー品番',
  'ブランド名',
  '商品名',
  '品種名',
  '品目名',
  '自社品番',
  'サイズ名',
  '店舗コード',
  '店舗名',
] as const;

export const SAFE_SIZE_HEADERS = [
  'EAN',
  'SAFESIZE ARTICLE',
  'BRAND',
  'Manufacturer shoe model ID with color code',
  'Commercial name of the shoe',
  'Female, Male, Unisex',
  'Adult, Child',
  'Size ',
  'SizeSys',
  'Sport category',
  'Season',
  'Style ID / Model Id / Article',
  'Retailer internal code',
  'SPIKE',
] as const;

// The zero-width spaces are present in the approved submission workbook headers.
export const PICKUP_LIST_HEADERS = [
  '部門',
  '部門名',
  '3桁',
  'メーカー品番',
  'ブランド\u200B',
  '商品名',
  '品種名\u200B',
  '品目名\u200B',
  '自社品番\u200B',
  '店舗',
  '店舗名',
] as const;

export const PICKUP_SUBMISSION_HEADERS = [
  'コメント',
  'ピックアップ',
  'スキャン',
  'データ登録',
  '返却',
  '完了済',
  'No.',
  ...PICKUP_LIST_HEADERS,
] as const;

export const TARGET_STORE_CODES = new Set(['10309', '10319']);

const OUTPUT_SHEET_NAME = 'ピックアップ';
const SUMMARY_SHEET_NAME = '集計表';
const TEMPLATE_FIRST_DATA_ROW = 3;
const TEMPLATE_LAST_DATA_ROW = 814;
const TEMPLATE_MAX_RECORDS = TEMPLATE_LAST_DATA_ROW - TEMPLATE_FIRST_DATA_ROW + 1;
const DUPLICATE_FORMATTING_RANGE = 'P1:P816 P893:P1048576';
const EMPTY_DUPLICATE_FORMATTING = `<conditionalFormatting sqref="${DUPLICATE_FORMATTING_RANGE}"/>`;
const DUPLICATE_FORMATTING = `<conditionalFormatting sqref="${DUPLICATE_FORMATTING_RANGE}">` +
  '<cfRule type="duplicateValues" dxfId="0" priority="1"/>' +
  '</conditionalFormatting>';

export interface StoreInventoryRecord {
  ean: string;
  department: string;
  departmentName: string;
  threeDigitCode: string;
  manufacturerModel: string;
  brand: string;
  productName: string;
  categoryName: string;
  itemName: string;
  internalCode: string;
  sizeName: string;
  storeCode: string;
  storeName: string;
}

export interface PickupListRecord {
  department: string;
  departmentName: string;
  threeDigitCode: string;
  manufacturerModel: string;
  brand: string;
  productName: string;
  categoryName: string;
  itemName: string;
  internalCode: string;
  storeCode: string;
  storeName: string;
}

export interface SafeSizeErrorData {
  eans: ReadonlySet<string>;
  inputRows: number;
  sheetName: string;
}

export class PickupListValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PickupListValidationError';
  }
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value.toFixed(0) : String(value);
  }
  if (typeof value === 'object') {
    if ('result' in value) return textValue(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((run) =>
        typeof run === 'object' && run !== null && 'text' in run ? String(run.text) : ''
      ).join('');
    }
    if ('text' in value) return String(value.text);
  }
  return String(value);
}

function normalizedHeader(value: unknown): string {
  return textValue(value)
    .normalize('NFKC')
    .replaceAll('\u200B', '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeEan(value: unknown, rowLabel: string): string {
  const source = textValue(value).normalize('NFKC').trim();
  const match = /^(\d+)(?:\.0+)?$/.exec(source);
  if (!match?.[1]) {
    throw new PickupListValidationError(`${rowLabel}のEANは数字のみで入力してください。`);
  }
  return match[1].padStart(13, '0');
}

export function parseStoreInventoryCsv(text: string): StoreInventoryRecord[] {
  const rows = parseCsv(text, '店舗在庫CSV');
  const header = rows.shift();
  if (
    !header || header.length !== STORE_INVENTORY_HEADERS.length ||
    header.some((value, index) =>
      normalizedHeader(value) !== normalizedHeader(STORE_INVENTORY_HEADERS[index])
    )
  ) {
    throw new PickupListValidationError(
      `店舗在庫CSVのヘッダーは「${STORE_INVENTORY_HEADERS.join('、')}」の順にしてください。`,
    );
  }

  const records: StoreInventoryRecord[] = [];
  rows.forEach((row, index) => {
    const csvRow = index + 2;
    if (row.length !== STORE_INVENTORY_HEADERS.length) {
      throw new PickupListValidationError(
        `店舗在庫CSVの${csvRow}行目は${STORE_INVENTORY_HEADERS.length}列必要です。`,
      );
    }
    const storeCode = row[11]!.trim();
    if (!TARGET_STORE_CODES.has(storeCode)) return;
    const internalCode = row[9]!.trim();
    if (!internalCode) {
      throw new PickupListValidationError(
        `店舗在庫CSVの${csvRow}行目に自社品番がありません。`,
      );
    }
    records.push({
      ean: normalizeEan(row[0], `店舗在庫CSVの${csvRow}行目`),
      department: row[1]!,
      departmentName: row[2]!,
      threeDigitCode: row[3]!,
      manufacturerModel: row[4]!,
      brand: row[5]!,
      productName: row[6]!,
      categoryName: row[7]!,
      itemName: row[8]!,
      internalCode,
      sizeName: row[10]!,
      storeCode,
      storeName: row[12]!,
    });
  });

  if (records.length === 0) {
    throw new PickupListValidationError('店舗在庫CSVに対象店舗のデータがありません。');
  }
  return records;
}

function findSafeSizeHeader(workbook: ExcelJS.Workbook): {
  sheet: ExcelJS.Worksheet;
  rowNumber: number;
} | null {
  for (const sheet of workbook.worksheets) {
    const headers = sheet.actualColumnCount === 1 ? ['EAN'] : SAFE_SIZE_HEADERS;
    const lastCandidateRow = Math.min(sheet.rowCount, 100);
    for (let rowNumber = 1; rowNumber <= lastCandidateRow; rowNumber++) {
      const matches = headers.every((header, index) =>
        normalizedHeader(sheet.getCell(rowNumber, index + 1).value) === normalizedHeader(header)
      );
      if (matches) return { sheet, rowNumber };
    }
  }
  return null;
}

export async function parseSafeSizeWorkbook(bytes: Uint8Array): Promise<SafeSizeErrorData> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch (error) {
    throw new PickupListValidationError(
      'エラーリストを読み込めません。Excel（.xlsx）ファイルを確認してください。',
      { cause: error },
    );
  }

  const header = findSafeSizeHeader(workbook);
  if (!header) {
    throw new PickupListValidationError(
      'エラーリストのヘッダーが見つかりません。A列が「EAN」の1列形式、またはSafeSizeの14列形式のExcelファイルを選択してください。',
    );
  }

  const eans = new Set<string>();
  let inputRows = 0;
  const lastRow = header.sheet.rowCount;
  for (let rowNumber = header.rowNumber + 1; rowNumber <= lastRow; rowNumber++) {
    const value = header.sheet.getCell(rowNumber, 1).value;
    if (textValue(value).trim() === '') continue;
    eans.add(normalizeEan(value, `「${header.sheet.name}」シートの${rowNumber}行目`));
    inputRows++;
  }
  if (inputRows === 0) {
    throw new PickupListValidationError('エラーリストにEANのデータ行がありません。');
  }
  return { eans, inputRows, sheetName: header.sheet.name };
}

export function step1JoinInventoryWithErrors(
  inventory: readonly StoreInventoryRecord[],
  errorEans: ReadonlySet<string>,
): PickupListRecord[] {
  const records: PickupListRecord[] = [];

  for (const item of inventory) {
    if (!TARGET_STORE_CODES.has(item.storeCode) || !errorEans.has(item.ean)) continue;
    records.push({
      department: item.department,
      departmentName: item.departmentName,
      threeDigitCode: item.threeDigitCode,
      manufacturerModel: item.manufacturerModel,
      brand: item.brand,
      productName: item.productName,
      categoryName: item.categoryName,
      itemName: item.itemName,
      internalCode: item.internalCode,
      storeCode: item.storeCode,
      storeName: item.storeName,
    });
  }
  return records;
}

export function step2RemoveDuplicateProducts(
  joinedRecords: readonly PickupListRecord[],
): PickupListRecord[] {
  const records: PickupListRecord[] = [];
  const seenInternalCodes = new Set<string>();
  for (const record of joinedRecords) {
    if (seenInternalCodes.has(record.internalCode)) continue;
    seenInternalCodes.add(record.internalCode);
    records.push(record);
  }
  return records;
}

function recordValues(record: PickupListRecord): string[] {
  return [
    record.department,
    record.departmentName,
    record.threeDigitCode,
    record.manufacturerModel,
    record.brand,
    record.productName,
    record.categoryName,
    record.itemName,
    record.internalCode,
    record.storeCode,
    record.storeName,
  ];
}

export function createPickupSubmissionRows(
  records: readonly PickupListRecord[],
): Array<Array<string | number>> {
  return records.map((record, index) => [
    '',
    '',
    '',
    '',
    '',
    '',
    index + 1,
    ...recordValues(record),
  ]);
}

async function loadPickupTemplate(templateBytes?: Uint8Array): Promise<ExcelJS.Workbook> {
  let bytes = templateBytes;
  if (!bytes) {
    const candidates = [
      new URL('./data/pickup-list-template.xlsx', import.meta.url),
      new URL('../data/pickup-list-template.xlsx', import.meta.url),
    ];
    for (const candidate of candidates) {
      try {
        bytes = await Deno.readFile(candidate);
        break;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }
  if (!bytes) throw new Error('Pickup-list submission template was not found.');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}

function requireSubmissionSheets(workbook: ExcelJS.Workbook): {
  summary: ExcelJS.Worksheet;
  output: ExcelJS.Worksheet;
} {
  const summary = workbook.getWorksheet(SUMMARY_SHEET_NAME);
  const output = workbook.getWorksheet(OUTPUT_SHEET_NAME);
  if (!summary || !output) {
    throw new Error('Pickup-list submission template sheets are invalid.');
  }
  const headers = Array.from(
    { length: PICKUP_SUBMISSION_HEADERS.length },
    (_, index) => textValue(output.getCell(2, index + 1).value),
  );
  if (headers.some((header, index) => header !== PICKUP_SUBMISSION_HEADERS[index])) {
    throw new Error('Pickup-list submission template headers are invalid.');
  }
  return { summary, output };
}

function restoreDuplicateFormatting(bytes: Uint8Array): Uint8Array {
  const archive = unzipSync(bytes);
  let restored = false;

  for (const [path, content] of Object.entries(archive)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    const xml = strFromU8(content);
    if (!xml.includes(EMPTY_DUPLICATE_FORMATTING)) continue;
    archive[path] = strToU8(xml.replace(EMPTY_DUPLICATE_FORMATTING, DUPLICATE_FORMATTING));
    restored = true;
  }

  if (!restored) {
    throw new Error('Pickup-list submission template formatting could not be restored.');
  }

  return zipSync(archive, { level: 6 });
}

export async function step3CreateSubmissionWorkbook(
  records: readonly PickupListRecord[],
  templateBytes?: Uint8Array,
): Promise<Uint8Array> {
  if (records.length > TEMPLATE_MAX_RECORDS) {
    throw new PickupListValidationError(
      `提出フォーマットへ出力できる商品は${TEMPLATE_MAX_RECORDS}件までです。`,
    );
  }

  const workbook = await loadPickupTemplate(templateBytes);
  const { summary, output } = requireSubmissionSheets(workbook);

  for (let row = TEMPLATE_FIRST_DATA_ROW; row <= TEMPLATE_LAST_DATA_ROW; row++) {
    output.getCell(row, 7).value = null;
    for (let column = 8; column <= PICKUP_SUBMISSION_HEADERS.length; column++) {
      output.getCell(row, column).value = null;
    }
  }

  records.forEach((record, index) => {
    const rowNumber = TEMPLATE_FIRST_DATA_ROW + index;
    output.getCell(rowNumber, 7).value = index === 0
      ? 1
      : { formula: `G${rowNumber - 1}+1`, result: index + 1 };
    recordValues(record).forEach((value, valueIndex) => {
      output.getCell(rowNumber, valueIndex + 8).value = value;
    });
  });

  const totalFormula = summary.getCell('B5').formula;
  const remainingFormula = summary.getCell('B7').formula;
  if (!totalFormula || !remainingFormula) {
    throw new Error('Pickup-list submission template formulas are invalid.');
  }
  summary.getCell('B5').value = { formula: totalFormula, result: records.length };
  summary.getCell('B7').value = { formula: remainingFormula, result: records.length };

  const workbookOutput = await workbook.xlsx.writeBuffer();
  return restoreDuplicateFormatting(
    Uint8Array.from(workbookOutput as unknown as Uint8Array),
  );
}
