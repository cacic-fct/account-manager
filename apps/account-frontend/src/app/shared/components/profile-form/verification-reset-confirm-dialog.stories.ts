import type { Meta, StoryObj } from '@storybook/angular';
import { action } from 'storybook/actions';
import { MatDialogRef } from '@angular/material/dialog';

import { VerificationResetConfirmDialogComponent } from './verification-reset-confirm-dialog.component';

const meta: Meta<VerificationResetConfirmDialogComponent> = {
  title: 'Shared/Dialogs/VerificationResetConfirmDialog',
  component: VerificationResetConfirmDialogComponent,
  tags: ['autodocs'],
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        providers: [
          {
            provide: MatDialogRef,
            useValue: { close: action('dialog-close') },
          },
        ],
      },
    }),
  ],
  render: () => ({
    template: `
      <div style="max-width: 540px; padding: 16px; background: var(--mat-sys-surface); border-radius: 12px;">
        <app-verification-reset-confirm-dialog />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<VerificationResetConfirmDialogComponent>;

export const Default: Story = {};
