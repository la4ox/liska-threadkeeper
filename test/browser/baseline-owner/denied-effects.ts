/** Every denied ambient default is a counted, throwing sentinel, never a fallback. */
let calls = 0;
export function denyAmbientEffect(): never {
  calls = Math.min(1_000_000, calls + 1);
  throw new Error('synthetic-ambient-effect-denied');
}
export const deniedAmbientCalls = () => calls;
