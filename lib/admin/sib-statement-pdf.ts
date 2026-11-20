import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_PDF_BYTES = 8_000_000;

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

  try {
    const loading = getDocument({
      data: bytes,
      password: pwd,
      useSystemFonts: true,
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
    if (/password/i.test(msg)) {
      return { error: 'Could not open PDF — check the password.' };
    }
    return { error: 'Could not read PDF.' };
  }
}

export function parseStatementAccountNumber(text: string): string | null {
  const m = text.match(/A\/C NO\s*:\s*(\d{6,18})/i);
  return m ? m[1] : null;
}