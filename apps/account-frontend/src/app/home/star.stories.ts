import type { Meta, StoryObj } from '@storybook/angular';

import { StarComponent } from './star.component';
import type { StarConfig } from './star-pattern-generator';

const baseStar: StarConfig = {
  size: 3,
  opacity: 0.8,
  x: 50,
  y: 50,
  twinkleDelay: 0,
  twinkleDuration: 3,
  twinkleAnimation: 1,
  shouldTwinkle: true,
};

const meta: Meta<StarComponent> = {
  title: 'Home/Star',
  component: StarComponent,
  tags: ['autodocs'],
  render: (args) => ({
    props: args,
    template: `
      <div style="position: relative; width: 320px; height: 180px; background: radial-gradient(circle at center, #1f2937, #020617); border-radius: 12px; overflow: hidden;">
        <app-star [star]="star" />
      </div>
    `,
  }),
  argTypes: {
    star: { control: 'object' },
  },
  args: {
    star: baseStar,
  },
};

export default meta;
type Story = StoryObj<StarComponent>;

export const Twinkling: Story = {};

export const StaticDim: Story = {
  args: {
    star: {
      ...baseStar,
      shouldTwinkle: false,
      opacity: 0.4,
      size: 2,
    },
  },
};
