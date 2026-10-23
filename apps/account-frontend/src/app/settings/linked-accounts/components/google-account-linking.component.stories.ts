import { signal } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import type { AccountMergeRequest } from '@cacic/shared-types';
import { GoogleAccountLinkingComponent } from './google-account-linking.component';
import { AuthService } from '../../../shared/services/auth/auth.service';
import { ApiService } from '../../../shared/services/api.service';

const request: AccountMergeRequest = {
  id: 'example-merge',
  status: 'pending',
  requesterUserId: 'marina',
  candidateUserId: 'marina-secondary',
  primaryUserId: 'marina',
  secondaryUserId: 'marina-secondary',
  primaryEmailOptions: ['marina@unesp.br', 'marina@example.org'],
  selectedPrimaryEmail: 'marina@unesp.br',
  secondaryEmails: ['marina@example.org'],
  notificationSummary: { pending: 0, completed: 0, failed: 0 },
  scores: [],
  externalScores: [],
  expiresAt: '2027-01-01T12:00:00.000Z',
  createdAt: '2026-10-23T12:00:00.000Z',
};
const meta: Meta<GoogleAccountLinkingComponent> = {
  title: 'Settings/LinkedAccounts/Google',
  component: GoogleAccountLinkingComponent,
  parameters: { layout: 'padded' },
  decorators: [
    applicationConfig({
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ email: 'marina@unesp.br', secondaryEmails: ['marina@example.org'] }),
            refresh: () => undefined,
          },
        },
        {
          provide: ApiService,
          useValue: {
            getAccountMergeRequest: () => of(request),
            watchAccountMergeRequest: () => EMPTY,
            confirmAccountMerge: () => of({ request: { ...request, status: 'processing' } }),
            cancelAccountMerge: () => of({ success: true }),
            startGoogleAccountLinking: () => EMPTY,
          },
        },
      ],
    }),
  ],
};
export default meta;
type Story = StoryObj<GoogleAccountLinkingComponent>;
export const LinkedEmails: Story = {};
export const ReviewMerge: Story = {
  decorators: [
    applicationConfig({
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ merge_request: request.id })) } },
      ],
    }),
  ],
};
