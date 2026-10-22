import { http, HttpResponse } from 'msw';
import type { Meta, StoryObj } from '@storybook/angular';

import { mockDiscordStatusLinked } from '../../../../storybook/mocks/component-mocks';
import { DiscordIntegrationCardComponent } from './discord-integration-card.component';
import { authHandlers, discordHandlers } from '../../../../storybook/mocks/msw-handlers';

const meta: Meta<DiscordIntegrationCardComponent> = {
  title: 'Settings/LinkedAccounts/DiscordIntegrationCard',
  component: DiscordIntegrationCardComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<DiscordIntegrationCardComponent>;

export const Linked: Story = {
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, discordHandlers.linked],
    },
  },
};

export const NotLinked: Story = {
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, discordHandlers.notLinked],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, discordHandlers.delayed],
    },
  },
};

export const Error: Story = {
  parameters: { msw: { handlers: [http.get('*/discord/status', () => new HttpResponse(null, { status: 503 }))] } },
};

export const LongAccountName: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/discord/status', () =>
          HttpResponse.json({
            ...mockDiscordStatusLinked,
            discordLinks: mockDiscordStatusLinked.discordLinks?.map((link) => ({
              ...link,
              discordGlobalName: 'João Pedro de Oliveira e Silva',
              discordUsername: 'joao.pedro.oliveira.silva',
            })),
          }),
        ),
      ],
    },
  },
};
