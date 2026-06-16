import type { Meta, StoryObj } from '@storybook/angular';

import { StudentVerificationCardComponent } from './student-verification-card.component';
import {
  authHandlers,
  studentVerificationHandlers,
} from '../../../../storybook/mocks/msw-handlers';

const meta: Meta<StudentVerificationCardComponent> = {
  title: 'Settings/LinkedAccounts/StudentVerificationCard',
  component: StudentVerificationCardComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<StudentVerificationCardComponent>;

export const NotSubmitted: Story = {
  parameters: {
    msw: {
      handlers: [
        authHandlers.csrf,
        studentVerificationHandlers.statusNotSubmitted,
      ],
    },
  },
};

export const Pending: Story = {
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, studentVerificationHandlers.statusPending],
    },
  },
};

export const Approved: Story = {
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, studentVerificationHandlers.statusApproved],
    },
  },
};

export const Rejected: Story = {
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, studentVerificationHandlers.statusRejected],
    },
  },
};

export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, studentVerificationHandlers.statusError],
    },
  },
};
