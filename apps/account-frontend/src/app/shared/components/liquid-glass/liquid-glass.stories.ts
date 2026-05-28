import type { Meta, StoryObj } from '@storybook/angular';
import { action } from 'storybook/actions';

import { LiquidGlassComponent } from './liquid-glass.component';

const meta: Meta<LiquidGlassComponent> = {
  title: 'Shared/LiquidGlass/LiquidGlass',
  component: LiquidGlassComponent,
  tags: ['autodocs'],
  args: {
    displacementScale: 70,
    blurAmount: 0.08,
    saturation: 150,
    aberrationIntensity: 2,
    elasticity: 0.15,
    cornerRadius: 999,
    padding: '16px 24px',
    overLight: false,
    mode: 'standard',
  },
  argTypes: {
    mode: {
      control: 'select',
      options: ['standard', 'polar', 'prominent', 'shader'],
    },
    onClick: { action: 'glass-click' },
  },
  render: (args) => ({
    props: { ...args, onClick: action('glass-click') },
    template: `
      <div style="width: 600px; height: 240px; position: relative; background: linear-gradient(135deg, #111827, #1f2937); border-radius: 16px; overflow: hidden;">
        <app-liquid-glass
          [displacementScale]="displacementScale"
          [blurAmount]="blurAmount"
          [saturation]="saturation"
          [aberrationIntensity]="aberrationIntensity"
          [elasticity]="elasticity"
          [cornerRadius]="cornerRadius"
          [padding]="padding"
          [overLight]="overLight"
          [mode]="mode"
          [onClick]="onClick"
        >
          <span style="font-size: 1rem; font-weight: 600;">Liquid Glass CTA</span>
        </app-liquid-glass>
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<LiquidGlassComponent>;

export const Standard: Story = {};

export const PolarMode: Story = {
  args: {
    mode: 'polar',
  },
};

export const OverLight: Story = {
  args: {
    overLight: true,
    mode: 'prominent',
  },
};
