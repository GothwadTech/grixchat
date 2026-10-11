/**
 * Vitest global setup — jsdom is missing a handful of browser APIs that
 * GrixChat's UI relies on. Polyfill them once, here.
 */
import '@testing-library/jest-dom/vitest';
import {afterEach, beforeEach, vi} from 'vitest';
import {cleanup} from '@testing-library/react';
import {store} from '../mock/store';

// The API contract tests run in the Node environment (jsdom has no
// Request/Response), so every browser-only shim below is guarded.
const hasDom = typeof window !== 'undefined';

// --- Browser APIs jsdom does not implement ---------------------------------
if (hasDom && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as any;
}

class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
(globalThis as any).IntersectionObserver = (globalThis as any).IntersectionObserver || MockObserver;
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || MockObserver;

if (hasDom) {
  if (!window.scrollTo) window.scrollTo = (() => {}) as any;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
}

if (hasDom && !window.HTMLMediaElement.prototype.play) {
  window.HTMLMediaElement.prototype.play = (() => Promise.resolve()) as any;
  window.HTMLMediaElement.prototype.pause = (() => {}) as any;
}

// getUserMedia is used by the camera + call screens.
if (hasDom && !navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: () => Promise.reject(new Error('no camera in tests')),
      enumerateDevices: () => Promise.resolve([]),
    },
    configurable: true,
  });
}

// Keep the browser console readable — component tests log a lot.
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'debug').mockImplementation(() => {});

/** Fresh database + storage for every test, so mutations never leak. */
beforeEach(() => {
  store.reset();
  try {
    globalThis.localStorage.clear();
  } catch {
    /* storage unavailable */
  }
});

afterEach(() => {
  if (hasDom) cleanup();
});
