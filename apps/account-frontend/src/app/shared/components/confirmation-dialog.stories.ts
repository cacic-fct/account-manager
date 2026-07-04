import type { Meta, StoryObj } from '@storybook/angular';
import { action } from 'storybook/actions';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { ConfirmationDialogComponent, type ConfirmationDialogData } from './confirmation-dialog.component';

const createDialogRefStub = () => ({
  close: action('dialog-close'),
});

const defaultData: ConfirmationDialogData = {
  title: 'Número fixo detectado',
  message:
    'Tem certeza que deseja incluir um número fixo?\n\n(14) 3322-4455\n\nAo inserir um número que não possui WhatsApp, pode ser que não entremos em contato!',
  confirmText: 'Entendi',
  cancelText: 'Cancelar',
};

const meta: Meta<ConfirmationDialogComponent> = {
  title: 'Shared/Dialogs/ConfirmationDialog',
  component: ConfirmationDialogComponent,
  tags: ['autodocs'],
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        providers: [
          { provide: MatDialogRef, useValue: createDialogRefStub() },
          { provide: MAT_DIALOG_DATA, useValue: defaultData },
        ],
      },
    }),
  ],
  render: () => ({
    template: `
      <div style="max-width: 540px; padding: 16px; background: var(--mat-sys-surface); border-radius: 12px;">
        <app-confirmation-dialog />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<ConfirmationDialogComponent>;

export const Default: Story = {};

export const CustomTexts: Story = {
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        providers: [
          { provide: MatDialogRef, useValue: createDialogRefStub() },
          {
            provide: MAT_DIALOG_DATA,
            useValue: {
              title: 'Excluir conta',
              message: 'Essa ação não poderá ser desfeita.',
              confirmText: 'Excluir',
              cancelText: 'Voltar',
            } as ConfirmationDialogData,
          },
        ],
      },
    }),
  ],
};
