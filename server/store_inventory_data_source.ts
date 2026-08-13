import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  parseStoreInventoryCsv,
  PickupListValidationError,
  type StoreInventoryRecord,
} from './pickup_list.ts';

const DEFAULT_BUCKET = 'scanalytics-report';
const DEFAULT_REGION = 'ap-northeast-1';
const DEFAULT_KEY = 'sdo/shoe_store_inventory/shoe_store_inventory.csv';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CSV_BYTES = 50 * 1024 * 1024;

export interface StoreInventoryDataset {
  records: readonly StoreInventoryRecord[];
  bucket: string;
  key: string;
  etag: string | null;
  lastModified: string | null;
  loadedAt: string;
}

export interface StoreInventoryDataSource {
  getDataset(): Promise<StoreInventoryDataset>;
}

interface S3Reader {
  send(command: GetObjectCommand): Promise<{
    Body?: { transformToString(encoding?: string): Promise<string> };
    ContentLength?: number;
    ETag?: string;
    LastModified?: Date;
  }>;
}

export class StoreInventoryDataSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StoreInventoryDataSourceError';
  }
}

export class S3StoreInventoryDataSource implements StoreInventoryDataSource {
  #cached: StoreInventoryDataset | null = null;

  constructor(
    private readonly client: S3Reader,
    private readonly bucket = DEFAULT_BUCKET,
    private readonly key = DEFAULT_KEY,
    private readonly now: () => Date = () => new Date(),
    private readonly cacheTtlMs = CACHE_TTL_MS,
  ) {}

  async getDataset(): Promise<StoreInventoryDataset> {
    const now = this.now();
    if (
      this.#cached &&
      now.getTime() - Date.parse(this.#cached.loadedAt) < this.cacheTtlMs
    ) {
      return this.#cached;
    }

    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key }),
      );
      if (!object.Body) throw new Error('S3 object body is empty.');
      if (object.ContentLength !== undefined && object.ContentLength > MAX_CSV_BYTES) {
        throw new StoreInventoryDataSourceError('店舗在庫CSVが50MBを超えています。');
      }
      const records = parseStoreInventoryCsv(await object.Body.transformToString('utf-8'));
      const dataset: StoreInventoryDataset = Object.freeze({
        records: Object.freeze(records),
        bucket: this.bucket,
        key: this.key,
        etag: object.ETag?.replace(/^"|"$/g, '') ?? null,
        lastModified: object.LastModified?.toISOString() ?? null,
        loadedAt: now.toISOString(),
      });
      this.#cached = dataset;
      return dataset;
    } catch (error) {
      if (
        error instanceof StoreInventoryDataSourceError ||
        error instanceof PickupListValidationError
      ) {
        throw error;
      }
      throw new StoreInventoryDataSourceError(
        '店舗在庫データを取得できませんでした。しばらくしてから再試行してください。',
        { cause: error },
      );
    }
  }
}

export function createStoreInventoryDataSource(): StoreInventoryDataSource {
  const region = Deno.env.get('AWS_REGION')?.trim() || DEFAULT_REGION;
  const bucket = Deno.env.get('SHOE_DATA_BUCKET')?.trim() || DEFAULT_BUCKET;
  const key = Deno.env.get('SHOE_INVENTORY_KEY')?.trim() || DEFAULT_KEY;
  return new S3StoreInventoryDataSource(new S3Client({ region }), bucket, key);
}
