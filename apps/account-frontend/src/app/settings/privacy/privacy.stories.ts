import type { Meta, StoryObj } from '@storybook/angular';
import { PrivacyComponent } from './privacy.component';
const meta: Meta<PrivacyComponent> = {
  title: 'Settings/Privacy/Navigation',
  component: PrivacyComponent,
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<PrivacyComponent>;
export const Default: Story = {};
