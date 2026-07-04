import type { Meta, StoryObj } from '@storybook/angular';
import { action } from 'storybook/actions';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { UniversityValidationDialogComponent } from './university-validation-dialog.component';
import { authHandlers, universityValidationHandlers } from '../../../../../storybook/mocks/msw-handlers';

const defaultFile = new File(['dummy-pdf'], 'documento.pdf', {
  type: 'application/pdf',
});

const meta: Meta<UniversityValidationDialogComponent> = {
  title: 'Settings/LinkedAccounts/UniversityValidationDialog',
  component: UniversityValidationDialogComponent,
  tags: ['autodocs'],
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        providers: [
          {
            provide: MAT_DIALOG_DATA,
            useValue: { pdfFile: defaultFile },
          },
          {
            provide: MatDialogRef,
            useValue: {
              close: action('dialog-close'),
            },
          },
        ],
      },
      template: `
        <div style="max-width: 560px; padding: 16px; border-radius: 12px; background: var(--mat-sys-surface);">
          <app-university-validation-dialog />
        </div>
      `,
    }),
  ],
};

export default meta;
type Story = StoryObj<UniversityValidationDialogComponent>;

export const Default: Story = {
  parameters: {
    msw: {
      handlers: [
        authHandlers.csrf,
        universityValidationHandlers.cooldownStatus,
        universityValidationHandlers.atomicCaptcha,
        universityValidationHandlers.refreshCaptcha,
        universityValidationHandlers.validateAtomic,
      ],
    },
  },
};
