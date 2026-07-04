import type { Meta, StoryObj } from '@storybook/angular';
import { screen, userEvent, within } from 'storybook/test';

import { DiscordManagedRoleOverridesComponent } from './discord-managed-role-overrides.component';
import {
  authHandlers,
  discordManagedRoleOverrideHandlers,
  setDiscordManagedRoleOverridesStoryState,
  type DiscordManagedRoleOverridesStoryState,
} from '../../../storybook/mocks/msw-handlers';
import { mockKeycloakPermissionUsers } from '../../../storybook/mocks/component-mocks';

type StoryArgs = DiscordManagedRoleOverridesComponent & DiscordManagedRoleOverridesStoryState;

const render = (args: DiscordManagedRoleOverridesStoryState) => {
  setDiscordManagedRoleOverridesStoryState(args);

  return {
    props: args,
  };
};

const searchFirstStoryUser = async (canvasElement: HTMLElement): Promise<void> => {
  const primaryUser = mockKeycloakPermissionUsers[0];
  if (!primaryUser) {
    return;
  }

  const canvas = within(canvasElement);
  await userEvent.type(await canvas.findByLabelText('Nome, CPF ou e-mail'), primaryUser.displayName.slice(0, 6));
  await userEvent.click(await canvas.findByRole('button', { name: /buscar pessoa/i }));
  await userEvent.click(await canvas.findByText(primaryUser.displayName));
};

const meta: Meta<StoryArgs> = {
  title: 'Admin/DiscordManagedRoleOverrides',
  component: DiscordManagedRoleOverridesComponent,
  tags: ['autodocs'],
  render,
  args: {
    overrideMode: 'balanced',
    searchMode: 'matches',
    failureMode: 'none',
    responseDelayMs: 0,
  },
  argTypes: {
    overrideMode: {
      control: 'radio',
      options: ['balanced', 'empty', 'dense'],
    },
    searchMode: {
      control: 'radio',
      options: ['matches', 'empty', 'error'],
    },
    failureMode: {
      control: 'radio',
      options: ['none', 'catalog', 'save', 'delete'],
    },
    responseDelayMs: {
      control: { type: 'range', min: 0, max: 1500, step: 100 },
    },
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [authHandlers.csrf, ...discordManagedRoleOverrideHandlers],
    },
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const InteractiveWorkspace: Story = {
  play: async ({ canvasElement }) => {
    await searchFirstStoryUser(canvasElement);
  },
};

export const EmptyOverrides: Story = {
  args: {
    overrideMode: 'empty',
    searchMode: 'matches',
    failureMode: 'none',
    responseDelayMs: 0,
  },
};

export const DenseOverrides: Story = {
  args: {
    overrideMode: 'dense',
    searchMode: 'matches',
    failureMode: 'none',
    responseDelayMs: 0,
  },
};

export const SlowLoading: Story = {
  args: {
    overrideMode: 'balanced',
    searchMode: 'matches',
    failureMode: 'none',
    responseDelayMs: 1200,
  },
};

export const SearchWithoutResults: Story = {
  args: {
    overrideMode: 'balanced',
    searchMode: 'empty',
    failureMode: 'none',
    responseDelayMs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText('Nome, CPF ou e-mail'), 'Pessoa ausente');
    await userEvent.click(await canvas.findByRole('button', { name: /buscar pessoa/i }));
  },
};

export const SearchError: Story = {
  args: {
    overrideMode: 'balanced',
    searchMode: 'error',
    failureMode: 'none',
    responseDelayMs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText('Nome, CPF ou e-mail'), 'Erro Keycloak');
    await userEvent.click(await canvas.findByRole('button', { name: /buscar pessoa/i }));
  },
};

export const LoadError: Story = {
  args: {
    overrideMode: 'balanced',
    searchMode: 'matches',
    failureMode: 'catalog',
    responseDelayMs: 0,
  },
};

export const SaveError: Story = {
  args: {
    overrideMode: 'empty',
    searchMode: 'matches',
    failureMode: 'save',
    responseDelayMs: 0,
  },
  play: async ({ canvasElement }) => {
    await searchFirstStoryUser(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText('Motivo'), 'Teste de falha ao salvar');
    await userEvent.click(await canvas.findByRole('button', { name: /adicionar exceção/i }));
  },
};

export const DeleteError: Story = {
  args: {
    overrideMode: 'balanced',
    searchMode: 'matches',
    failureMode: 'delete',
    responseDelayMs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const deleteButtons = await canvas.findAllByRole('button', { name: /remover exceção/i });
    await userEvent.click(deleteButtons[0]);
    await userEvent.click(await screen.findByRole('button', { name: /remover/i }));
  },
};
