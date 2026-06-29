import type { Meta, StoryObj } from '@storybook/angular';

import { PermissionsSelfServiceComponent } from './permissions-self-service.component';
import {
  authHandlers,
  keycloakPermissionHandlers,
  setKeycloakPermissionsStoryState,
  type KeycloakPermissionsStoryState,
} from '../../../storybook/mocks/msw-handlers';

type StoryArgs = PermissionsSelfServiceComponent & KeycloakPermissionsStoryState;

const render = (args: KeycloakPermissionsStoryState) => {
  setKeycloakPermissionsStoryState(args);

  return {
    props: args,
  };
};

const meta: Meta<StoryArgs> = {
  title: 'Settings/Permissões',
  component: PermissionsSelfServiceComponent,
  tags: ['autodocs'],
  render,
  args: {
    rosterMode: 'balanced',
    searchMode: 'matches',
    selfServiceMode: 'mixed',
    failureMode: 'none',
    responseDelayMs: 0,
  },
  argTypes: {
    selfServiceMode: {
      control: 'radio',
      options: ['mixed', 'groups-only', 'grants-only', 'empty'],
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

export const MixedAccess: Story = {};

export const GroupsOnly: Story = {
  args: {
    selfServiceMode: 'groups-only',
  },
};

export const DirectGrantsOnly: Story = {
  args: {
    selfServiceMode: 'grants-only',
  },
};

export const EmptyAccess: Story = {
  args: {
    selfServiceMode: 'empty',
  },
};
