import type { Meta, StoryObj } from '@storybook/angular';
import { userEvent, within } from 'storybook/test';

import { KeycloakPermissionsComponent } from './keycloak-permissions.component';
import {
  authHandlers,
  keycloakPermissionHandlers,
  setKeycloakPermissionsStoryState,
  type KeycloakPermissionsStoryState,
} from '../../../storybook/mocks/msw-handlers';
import { mockKeycloakPermissionUsers } from '../../../storybook/mocks/component-mocks';

type StoryArgs = KeycloakPermissionsComponent &
  KeycloakPermissionsStoryState;

const render = (args: KeycloakPermissionsStoryState) => {
  setKeycloakPermissionsStoryState(args);

  return {
    props: args,
  };
};

const meta: Meta<StoryArgs> = {
  title: 'Admin/KeycloakPermissions',
  component: KeycloakPermissionsComponent,
  tags: ['autodocs'],
  render,
  args: {
    rosterMode: 'balanced',
    searchMode: 'matches',
    failureMode: 'none',
    responseDelayMs: 0,
  },
  argTypes: {
    rosterMode: {
      control: 'radio',
      options: ['balanced', 'large', 'empty'],
    },
    searchMode: {
      control: 'radio',
      options: ['matches', 'empty', 'error'],
    },
    failureMode: {
      control: 'radio',
      options: ['none', 'catalog', 'save'],
    },
    responseDelayMs: {
      control: { type: 'range', min: 0, max: 1500, step: 100 },
    },
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [authHandlers.csrf, ...keycloakPermissionHandlers],
    },
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const InteractiveWorkspace: Story = {
  play: async ({ canvasElement }) => {
    const primaryUser = mockKeycloakPermissionUsers[0];
    if (!primaryUser) {
      return;
    }

    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByText(primaryUser.displayName));
  },
};

export const LargeRoster: Story = {
  args: {
    rosterMode: 'large',
    searchMode: 'matches',
    failureMode: 'none',
    responseDelayMs: 0,
  },
};

export const EmptyRoster: Story = {
  args: {
    rosterMode: 'empty',
    searchMode: 'empty',
    failureMode: 'none',
    responseDelayMs: 0,
  },
};

export const SlowNetwork: Story = {
  args: {
    rosterMode: 'balanced',
    searchMode: 'matches',
    failureMode: 'none',
    responseDelayMs: 1200,
  },
};

export const ErrorHandling: Story = {
  args: {
    rosterMode: 'balanced',
    searchMode: 'error',
    failureMode: 'save',
    responseDelayMs: 0,
  },
};
