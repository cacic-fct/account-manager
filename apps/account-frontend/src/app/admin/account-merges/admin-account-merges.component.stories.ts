import type { Meta, StoryObj } from '@storybook/angular';
import { userEvent, within } from 'storybook/test';
import { fakerPT_BR as faker } from '@faker-js/faker';
import { AdminAccountMergesComponent } from './admin-account-merges.component';
import {
  adminAccountMergeHandlers,
  authHandlers,
  setAdminAccountMergesStoryState,
  type AdminAccountMergesStoryState,
} from '../../../storybook/mocks/msw-handlers';
import { mockKeycloakPermissionUsers } from '../../../storybook/mocks/component-mocks';

type StoryArgs = AdminAccountMergesComponent & AdminAccountMergesStoryState;

faker.seed(20260723);

const render = (args: AdminAccountMergesStoryState) => {
  setAdminAccountMergesStoryState(args);
  return { props: args };
};

const selectAccount = async (canvasElement: HTMLElement, position: number): Promise<void> => {
  const canvas = within(canvasElement);
  const user = mockKeycloakPermissionUsers[position];
  if (!user) {
    return;
  }

  const inputs = await canvas.findAllByLabelText('Nome, CPF ou e-mail');
  const searchButtons = await canvas.findAllByRole('button', { name: /buscar pessoa/i });
  const input = inputs[position];
  const searchButton = searchButtons[position];
  if (!input || !searchButton) {
    return;
  }

  await userEvent.type(input, user.displayName.slice(0, 6));
  await userEvent.click(searchButton);
  await userEvent.click(await canvas.findByRole('button', { name: new RegExp(user.displayName, 'i') }));
};

const prepareMerge = async (canvasElement: HTMLElement, confirm = false): Promise<void> => {
  await selectAccount(canvasElement, 0);
  await selectAccount(canvasElement, 1);

  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: /preparar unificação/i }));

  if (confirm) {
    await userEvent.click(await canvas.findByRole('button', { name: /confirmar unificação/i }));
  }
};

const meta: Meta<StoryArgs> = {
  title: 'Admin/Unificação de contas',
  component: AdminAccountMergesComponent,
  tags: ['autodocs'],
  render,
  args: {
    mergeState: 'selection',
    searchMode: 'matches',
    failureMode: 'none',
    responseDelayMs: 0,
  },
  argTypes: {
    mergeState: {
      control: 'radio',
      options: ['selection', 'pending', 'pending_score', 'processing', 'pending_merge', 'completed', 'failed', 'expired'],
    },
    searchMode: {
      control: 'radio',
      options: ['matches', 'empty', 'error'],
    },
    failureMode: {
      control: 'radio',
      options: ['none', 'create', 'confirm', 'cancel'],
    },
    responseDelayMs: {
      control: { type: 'range', min: 0, max: 1500, step: 100 },
    },
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [authHandlers.csrf, ...adminAccountMergeHandlers],
    },
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const SelectAccounts: Story = {};

export const AwaitingPrimaryEmail: Story = {
  args: { mergeState: 'pending', searchMode: 'matches', failureMode: 'none', responseDelayMs: 0 },
  play: async ({ canvasElement }) => prepareMerge(canvasElement),
};

export const CalculatingScores: Story = {
  args: { mergeState: 'pending_score', searchMode: 'matches', failureMode: 'none', responseDelayMs: 0 },
  play: async ({ canvasElement }) => prepareMerge(canvasElement, true),
};

export const AwaitingExternalNotifications: Story = {
  args: { mergeState: 'pending_merge', searchMode: 'matches', failureMode: 'none', responseDelayMs: 0 },
  play: async ({ canvasElement }) => prepareMerge(canvasElement, true),
};

export const Completed: Story = {
  args: { mergeState: 'completed', searchMode: 'matches', failureMode: 'none', responseDelayMs: 0 },
  play: async ({ canvasElement }) => prepareMerge(canvasElement, true),
};

export const Failed: Story = {
  args: { mergeState: 'failed', searchMode: 'matches', failureMode: 'none', responseDelayMs: 0 },
  play: async ({ canvasElement }) => prepareMerge(canvasElement, true),
};

export const Expired: Story = {
  args: { mergeState: 'expired', searchMode: 'matches', failureMode: 'none', responseDelayMs: 0 },
  play: async ({ canvasElement }) => prepareMerge(canvasElement, true),
};

export const NoMatchingAccounts: Story = {
  args: { mergeState: 'selection', searchMode: 'empty', failureMode: 'none', responseDelayMs: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = (await canvas.findAllByLabelText('Nome, CPF ou e-mail'))[0];
    const searchButton = (await canvas.findAllByRole('button', { name: /buscar pessoa/i }))[0];
    if (input && searchButton) {
      await userEvent.type(input, faker.person.fullName());
      await userEvent.click(searchButton);
    }
  },
};

export const SearchError: Story = {
  args: { mergeState: 'selection', searchMode: 'error', failureMode: 'none', responseDelayMs: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = (await canvas.findAllByLabelText('Nome, CPF ou e-mail'))[0];
    const searchButton = (await canvas.findAllByRole('button', { name: /buscar pessoa/i }))[0];
    if (input && searchButton) {
      await userEvent.type(input, faker.person.fullName());
      await userEvent.click(searchButton);
    }
  },
};

export const CreateError: Story = {
  args: { mergeState: 'pending', searchMode: 'matches', failureMode: 'create', responseDelayMs: 0 },
  play: async ({ canvasElement }) => prepareMerge(canvasElement),
};

export const ConfirmError: Story = {
  args: { mergeState: 'pending_score', searchMode: 'matches', failureMode: 'confirm', responseDelayMs: 0 },
  play: async ({ canvasElement }) => prepareMerge(canvasElement, true),
};

export const CancelError: Story = {
  args: { mergeState: 'pending', searchMode: 'matches', failureMode: 'cancel', responseDelayMs: 0 },
  play: async ({ canvasElement }) => {
    await prepareMerge(canvasElement);
    await userEvent.click(await within(canvasElement).findByRole('button', { name: /cancelar/i }));
  },
};

export const SlowNetwork: Story = {
  args: { mergeState: 'pending', searchMode: 'matches', failureMode: 'none', responseDelayMs: 1200 },
  play: async ({ canvasElement }) => prepareMerge(canvasElement),
};
