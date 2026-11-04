import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TextRun,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx';
import {
  DOCX_RESULT_SCHEMA,
  DocxRenderError,
  docxDiagnostics,
  docxFail,
  snapshotDocxRequest,
  type DocxWorkerSuccess,
  type DocxRenderRequest,
} from './docx-contract';
import { DocxHtmlBuilder, type DocxParagraph, type DocxRun } from './docx-html';

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;
function runs(run: DocxRun): TextRun[] {
  const style: IRunOptions = {
    bold: run.bold,
    italics: run.italic || run.placeholder,
    ...(run.code ? { font: 'Courier New', size: 20 } : {}),
    ...(run.placeholder ? { color: '555555' } : {}),
  };
  if (run.break) return [new TextRun({ ...style, break: 1 })];
  return [
    new TextRun(
      run.text === '\t' ? { ...style, children: [new Tab()] } : { ...style, text: run.text }
    ),
  ];
}
function paragraph(value: DocxParagraph): Paragraph {
  const options: IParagraphOptions = {
    children: value.runs.flatMap(runs),
    ...(value.heading ? { heading: HEADINGS[value.heading - 1] } : {}),
    ...(value.numbering ? { numbering: value.numbering } : {}),
    ...(!value.numbering && (value.quoteDepth || value.listDepth)
      ? { indent: { left: value.quoteDepth * 360 + value.listDepth * 720 } }
      : {}),
    ...(value.pre ? { spacing: { before: 80, after: 80 }, shading: { fill: 'F3F3F3' } } : {}),
    ...(value.rule
      ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '888888' } } }
      : {}),
  };
  return new Paragraph(options);
}

function semanticDocument(request: DocxRenderRequest): DocxHtmlBuilder {
  const builder = new DocxHtmlBuilder(request.limits);
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
function wordDocument(title: string | null, builder: DocxHtmlBuilder): Document {
  return new Document({
    creator: 'Liska Threadkeeper',
    lastModifiedBy: 'Liska Threadkeeper',
    title: title ?? 'Untitled archived conversation',
    description: 'Explicit selected reading excerpt; not archive authority.',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 120 } } },
      },
    },
    numbering: {
      config: builder.numbering.map(list => ({
        reference: list.reference,
        levels: [
          {
            level: list.level,
            format: list.ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
            text: list.ordered ? `%${list.level + 1}.` : '•',
            start: list.start,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: (list.level + 1) * 720, hanging: 360 } } },
          },
        ],
      })),
    },
    sections: [{ children: builder.paragraphs.map(paragraph) }],
  });
}

/** Called only in the short-lived module worker in production. No XML override surface. */
export async function renderDocxRequest(value: unknown): Promise<DocxWorkerSuccess> {
  const request = snapshotDocxRequest(value);
  const builder = semanticDocument(request);
  let bytes: ArrayBuffer;
  try {
    bytes = await Packer.toArrayBuffer(wordDocument(request.title, builder));
  } catch (error) {
    if (error instanceof DocxRenderError) throw error;
    docxFail('docx-pack-failed');
  }
  if (!bytes.byteLength || bytes.byteLength > request.limits.maxOutputBytes)
    docxFail('docx-output-limit');
  return Object.freeze({
    schema: DOCX_RESULT_SCHEMA,
    operationToken: request.operationToken,
    ok: true,
    bytes,
    counts: Object.freeze({ ...builder.counts }),
    diagnostics: docxDiagnostics(builder.counts),
  });
}
