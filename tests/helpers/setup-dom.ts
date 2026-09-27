/**
 * jsdom does not implement everything the interface touches. Each shim below
 * replaces a browser API with the smallest honest stand-in, so a test failure
 * means the application is wrong rather than that the environment is.
 */
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => undefined;
}

// jsdom has no layout engine, so every element reports a zero box. A few
// components measure themselves; this keeps that from throwing.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1024 });

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
