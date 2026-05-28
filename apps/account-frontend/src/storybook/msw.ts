import type { Decorator } from '@storybook/angular';
import type { RequestHandler } from 'msw';
import { setupWorker } from 'msw/browser';

export type MswParameters = {
  handlers?: RequestHandler[];
};

const worker =
  typeof window !== 'undefined' ? setupWorker() : (undefined as never);

let started = false;

export async function ensureMswReady() {
  if (started || typeof window === 'undefined') {
    return {};
  }

  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: {
      url: '/mockServiceWorker.js',
    },
  });
  started = true;
  return {};
}

export const withMsw: Decorator = (storyFn, context) => {
  const msw = context.parameters['msw'] as MswParameters | undefined;
  const handlers = msw?.handlers;

  if (started && typeof window !== 'undefined') {
    if (handlers && handlers.length > 0) {
      worker.resetHandlers(...handlers);
    } else {
      worker.resetHandlers();
    }
  }

  return storyFn();
};
