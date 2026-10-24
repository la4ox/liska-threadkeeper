import { describe, expect, it } from 'vitest';
import { isChatGptDotsRoute } from '../../src/lib/chatgpt-route-surface';

describe('ChatGPT product-surface routing', () => {
  it.each(['/dots', '/dots/', '/dots/home', '/DOTS/home'])('recognizes Dots path %s', pathname => {
    expect(isChatGptDotsRoute('chatgpt.com', pathname)).toBe(true);
  });

  it.each([
    ['chatgpt.com', '/'],
    ['chatgpt.com', '/c/01234567-89ab-4cde-8f01-23456789abcd'],
    ['chatgpt.com', '/g/custom/c/01234567-89ab-4cde-8f01-23456789abcd'],
    ['chatgpt.com', '/dotsy'],
    ['chatgpt.com.evil.test', '/dots/home'],
    ['example.com', '/dots/home'],
  ])('does not classify %s%s as Dots', (hostname, pathname) => {
    expect(isChatGptDotsRoute(hostname, pathname)).toBe(false);
  });
});
