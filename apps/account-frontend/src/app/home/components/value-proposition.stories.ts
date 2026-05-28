import type { Meta, StoryObj } from '@storybook/angular';

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
