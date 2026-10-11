import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});

// Minimal DOM stubs used by backup download helpers in tests
if (typeof globalThis.document === 'undefined') {
  const body = {
    appendChild(node: { click?: () => void }) {
      return node;
    },
  };
  const doc = {
    body,
    createElement(tag: string) {
      if (tag === 'a') {
        return {
          href: '',
          download: '',
          rel: '',
          click() {},
          remove() {},
        };
      }
      return {};
    },
  };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
}

if (typeof globalThis.HTMLAnchorElement === 'undefined') {
  class HTMLAnchorElementStub {
    href = '';
    download = '';
    rel = '';
    click() {}
    remove() {}
  }
  Object.defineProperty(globalThis, 'HTMLAnchorElement', {
    value: HTMLAnchorElementStub,
    configurable: true,
  });
}

if (typeof globalThis.URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(globalThis, 'URL', {
    value: class URLStub {
      static createObjectURL() {
        return 'blob:test';
      }
      static revokeObjectURL() {}
    },
    configurable: true,
  });
}

if (typeof globalThis.navigator === 'undefined') {
  const nav = { onLine: true as boolean, storage: undefined as unknown };
  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
  });
}
