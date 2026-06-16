import { signal } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { DiscordIntegrationComponent } from './discord-integration.component';
import { AuthService } from '../../shared/services/auth/auth.service';
import {
  authHandlers,
  discordHandlers,
} from '../../../storybook/mocks/msw-handlers';

const authProvider = (isAuthenticated: boolean) =>
  applicationConfig({
    providers: [
      {
        provide: AuthService,
        useValue: {
          isAuthenticated: signal(isAuthenticated),
        },
      },
    ],
  });

const adminHandlers = [
  authHandlers.csrf,
  discordHandlers.adminStatus,
  discordHandlers.serverSettings,
  discordHandlers.updateServerSettingSuccess,
  discordHandlers.adminRoles,
  discordHandlers.updateRoleSelectionSuccess,
  discordHandlers.syncRolesSuccess,
];

const meta: Meta<DiscordIntegrationComponent> = {
  title: 'Admin/DiscordIntegration',
  component: DiscordIntegrationComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<DiscordIntegrationComponent>;

export const AdminReady: Story = {
  decorators: [authProvider(true)],
  parameters: {
    msw: {
      handlers: adminHandlers,
    },
  },
};

export const CheckingAccess: Story = {
  decorators: [authProvider(true)],
  parameters: {
    msw: {
      handlers: [
        authHandlers.csrf,
        discordHandlers.adminStatusDelayed,
        discordHandlers.serverSettings,
        discordHandlers.adminRoles,
      ],
    },
  },
};

export const AccessDenied: Story = {
  decorators: [authProvider(true)],
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, discordHandlers.adminStatusForbidden],
    },
  },
};

export const SignedOut: Story = {
  decorators: [authProvider(false)],
  parameters: {
    msw: {
      handlers: [authHandlers.csrf],
    },
  },
};
