import { Hono } from 'hono';
import {
  type ShoeProductsRepository,
  ShoeProductsRepositoryError,
} from '../repositories/shoe-products-repository.ts';
import {
  step1ConvertSourceRows,
  step2CreateMasterWorkbook,
  WorkbookValidationError,
} from '../transforms/shoes-master-transform.ts';
import { createXlsxResponse } from '../utils/xlsx-response.ts';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export function createShoesRoutes(repository: ShoeProductsRepository): Hono {
  const routes = new Hono();

  routes.get('/shoes', async (context) => {
    const page = positiveInteger(context.req.query('page'), 1, Number.MAX_SAFE_INTEGER);
    const pageSize = positiveInteger(
      context.req.query('pageSize'),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    try {
      const dataset = await repository.getDataset();
      const total = dataset.records.length;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const resolvedPage = Math.min(page, pageCount);
      const start = (resolvedPage - 1) * pageSize;

      context.header('Cache-Control', 'no-store');
      return context.json({
        records: dataset.records.slice(start, start + pageSize),
        total,
        page: resolvedPage,
        pageSize,
        pageCount,
        metadata: {
          lastModified: dataset.lastModified,
          loadedAt: dataset.loadedAt,
        },
      });
    } catch (error) {
      if (error instanceof WorkbookValidationError) {
        return context.json({ error: error.message }, 422);
      }
      if (error instanceof ShoeProductsRepositoryError) {
        return context.json({ error: error.message }, 502);
      }
      return context.json({ error: '商品データを読み込めませんでした。' }, 500);
    }
  });

  routes.get('/shoes.xlsx', async (context) => {
    try {
      const dataset = await repository.getDataset();
      const rows = step1ConvertSourceRows(dataset.records);
      const bytes = await step2CreateMasterWorkbook(rows);

      return createXlsxResponse(bytes, outputFilename(dataset.key), {
        'X-Processed-Rows': String(rows.length),
      });
    } catch (error) {
      if (error instanceof WorkbookValidationError) {
        return context.json({ error: error.message }, 422);
      }
      if (error instanceof ShoeProductsRepositoryError) {
        return context.json({ error: error.message }, 502);
      }
      return context.json({ error: 'Excelファイルを生成できませんでした。' }, 500);
    }
  });

  return routes;
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function outputFilename(key: string): string {
  const period = /kiukkn=([^/]+)/.exec(key)?.[1] ?? 'current';
  return `shoe_master_${period}.xlsx`;
}
