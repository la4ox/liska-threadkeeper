import { HtmlPresentationError } from './contracts';
import { PresentationError, type PresentationErrorCode } from './presentation-contracts';
import { TextPresentationError } from './text-contracts';
import { escapeHtml, isSafeUserLink } from './safety';

export function presentationFail(code: PresentationErrorCode): never {
  throw new PresentationError(code);
}
export function presentationGuard<T>(action: () => T, code: PresentationErrorCode): T {
  try {
    return action();
  } catch (error) {
    if (
      error instanceof PresentationError ||
      error instanceof TextPresentationError ||
      error instanceof HtmlPresentationError
    )
      throw error;
    presentationFail(code);
  }
}
const own = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/** Descriptor-only snapshots: getters and Proxy get traps never supply a field. */
export function presentationRecord(
  value: unknown,
  keys: readonly string[],
  code: PresentationErrorCode,
  partial = false
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    presentationFail(code);
  const found = Reflect.ownKeys(value);
  if (found.length > keys.length) presentationFail(code);
  const result: Record<string, unknown> = {};
  for (const key of found) {
    if (typeof key !== 'string' || !keys.includes(key)) presentationFail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !own(descriptor, 'value')) presentationFail(code);
    result[key] = descriptor.value;
  }
  if (!partial && keys.some(key => !own(result, key))) presentationFail(code);
  return result;
}
export function presentationArray(
  value: unknown,
  maximum: number,
  code: PresentationErrorCode
): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    presentationFail(code);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) presentationFail(code);
  if (Reflect.ownKeys(value).length !== length + 1) presentationFail(code);
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !own(descriptor, 'value')) presentationFail(code);
    result.push(descriptor.value);
  }
  return result;
}
export function presentationLimits<T extends Record<string, number>>(
  defaults: T,
  value: unknown
): T {
  const result = { ...defaults };
  if (value === undefined) return result;
  const fields = presentationRecord(
    value,
    Object.keys(defaults),
    'presentation-limits-invalid',
    true
  );
  for (const key of Object.keys(fields) as (keyof T)[]) {
    const number = fields[key as string];
    if (
      !Number.isSafeInteger(number) ||
      (number as number) <= 0 ||
      (number as number) > defaults[key]
    )
      presentationFail('presentation-limits-invalid');
    result[key] = number as T[keyof T];
  }
  return result;
}

const SIMPLE_TAGS = new Set([
  'p',
  'section',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'code',
  'aside',
  'blockquote',
  'footer',
  'ul',
  'ol',
  'li',
  'em',
  'strong',
  'br',
  'hr',
]);
function safeOpeningTag(tag: string, attributes: string): boolean {
  if (attributes === '' && SIMPLE_TAGS.has(tag)) return true;
  if (tag === 'p' && /^ class="(?:text|placeholder)"$/.test(attributes)) return true;
  if (tag === 'pre' && attributes === ' class="placeholder"') return true;
  if (tag === 'span' && /^ class="(?:inert-link|placeholder)"$/.test(attributes)) return true;
  if (
    tag === 'span' &&
    attributes === ' class="inert-html" aria-label="Inert provider HTML source"'
  )
    return true;
  if (tag === 'ol' && /^ start="-?\d+"$/.test(attributes))
    return Number.isSafeInteger(Number(attributes.slice(8, -1)));
  return tag === 'a' && safeLinkAttributes(attributes);
}
function safeLinkAttributes(attributes: string): boolean {
  const link = /^ href="([^"]*)" target="_blank" rel="noopener noreferrer"$/.exec(attributes);
  if (!link) return false;
  const url = link[1].replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!
  );
  return escapeHtml(url) === link[1] && isSafeUserLink(url);
}

/** Exact generated fragment grammar, not a browser-dependent sanitizer. */
export function requireSafeHtmlBody(source: string): void {
  const stack: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    const end = source.indexOf('>', start + 1);
    if (end < 0) presentationFail('presentation-html-invalid');
    const token = source.slice(start + 1, end);
    const closing = /^\/([a-z][a-z0-9]*)$/.exec(token);
    if (closing) {
      if (stack.pop() !== closing[1]) presentationFail('presentation-html-invalid');
    } else {
      const opening = /^([a-z][a-z0-9]*)([^<>]*)$/.exec(token);
      if (!opening || !safeOpeningTag(opening[1], opening[2]))
        presentationFail('presentation-html-invalid');
      if (opening[1] !== 'br' && opening[1] !== 'hr') stack.push(opening[1]);
    }
    cursor = end + 1;
  }
  if (stack.length !== 0) presentationFail('presentation-html-invalid');
}
