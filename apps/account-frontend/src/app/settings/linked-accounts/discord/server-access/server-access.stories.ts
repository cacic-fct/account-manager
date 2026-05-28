import type { Meta, StoryObj } from '@storybook/angular';

import { DiscordServerAccessComponent } from './server-access.component';
import {
  authHandlers,
  discordHandlers,
} from '../../../../../storybook/mocks/msw-handlers';

const meta: Meta<DiscordServerAccessComponent> = {
  title: 'Settings/LinkedAccounts/DiscordServerAccess',
  component: DiscordServerAccessComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<DiscordServerAccessComponent>;

export const LinkedStudent: Story = {
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

export const Error: Story = {
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, discordHandlers.error],
    },
  },
};
