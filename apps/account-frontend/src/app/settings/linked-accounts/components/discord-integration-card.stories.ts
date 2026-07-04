import type { Meta, StoryObj } from '@storybook/angular';

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
