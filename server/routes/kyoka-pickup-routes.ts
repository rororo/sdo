import { Hono } from 'hono';
import {
  type StoreInventoryRepository,
  StoreInventoryRepositoryError,
} from '../repositories/store-inventory-repository.ts';
import {
  createPickupSubmissionRows,
  joinInventoryByInternalCodes,
  parseInternalCodeWorkbook,
  PICKUP_SUBMISSION_HEADERS,
  PickupListValidationError,
  step2RemoveDuplicateProducts,
  step3CreateSubmissionWorkbook,
} from '../transforms/pickup-list-transform.ts';
import { PickupUploadError, readPickupUpload } from '../utils/pickup-upload.ts';
import { createXlsxResponse, encodeBase64 } from '../utils/xlsx-response.ts';

export function createKyokaPickupRoutes(
  inventoryRepository: StoreInventoryRepository,
): Hono {
  const routes = new Hono();
  for (const endpoint of ['/kyoka-pickup-list', '/kyoka-pickup-list.xlsx']) {
    routes.post(endpoint, async (context) => {
      context.header('Cache-Control', 'no-store');
      context.header('X-Content-Type-Options', 'nosniff');
      try {
        const uploaded = await readPickupUpload(context);
        const input = await parseInternalCodeWorkbook(uploaded);
        const inventory = await inventoryRepository.getDataset();
        const joined = joinInventoryByInternalCodes(inventory.records, input.internalCodes);
        const records = step2RemoveDuplicateProducts(joined);
        if (records.length === 0) {
          throw new PickupListValidationError(
            'アップロードした自社品番に一致する対象店舗在庫がありませんでした。',
          );
        }
        const bytes = await step3CreateSubmissionWorkbook(records);
        const date = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date()).replaceAll('-', '');
        const filename = `kyoka_pickup_list_${date}.xlsx`;
        if (endpoint.endsWith('.xlsx')) {
          return createXlsxResponse(bytes, filename, {
            'X-Input-Rows': String(input.inputRows),
            'X-Matched-Rows': String(joined.length),
            'X-Processed-Rows': String(records.length),
          });
        }
        return context.json({
          filename,
          headers: [...PICKUP_SUBMISSION_HEADERS],
          rows: createPickupSubmissionRows(records),
          stats: {
            inputRows: input.inputRows,
            matchedRows: joined.length,
            outputRows: records.length,
          },
          metadata: {
            inventoryLastModified: inventory.lastModified,
          },
          workbookBase64: encodeBase64(bytes),
        });
      } catch (error) {
        if (error instanceof PickupUploadError) {
          return context.json({ error: error.message }, error.status);
        }
        if (
          error instanceof PickupListValidationError
        ) {
          return context.json({ error: error.message }, 422);
        }
        if (error instanceof StoreInventoryRepositoryError) {
          return context.json({ error: error.message }, 502);
        }
        return context.json({ error: '強化品番のピックアップリストを生成できませんでした。' }, 500);
      }
    });
  }
  return routes;
}
