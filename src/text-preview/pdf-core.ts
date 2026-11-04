import pdfMake from 'pdfmake/build/pdfmake';
import type { Content, ContentText, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  PDF_RESULT_SCHEMA,
  PdfRenderError,
  pdfDiagnostics,
  pdfFail,
  snapshotPdfRequest,
  type PdfRenderRequest,
  type PdfWorkerSuccess,
} from './pdf-contract';
import { PDF_FONT_VFS } from './pdf-font';
import { PdfHtmlBuilder, type PdfParagraph } from './pdf-html';

function semanticDocument(request: PdfRenderRequest): PdfHtmlBuilder {
  const builder = new PdfHtmlBuilder(request.limits);
  builder.framing(request.title ?? 'Untitled archived conversation', 1);
  builder.framing(
    `Explicit selected reading excerpt: ${request.rows.length} messages. Not a complete branch or archive authority.`
  );
  request.rows.forEach((row, index) => {
    builder.counts.messageCount++;
    builder.framing(
      `Selected message ${index + 1}: ${row.role === 'user' ? 'User' : 'Assistant'}`,
      2
    );
    builder.body(row.htmlBody);
  });
  return builder;
}
function paragraph(block: PdfParagraph): Content {
  const left = block.quoteDepth * 12 + block.listDepth * 14;
  if (block.rule)
    return {
      canvas: [
        { type: 'line', x1: 0, y1: 3, x2: 480 - left, y2: 3, lineWidth: 0.5, lineColor: '#999999' },
      ],
      margin: [left, 4, 0, 8],
    };
  const text: ContentText[] = block.runs.map(run => ({
    text: run.text,
    font: run.font,
    bold: run.bold,
    italics: run.italic || run.placeholder,
    ...(run.atomic ? { wordBreak: 'normal' as const, noWrap: true } : {}),
    ...(run.code ? { background: '#f3f3f3' } : {}),
    ...(run.placeholder ? { color: '#555555' } : {}),
  }));
  return {
    text,
    color: '#000000',
    fontSize: block.heading ? [20, 15, 13, 12, 11, 11][block.heading - 1] : block.pre ? 9 : 11,
    margin: [left, block.heading ? 10 : 0, 0, block.heading ? 6 : 7],
    ...(block.heading ? { headlineLevel: block.heading, bold: true } : {}),
    preserveLeadingSpaces: true,
    preserveTrailingSpaces: true,
    // Pinned pdfmake hard-wraps long normal Roboto tokens; break-all splits UTF-16/graphemes.
    wordBreak: 'normal',
  };
}

/** Fixed local layout; callers cannot supply document definitions, assets or executable callbacks. */
export function createPdfDefinition(
  request: PdfRenderRequest,
  builder: PdfHtmlBuilder
): {
  definition: TDocumentDefinitions;
  pageCount(): number;
} {
  let pages = 0;
  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [48, 48, 48, 48],
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.18 },
    info: {
      title: request.title ?? 'Untitled archived conversation',
      author: 'Liska Threadkeeper',
      creator: 'Liska Threadkeeper',
      producer: 'Liska Threadkeeper',
      subject: 'Explicit selected reading excerpt; not archive authority.',
      creationDate: new Date('2000-01-01T00:00:00.000Z'),
      modDate: new Date('2000-01-01T00:00:00.000Z'),
    },
    content: builder.paragraphs.map(paragraph),
    pageBreakBefore(node) {
      if (++builder.counts.layoutVisits > request.limits.maxLayoutNodes)
        pdfFail('pdf-layout-node-limit');
      if (!Number.isSafeInteger(node.pages) || node.pages < 1) pdfFail('pdf-pack-failed');
      pages = Math.max(pages, node.pages);
      if (pages > request.limits.maxPages) pdfFail('pdf-page-limit');
      return false;
    },
  };
  return { definition, pageCount: () => pages };
}

/** Production entry is the one-shot worker, never the preview/UI thread. */
export async function renderPdfRequest(value: unknown): Promise<PdfWorkerSuccess> {
  const request = snapshotPdfRequest(value);
  const builder = semanticDocument(request);
  const { definition, pageCount } = createPdfDefinition(request, builder);
  let bytes: ArrayBuffer;
  try {
    pdfMake.setUrlAccessPolicy(() => false);
    pdfMake.addVirtualFileSystem(PDF_FONT_VFS);
    pdfMake.setFonts({
      Roboto: {
        normal: 'Roboto-Regular.ttf',
        bold: 'Roboto-Medium.ttf',
        italics: 'Roboto-Italic.ttf',
        bolditalics: 'Roboto-MediumItalic.ttf',
      },
      NotoEmoji: {
        normal: 'NotoEmoji.ttf',
        bold: 'NotoEmoji.ttf',
        italics: 'NotoEmoji.ttf',
        bolditalics: 'NotoEmoji.ttf',
      },
    });
    const buffer = await pdfMake.createPdf(definition).getBuffer();
    bytes = Uint8Array.from(buffer).buffer;
  } catch (error) {
    if (error instanceof PdfRenderError) throw error;
    pdfFail('pdf-pack-failed');
  }
  if (!bytes.byteLength || bytes.byteLength > request.limits.maxOutputBytes)
    pdfFail('pdf-output-limit');
  if (!pageCount()) pdfFail('pdf-pack-failed');
  return Object.freeze({
    schema: PDF_RESULT_SCHEMA,
    operationToken: request.operationToken,
    ok: true,
    bytes,
    pageCount: pageCount(),
    counts: Object.freeze({ ...builder.counts }),
    diagnostics: pdfDiagnostics(builder.counts),
  });
}
