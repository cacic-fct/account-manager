import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of } from 'rxjs';
import { UnespRole } from '@cacic/shared-types';
import { EditProfileComponent } from './edit.component';
import { AuthService } from '../../../shared/services/auth/auth.service';
import { ApiService } from '../../../shared/services/api.service';
import { mockUser } from '../../../../storybook/mocks/component-mocks';

const meta: Meta<EditProfileComponent> = {
  title: 'Settings/Profile/Edit',
  component: EditProfileComponent,
  parameters: { layout: 'fullscreen' },
  decorators: [
    applicationConfig({
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: () => ({
              ...mockUser,
              fullname: 'Marina Oliveira',
              phone: '+5518999990000',
              identityDocument: '12345678909',
              enrollmentNumber: '202412345',
              unespRole: UnespRole.ALUNO_GRADUACAO,
            }),
          },
        },
        {
          provide: ApiService,
          useValue: {
            checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: true }),
          },
        },
      ],
    }),
  ],
};
export default meta;
type Story = StoryObj<EditProfileComponent>;
export const Default: Story = {};
