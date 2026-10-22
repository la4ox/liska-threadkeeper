export interface MarkdownBlockquotePrefix {
  length: number;
  depth: number;
}

/** Parse CommonMark blockquote container markers without consuming content indentation. */
export function markdownBlockquotePrefix(line: string): MarkdownBlockquotePrefix {
  let cursor = 0;
  let depth = 0;
  while (cursor < line.length) {
    const markerStart = cursor;
    let spaces = 0;
    while (spaces < 4 && line[cursor] === ' ') {
      spaces += 1;
      cursor += 1;
    }
    if (spaces > 3 || line[cursor] !== '>') {
      cursor = markerStart;
      break;
    }
    cursor += 1;
    depth += 1;
    if (line[cursor] === ' ' || line[cursor] === '\t') cursor += 1;
  }
  return { length: cursor, depth };
}

export interface MarkdownBacktickFence {
  readonly marker: '`';
  readonly length: number;
}

/**
 * Advance a backtick-only fence reader without mutating its previous state.
 * Fences allow up to three spaces of indentation; container markers are not
 * stripped. A closer must use the same character, be at least as long, and
 * carry only spaces/tabs (plus a terminal CR from a CRLF-split line).
 *
 * Tildes deliberately cannot open a block: the message writers emit backticks,
 * so treating a stray tilde run as a fence could hide later message headings.
 */
export function nextMarkdownBacktickFence(
  state: MarkdownBacktickFence | null,
  line: string
): MarkdownBacktickFence | null {
  const match = /^ {0,3}(`{3,})([^\r\n]*)\r?$/.exec(line);
  if (!match) return state;

  const run = match[1];
  const tail = match[2];
  if (state !== null) {
    return run[0] === state.marker && run.length >= state.length && /^[ \t]*$/.test(tail)
      ? null
      : state;
  }

  // CommonMark forbids backticks anywhere in a backtick fence's info string.
  return tail.includes('`') ? null : { marker: '`', length: run.length };
}
