import type { Meta, StoryObj } from '@storybook/angular';

import { DiscordRoleSelectionComponent } from './discord-role-selection.component';
import {
  authHandlers,
  discordHandlers,
} from '../../../../../../storybook/mocks/msw-handlers';

const meta: Meta<DiscordRoleSelectionComponent> = {
  title: 'Settings/LinkedAccounts/DiscordRoleSelection',
  component: DiscordRoleSelectionComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<DiscordRoleSelectionComponent>;

export const Ready: Story = {
  parameters: {
    msw: {
      handlers: [
        authHandlers.csrf,
        discordHandlers.selectableRoles,
        discordHandlers.userRoles,
        discordHandlers.updateUserRolesSuccess,
      ],
    },
  },
};

export const CooldownErrorOnSave: Story = {
  parameters: {
    msw: {
      handlers: [
        authHandlers.csrf,
        discordHandlers.selectableRoles,
        discordHandlers.userRoles,
        discordHandlers.updateUserRolesCooldown,
      ],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        authHandlers.csrf,
        discordHandlers.selectableRoles,
        discordHandlers.userRoles,
      ],
    },
  },
  play: async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  },
};
