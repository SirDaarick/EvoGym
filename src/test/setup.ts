import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
  if (typeof window !== 'undefined' && !window.navigator.locks) {
    Object.defineProperty(window.navigator, 'locks', {
      value: {
        request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => {
          await callback({});
        },
      },
      configurable: true,
      writable: true,
    });
  }

  if (typeof HTMLDialogElement !== 'undefined') {
    HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = HTMLDialogElement.prototype.close || function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
});

afterEach(cleanup);

