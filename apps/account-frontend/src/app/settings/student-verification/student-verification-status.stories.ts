import type { Meta, StoryObj } from '@storybook/angular';

import { StudentVerificationStatusComponent } from './student-verification-status.component';
import { authHandlers, studentVerificationHandlers } from '../../../storybook/mocks/msw-handlers';

const meta: Meta<StudentVerificationStatusComponent> = {
  title: 'Settings/StudentVerification/Status',
  component: StudentVerificationStatusComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<StudentVerificationStatusComponent>;

export const NotSubmitted: Story = {
  parameters: {
    msw: {
      handlers: [authHandlers.csrf, studentVerificationHandlers.statusNotSubmitted],
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
