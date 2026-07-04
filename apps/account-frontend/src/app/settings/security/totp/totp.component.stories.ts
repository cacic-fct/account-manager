import type { Meta, StoryObj } from '@storybook/angular';
import { delay, http, HttpResponse } from 'msw';

import { TotpComponent } from './totp.component';
import { authHandlers } from '../../../../storybook/mocks/msw-handlers';

type TotpStoryState = {
  mode: 'configured' | 'new-user' | 'error';
  responseDelayMs: number;
};

type StoryArgs = TotpComponent & TotpStoryState;

const API_BASE = '*/api';
const defaultState: TotpStoryState = {
  mode: 'configured',
  responseDelayMs: 0,
};
let storyState = defaultState;

const render = (args: TotpStoryState) => {
  storyState = {
    ...defaultState,
    ...args,
  };

  return {
    props: args,
  };
};

const waitForStory = async (): Promise<void> => {
  if (storyState.responseDelayMs > 0) {
    await delay(storyState.responseDelayMs);
  }
};

const handlers = [
  authHandlers.csrf,
  http.get(`${API_BASE}/totp/status`, async () => {
    await waitForStory();

    if (storyState.mode === 'error') {
      return HttpResponse.json({ message: 'Erro ao carregar código off-line' }, { status: 500 });
    }

    return HttpResponse.json({
      configured: storyState.mode === 'configured',
      algorithm: 'SHA512',
      digits: 6,
      periodSeconds: 30,
      serverTime: new Date().toISOString(),
      ...(storyState.mode === 'configured' ? { createdAt: new Date(Date.now() - 86_400_000).toISOString() } : {}),
    });
  }),
  http.post(`${API_BASE}/totp/seed`, async () => {
    await waitForStory();

    return HttpResponse.json({
      userId: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad',
      primaryEmail: 'joao.silva@unesp.br',
      seed: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      algorithm: 'SHA512',
      digits: 6,
      periodSeconds: 30,
      serverTime: new Date().toISOString(),
    });
  }),
  http.post(`${API_BASE}/totp/seed/rotate`, async () => {
    await waitForStory();

    return HttpResponse.json({
      userId: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad',
      primaryEmail: 'joao.silva@unesp.br',
      seed: 'MZXW6YTBOI======MZXW6YTBOI======',
      algorithm: 'SHA512',
      digits: 6,
      periodSeconds: 30,
      serverTime: new Date().toISOString(),
    });
  }),
  http.delete(`${API_BASE}/totp/seed`, async () => {
    await waitForStory();

    return HttpResponse.json({
      configured: false,
      algorithm: 'SHA512',
      digits: 6,
      periodSeconds: 30,
      serverTime: new Date().toISOString(),
    });
  }),
];

const meta: Meta<StoryArgs> = {
  title: 'Settings/Security/TOTP',
  component: TotpComponent,
  tags: ['autodocs'],
  render,
  args: defaultState,
  argTypes: {
    mode: {
      control: 'radio',
      options: ['configured', 'new-user', 'error'],
    },
    responseDelayMs: {
      control: { type: 'range', min: 0, max: 1500, step: 100 },
    },
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers,
    },
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Configured: Story = {};

export const NewUser: Story = {
  args: {
    mode: 'new-user',
    responseDelayMs: 0,
  },
};

export const SlowNetwork: Story = {
  args: {
    mode: 'configured',
    responseDelayMs: 1200,
  },
};

export const LoadError: Story = {
  args: {
    mode: 'error',
    responseDelayMs: 0,
  },
};
