import type { Meta, StoryObj } from '@storybook/angular';

import { AppCardComponent } from './app-card.component';
import { mockApplication } from '../../../../storybook/mocks/component-mocks';

const meta: Meta<AppCardComponent> = {
  title: 'Applications/AppCard',
  component: AppCardComponent,
  tags: ['autodocs'],
  argTypes: {
    app: { control: 'object' },
  },
  args: {
    app: mockApplication,
  },
};

export default meta;
type Story = StoryObj<AppCardComponent>;

export const Default: Story = {};

export const WithoutUrl: Story = {
  args: {
    app: {
      ...mockApplication,
      url: undefined,
      description: 'Aplicação sem link direto configurado.',
    },
  },
};
