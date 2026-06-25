import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator } from '@storybook/angular';

import { ValuePropositionComponent } from './value-proposition.component';

const meta: Meta<ValuePropositionComponent> = {
  title: 'Home/ValueProposition',
  component: ValuePropositionComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<ValuePropositionComponent>;

export const Default: Story = {};

export const ConstrainedWidth: Story = {
  name: 'Largura de tablet',
  decorators: [
    componentWrapperDecorator(
      (story) => `<div style="max-width: 760px; margin: 0 auto;">${story}</div>`,
    ),
  ],
};

export const DarkSurface: Story = {
  name: 'Superfície escura',
  parameters: {
    backgrounds: { default: 'dark' },
  },
  decorators: [
    componentWrapperDecorator(
      (story) =>
        `<div style="color-scheme: dark; background: #101418;">${story}</div>`,
    ),
  ],
};
