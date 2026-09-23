import { extractText, getDocumentProxy } from "unpdf";

/**
 * PDF text extraction (M8). Thin wrapper around unpdf so the rest of the
 * app never touches pdf.js types. Extraction failures are the caller's
 * concern — this module only validates and extracts.
 */

export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  const magic = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  return magic === "%PDF-";
}

export async function extractPdfText(
  bytes: Uint8Array,
): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text: text.trim() };
}
