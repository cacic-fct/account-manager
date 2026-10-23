import type { Meta, StoryObj } from '@storybook/angular';
import { NotFoundComponent } from './not-found.component';

const meta: Meta<NotFoundComponent> = {
  title: 'Pages/NotFound',
  component: NotFoundComponent,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<NotFoundComponent>;

export const Default: Story = {};

export const Dark: Story = {
  globals: { theme: 'dark' },
};
