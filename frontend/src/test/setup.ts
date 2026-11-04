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
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  }
});

afterEach(cleanup);

