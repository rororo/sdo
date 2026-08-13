import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  parseShoeProductCsv,
  type ShoeProductRecord,
  validateShoeProducts,
  WorkbookValidationError,
} from './transformer.ts';

const DEFAULT_BUCKET = 'scanalytics-report';
const DEFAULT_REGION = 'ap-northeast-1';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CSV_BYTES = 50 * 1024 * 1024;

export interface ShoeDataset {
  records: readonly ShoeProductRecord[];
  bucket: string;
  key: string;
  etag: string | null;
  lastModified: string | null;
  loadedAt: string;
}

export interface ShoeDataSource {
  getDataset(): Promise<ShoeDataset>;
}

interface S3Reader {
  send(command: GetObjectCommand): Promise<{
    Body?: { transformToString(encoding?: string): Promise<string> };
    ContentLength?: number;
    ETag?: string;
    LastModified?: Date;
  }>;
}

export class ShoeDataSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ShoeDataSourceError';
  }
}

function jstYearMonth(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new ShoeDataSourceError('JSTの対象期間を計算できませんでした。');
  }
  return { year, month };
}

function period(year: number, month: number): string {
  return `${year}${String(month).padStart(2, '0')}`;
}

export function currentShoeProductKey(now = new Date()): string {
  const { year, month } = jstYearMonth(now);
  let first: string;
  let second: string;
  if (month <= 3) {
    first = period(year, 3);
    second = period(year, 9);
  } else if (month <= 9) {
    first = period(year, 9);
    second = period(year + 1, 3);
  } else {
    first = period(year + 1, 3);
    second = period(year + 1, 9);
  }
  return `sdo/shoe_products/kiukkn=${first}_${second}/shoe_products.csv`;
}

export class S3ShoeDataSource implements ShoeDataSource {
  #cached: ShoeDataset | null = null;

  constructor(
    private readonly client: S3Reader,
    private readonly bucket = DEFAULT_BUCKET,
    private readonly keyOverride?: string,
    private readonly now: () => Date = () => new Date(),
    private readonly cacheTtlMs = CACHE_TTL_MS,
  ) {}

  async getDataset(): Promise<ShoeDataset> {
    const now = this.now();
    const key = this.keyOverride || currentShoeProductKey(now);
    if (
      this.#cached?.key === key &&
      now.getTime() - Date.parse(this.#cached.loadedAt) < this.cacheTtlMs
    ) {
      return this.#cached;
    }

    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!object.Body) throw new Error('S3 object body is empty.');
      if (object.ContentLength !== undefined && object.ContentLength > MAX_CSV_BYTES) {
        throw new ShoeDataSourceError('商品CSVが50MBを超えています。');
      }
      const records = parseShoeProductCsv(await object.Body.transformToString('utf-8'));
      validateShoeProducts(records);
      const dataset: ShoeDataset = Object.freeze({
        records: Object.freeze(records),
        bucket: this.bucket,
        key,
        etag: object.ETag?.replace(/^"|"$/g, '') ?? null,
        lastModified: object.LastModified?.toISOString() ?? null,
        loadedAt: now.toISOString(),
      });
      this.#cached = dataset;
      return dataset;
    } catch (error) {
      if (error instanceof ShoeDataSourceError || error instanceof WorkbookValidationError) {
        throw error;
      }
      throw new ShoeDataSourceError(
        '商品データを取得できませんでした。しばらくしてから再試行してください。',
        { cause: error },
      );
    }
  }
}

export function createShoeDataSource(): ShoeDataSource {
  const region = Deno.env.get('AWS_REGION')?.trim() || DEFAULT_REGION;
  const bucket = Deno.env.get('SHOE_DATA_BUCKET')?.trim() || DEFAULT_BUCKET;
  const key = Deno.env.get('SHOE_DATA_KEY')?.trim() || undefined;
  return new S3ShoeDataSource(new S3Client({ region }), bucket, key);
}
