import { Hono } from 'hono';
import {
  type ShoeProductsDataset,
  type ShoeProductsRepository,
  ShoeProductsRepositoryError,
} from '../repositories/shoe-products-repository.ts';
import {
  parseInternalCodeWorkbook,
  PickupListValidationError,
} from '../transforms/pickup-list-transform.ts';
import {
  step1ConvertSourceRows,
  step2CreateMasterWorkbook,
  WorkbookValidationError,
} from '../transforms/shoes-master-transform.ts';
import { PickupUploadError, readPickupUpload } from '../utils/pickup-upload.ts';
import { createXlsxResponse } from '../utils/xlsx-response.ts';

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createKyokaProductsRoutes(repository: ShoeProductsRepository): Hono {
  const routes = new Hono();
  // Weak keys keep old cached datasets collectable; tokens work across ECS instances.
  const versions = new WeakMap<ShoeProductsDataset, Promise<string>>();
  for (const endpoint of ['/kyoka-products', '/kyoka-products.xlsx']) {
    routes.post(endpoint, async (context) => {
      context.header('Cache-Control', 'no-store');
      context.header('X-Content-Type-Options', 'nosniff');
      try {
        const page = Number(context.req.query('page') ?? '1');
        if (!Number.isSafeInteger(page) || page < 1) {
          return context.json({ error: 'ページ番号は1以上の整数で指定してください。' }, 400);
        }
        const requestedVersion = context.req.query('version');
        const download = endpoint.endsWith('.xlsx');
        if ((page > 1 || download) && !requestedVersion) {
          return context.json({ error: 'リストを確定してから操作してください。' }, 400);
        }
        const input = await parseInternalCodeWorkbook(await readPickupUpload(context));
        const dataset = await repository.getDataset();
        let sourceVersion = versions.get(dataset);
        if (!sourceVersion) {
          sourceVersion = digest([
            dataset.bucket,
            dataset.key,
            dataset.etag,
            dataset.lastModified,
            dataset.records,
          ]);
          versions.set(dataset, sourceVersion);
        }
        const version = await digest([
          await sourceVersion,
          [...input.internalCodes].sort(),
          input.inputRows,
        ]);
        if (requestedVersion && requestedVersion !== version) {
          return context.json({
            code: 'DATA_CHANGED',
            error: '商品データまたは入力リストが更新されました。アップロードを再確定してください。',
          }, 409);
        }
        const records = dataset.records.filter((record) =>
          input.internalCodes.has(record.internalCode.normalize('NFKC').trim())
        );
        const matchedCodes = new Set(
          records.map((record) => record.internalCode.normalize('NFKC').trim()),
        );
        const unmatchedCodes = [...input.internalCodes].filter((code) => !matchedCodes.has(code));
        if (download) {
          if (records.length === 0) {
            return context.json(
              { error: '対象期の商品データに一致する自社品番がありません。' },
              422,
            );
          }
          const bytes = await step2CreateMasterWorkbook(step1ConvertSourceRows(records));
          const period = /kiukkn=([^/]+)/.exec(dataset.key)?.[1] ?? 'current';
          return createXlsxResponse(bytes, `kyoka_shoe_master_${period}.xlsx`, {
            'X-Processed-Rows': String(records.length),
          });
        }
        const pageSize = 50;
        const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
        const resolvedPage = Math.min(page, pageCount);
        return context.json({
          records: records.slice((resolvedPage - 1) * pageSize, resolvedPage * pageSize),
          total: records.length,
          page: resolvedPage,
          pageSize,
          pageCount,
          version,
          stats: {
            inputRows: input.inputRows,
            uniqueCodes: input.internalCodes.size,
            matchedCodes: matchedCodes.size,
          },
          unmatchedCodes,
          metadata: {
            lastModified: dataset.lastModified,
            period: /kiukkn=([^/]+)/.exec(dataset.key)?.[1] ?? null,
          },
        });
      } catch (error) {
        if (error instanceof PickupUploadError) {
          return context.json({ error: error.message }, error.status);
        }
        if (
          error instanceof PickupListValidationError || error instanceof WorkbookValidationError
        ) {
          return context.json({ error: error.message }, 422);
        }
        if (error instanceof ShoeProductsRepositoryError) {
          return context.json({ error: error.message }, 502);
        }
        return context.json({ error: '強化品番の商品データを取得できませんでした。' }, 500);
      }
    });
  }
  return routes;
}
