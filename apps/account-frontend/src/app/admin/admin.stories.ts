import type { Meta, StoryObj } from '@storybook/angular';
import { AdminComponent } from './admin.component';

const meta: Meta<AdminComponent> = {
  title: 'Admin/Navigation',
  component: AdminComponent,
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<AdminComponent>;
export const Default: Story = {};
