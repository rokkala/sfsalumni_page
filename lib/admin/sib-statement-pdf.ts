import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_PDF_BYTES = 8_000_000;

let workerReady = false;

/** pdfjs must load its worker from disk on Node/Vercel — CDN workers fail with ESM loader errors. */
function ensurePdfJsWorker(): void {
  if (workerReady) return;
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('pdfjs-dist/package.json');
    const workerPath = path.join(path.dirname(pkgJson), 'legacy/build/pdf.worker.mjs');
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    workerReady = true;
  } catch (e) {
    console.error('ensurePdfJsWorker', e);
  }
}

/** Decrypt and flatten South Indian Bank (and similar) statement PDFs to plain text. */
export async function extractStatementPdfText(
  bytes: Uint8Array,
  password: string
): Promise<{ text: string } | { error: string }> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return { error: 'PDF is too large (max 8 MB).' };
  }
  const pwd = String(password || '').trim();
  if (!pwd) {
    return { error: 'Enter the statement PDF password.' };
  }

  ensurePdfJsWorker();

  try {
    const loading = getDocument({
      data: bytes,
      password: pwd,
      useSystemFonts: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    const doc = await loading.promise;
    const chunks: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ('str' in item ? String(item.str) : ''))
        .join(' ');
      chunks.push(line);
    }
    return { text: chunks.join('\n') };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('extractStatementPdfText', msg);
    if (/password/i.test(msg)) {
      return { error: 'Could not open PDF — check the password.' };
    }
    if (/worker/i.test(msg)) {
      return {
        error:
          'PDF engine could not start on the server. Redeploy after the latest fix, or contact ops.',
      };
    }
    return { error: 'Could not read PDF.' };
  }
}

export function parseStatementAccountNumber(text: string): string | null {
  const m = text.match(/A\/C NO\s*:\s*(\d{6,18})/i);
  return m ? m[1] : null;
}