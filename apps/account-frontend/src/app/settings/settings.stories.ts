import { signal } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { SettingsComponent } from './settings.component';
import { AuthService } from '../shared/services/auth/auth.service';
import { mockUser } from '../../storybook/mocks/component-mocks';

const account = (isAdmin: boolean, fullname = 'Marina Oliveira') =>
  applicationConfig({
    providers: [
      {
        provide: AuthService,
        useValue: {
          currentUser: signal({ ...mockUser, fullname, email: 'marina@example.org', isAdmin }),
          logout: () => undefined,
        },
      },
    ],
  });

const meta: Meta<SettingsComponent> = {
  title: 'Settings/Navigation',
  component: SettingsComponent,
  parameters: { layout: 'fullscreen' },
  decorators: [account(false)],
};
export default meta;
type Story = StoryObj<SettingsComponent>;
export const Default: Story = {};
export const Administrator: Story = { decorators: [account(true)] };
export const LongName: Story = { decorators: [account(false, 'Marina de Oliveira Albuquerque e Vasconcelos')] };
