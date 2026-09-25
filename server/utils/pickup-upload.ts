import type { Context } from 'hono';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export class PickupUploadError extends Error {
  constructor(message: string, readonly status: 400 | 413) {
    super(message);
    this.name = 'PickupUploadError';
  }
}

export async function readPickupUpload(context: Context): Promise<Uint8Array> {
  const contentLength = Number(context.req.header('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    throw new PickupUploadError('アップロードできるExcelファイルは20MBまでです。', 413);
  }

  let form: FormData;
  try {
    form = await context.req.formData();
  } catch {
    throw new PickupUploadError('エラーリストのExcelファイルを選択してください。', 400);
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    throw new PickupUploadError('エラーリストのExcelファイルを選択してください。', 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new PickupUploadError('アップロードできるExcelファイルは20MBまでです。', 413);
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new PickupUploadError('Excel（.xlsx）ファイルを選択してください。', 400);
  }

  const uploaded = new Uint8Array(await file.arrayBuffer());
  if (uploaded[0] !== 0x50 || uploaded[1] !== 0x4b) {
    throw new PickupUploadError('Excel（.xlsx）ファイルを選択してください。', 400);
  }
  return uploaded;
}
