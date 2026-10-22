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
