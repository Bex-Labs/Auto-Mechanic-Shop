import { afterEach, beforeAll, vi } from 'vitest';

beforeAll(() => {
  class IntersectionObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.IntersectionObserver = globalThis.IntersectionObserver || IntersectionObserverMock;
  globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverMock;
  window.scrollTo = vi.fn();
  window.confirm = vi.fn(() => true);
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});
