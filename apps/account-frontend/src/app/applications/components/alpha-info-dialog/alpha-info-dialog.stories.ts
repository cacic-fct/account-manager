import type { Meta, StoryObj } from '@storybook/angular';

import { AlphaInfoDialogComponent } from './alpha-info-dialog.component';

const meta: Meta<AlphaInfoDialogComponent> = {
  title: 'Applications/Dialogs/AlphaInfoDialog',
  component: AlphaInfoDialogComponent,
  tags: ['autodocs'],
  render: () => ({
    template: `
      <div style="max-width: 560px; padding: 16px; border-radius: 12px; background: var(--mat-sys-surface);">
        <app-alpha-info-dialog />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<AlphaInfoDialogComponent>;

export const Default: Story = {};
