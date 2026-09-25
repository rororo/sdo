import { type Context, Hono } from 'hono';
import {
  type StoreInventoryRepository,
  StoreInventoryRepositoryError,
} from '../repositories/store-inventory-repository.ts';
import {
  createPickupSubmissionRows,
  parseSafeSizeWorkbook,
  PICKUP_SUBMISSION_HEADERS,
  type PickupListRecord,
  PickupListValidationError,
  step1JoinInventoryWithErrors,
  step2RemoveDuplicateProducts,
  step3CreateSubmissionWorkbook,
} from '../transforms/pickup-list-transform.ts';
import { PickupUploadError, readPickupUpload } from '../utils/pickup-upload.ts';
import { createXlsxResponse, encodeBase64 } from '../utils/xlsx-response.ts';

interface PickupListResult {
  bytes: Uint8Array;
  records: PickupListRecord[];
  inputRows: number;
  matchedRows: number;
  outputRows: number;
}

export function createPickupListRoutes(repository: StoreInventoryRepository): Hono {
  const routes = new Hono();

  routes.post('/pickup-list', async (context) => {
    try {
      const result = await createPickupListResult(context, repository);

      context.header('Cache-Control', 'no-store');
      context.header('X-Content-Type-Options', 'nosniff');
      return context.json({
        filename: pickupOutputFilename(),
        headers: [...PICKUP_SUBMISSION_HEADERS],
        rows: createPickupSubmissionRows(result.records),
        stats: {
          inputRows: result.inputRows,
          matchedRows: result.matchedRows,
          outputRows: result.outputRows,
        },
        workbookBase64: encodeBase64(result.bytes),
      });
    } catch (error) {
      return pickupListErrorResponse(context, error);
    }
  });

  routes.post('/pickup-list.xlsx', async (context) => {
    try {
      const result = await createPickupListResult(context, repository);

      return createXlsxResponse(result.bytes, pickupOutputFilename(), {
        'X-Input-Rows': String(result.inputRows),
        'X-Matched-Rows': String(result.matchedRows),
        'X-Processed-Rows': String(result.outputRows),
      });
    } catch (error) {
      return pickupListErrorResponse(context, error);
    }
  });

  return routes;
}

function pickupOutputFilename(now = new Date()): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now).replaceAll('-', '');
  return `pickup_list_${date}.xlsx`;
}

async function createPickupListResult(
  context: Context,
  repository: StoreInventoryRepository,
): Promise<PickupListResult> {
  const uploaded = await readPickupUpload(context);
  const inventory = await repository.getDataset();
  const errorData = await parseSafeSizeWorkbook(uploaded);
  const joined = step1JoinInventoryWithErrors(inventory.records, errorData.eans);
  const records = step2RemoveDuplicateProducts(joined);
  if (records.length === 0) {
    throw new PickupListValidationError(
      'エラーリストに一致する対象店舗の商品がありませんでした。',
    );
  }
  const bytes = await step3CreateSubmissionWorkbook(records);

  return {
    bytes,
    records,
    inputRows: errorData.inputRows,
    matchedRows: joined.length,
    outputRows: records.length,
  };
}

function pickupListErrorResponse(context: Context, error: unknown): Response {
  if (error instanceof PickupUploadError) {
    return context.json({ error: error.message }, error.status);
  }
  if (error instanceof PickupListValidationError) {
    return context.json({ error: error.message }, 422);
  }
  if (error instanceof StoreInventoryRepositoryError) {
    return context.json({ error: error.message }, 502);
  }
  return context.json({ error: 'ピックアップリストを生成できませんでした。' }, 500);
}
