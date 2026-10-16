const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function downloadBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const matched = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  return matched?.[1] ? decodeURIComponent(matched[1]) : fallback;
}

export async function downloadResponseFile(
  response: Response,
  fallbackFilename: string,
): Promise<void> {
  downloadBlobFile(await response.blob(), responseFilename(response, fallbackFilename));
}

export function downloadBase64Workbook(workbookBase64: string, filename: string): void {
  const binary = atob(workbookBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  downloadBlobFile(new Blob([bytes], { type: EXCEL_CONTENT_TYPE }), filename);
}
