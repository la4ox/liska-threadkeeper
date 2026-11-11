/** Test-only transport denial. This module installs no other capability. */
export function installNetworkDenial(target: typeof globalThis) {
  let count = 0;
  const restore: (() => void)[] = [];
  const deny = function () {
    count = Math.min(1_000_000, count + 1);
    throw new Error('synthetic-network-denied');
  };
  const replace = (object: object, key: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, writable: true, value: deny });
    restore.push(() => {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else Reflect.deleteProperty(object, key);
    });
  };
  const undo = () => {
    while (restore.length) restore.pop()!();
  };
  try {
    for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) replace(target, key);
    replace(target.navigator, 'sendBeacon');
  } catch {
    undo();
    throw new Error('synthetic-network-denial-unavailable');
  }
  return Object.freeze({ calls: () => count, restore: undo });
}
