/**
 * Resume text extraction for the "For you" recommender, done entirely in the
 * member's browser. The PDF is fetched from its short-lived signed URL and
 * parsed with pdf.js locally, so resume text is never sent to our server, the
 * scanner, or any model API. That is the privacy property worth keeping if
 * this ever moves server-side.
 *
 * pdf.js (and its ~1 MB worker) is imported dynamically, so it only downloads
 * when a member actually opens "For you", never on a plain page load.
 */

export type ResumeTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'not-pdf' | 'unreadable' };

/** Pages beyond this are not a resume; stop rather than parse a thesis. */
const MAX_PAGES = 4;

export async function extractResumeText(url: string, fileName: string): Promise<ResumeTextResult> {
  // Word files are accepted by upload but pdf.js cannot read them. Better an
  // honest "PDF only" than shipping a second parser for a minority format.
  if (!/\.pdf$/i.test(fileName)) return { ok: false, reason: 'not-pdf' };

  try {
    const pdfjs = await import('pdfjs-dist');
    const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

    const doc = await pdfjs.getDocument({ url }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      // hasEOL marks a line break in the source layout; keeping it preserves
      // "Expected June 2029" as one line for the grad-year parser.
      pages.push(
        content.items
          .map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : ''))
          .join('')
      );
    }
    await doc.destroy();
    const text = pages.join('\n').replace(/[ \t]+/g, ' ').trim();
    // An image-only (scanned) PDF parses fine but yields no text layer.
    return text.length < 40 ? { ok: false, reason: 'unreadable' } : { ok: true, text };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
