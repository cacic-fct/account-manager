import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent, within } from 'storybook/test';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { ProfileFormComponent } from './profile-form.component';
import { AuthService } from '../../services/auth/auth.service';
import { ApiService } from '../../services/api.service';
import { mockUser } from '../../../../storybook/mocks/component-mocks';

const createAuthStub = (overrides?: Partial<typeof mockUser>) => ({
  currentUser: () => ({ ...mockUser, ...overrides }),
});

const meta: Meta<ProfileFormComponent> = {
  title: 'Shared/Forms/ProfileForm',
  component: ProfileFormComponent,
  tags: ['autodocs'],
  argTypes: {
    isEditMode: { control: 'boolean' },
    initialData: { control: 'object' },
    formValid: { action: 'formValid' },
    formData: { action: 'formData' },
    formChange: { action: 'formChange' },
  },
  args: {
    isEditMode: false,
    initialData: {},
  },
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        providers: [
          {
            provide: AuthService,
            useValue: createAuthStub(),
          },
          {
            provide: ApiService,
            useValue: {
              checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: true }),
            },
          },
        ],
      },
    }),
  ],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<ProfileFormComponent>;

export const Onboarding: Story = {};

export const EditModeVerified: Story = {
  args: {
    isEditMode: true,
    initialData: {
      fullname: 'João Silva',
      countryCode: 'BR',
      phone: '(11) 99999-9999',
      identityDocument: '123.456.789-09',
      enrollmentNumber: '2024123456',
    },
  },
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        providers: [
          {
            provide: AuthService,
            useValue: createAuthStub({
              unespRoleVerified: true,
            }),
          },
          {
            provide: ApiService,
            useValue: {
              checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: false }),
            },
          },
        ],
      },
    }),
  ],
};

export const ForeignerFlow: Story = {
  args: {
    isEditMode: false,
    initialData: {
      fullname: 'Alex Doe',
      countryCode: 'US',
      isForeigner: true,
      identityDocument: 'P1234567',
      phone: '(415) 555-0101',
    },
  },
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        providers: [
          {
            provide: AuthService,
            useValue: createAuthStub({
              email: 'alex@example.com',
              isForeigner: true,
            }),
          },
          {
            provide: ApiService,
            useValue: {
              checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: false }),
            },
          },
        ],
      },
    }),
  ],
};

const saveFailureStory = (status: number, isEditMode: boolean): Story => ({
  args: {
    isEditMode,
    layoutMode: 'all-in-one',
    initialData: {
      fullname: 'Ana Example',
      phone: '(18) 99999-0000',
      countryCode: 'BR',
      isForeigner: true,
      identityDocument: 'P1234567',
      passportCountry: 'AR',
    },
  },
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        providers: [
          { provide: AuthService, useValue: createAuthStub({ unespRoleVerified: false }) },
          {
            provide: ApiService,
            useValue: {
              checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: false }),
              updateProfile: () => throwError(() => new HttpErrorResponse({ status })),
            },
          },
        ],
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Salvar' }));
    await expect(await canvas.findByRole('alert')).toBeVisible();
  },
});

export const OnboardingSaveFailure = saveFailureStory(503, false);
export const EditSaveConnectionFailure = saveFailureStory(0, true);
