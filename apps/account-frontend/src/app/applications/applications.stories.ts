import { signal } from '@angular/core';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, http, HttpResponse } from 'msw';
import type { Application } from '@cacic/shared-types';
import { ApplicationsComponent } from './applications.component';
import { AuthService } from '../shared/services/auth/auth.service';
import { mockUser } from '../../storybook/mocks/component-mocks';
import { discordHandlers } from '../../storybook/mocks/msw-handlers';

// Illustrative catalog for UI review, not the live service catalog.
const catalog: Application[] = [
  {
    id: 'events',
    name: 'Eventos CACiC',
    description: 'Inscreva-se nas atividades e consulte seus certificados.',
    url: 'https://eventos.example.org',
    enabled: true,
  },
  {
    id: 'vote',
    name: 'Votações',
    description: 'Acompanhe as eleições e participe das votações da comunidade.',
    url: 'https://voto.example.org',
    enabled: true,
  },
  {
    id: 'files',
    name: 'Arquivos compartilhados',
    description: 'Consulte os documentos e materiais compartilhados com você.',
    url: 'https://arquivos.example.org',
    enabled: true,
  },
  {
    id: 'community',
    name: 'Comunidade',
    description: 'Um espaço para conectar estudantes e iniciativas.',
    enabled: false,
  },
];

const applications = (items: Application[]) => http.get('*/auth/applications', () => HttpResponse.json(items));

const meta: Meta<ApplicationsComponent> = {
  title: 'Applications/Page',
  component: ApplicationsComponent,
  parameters: {
    layout: 'fullscreen',
    msw: { handlers: [applications(catalog), discordHandlers.linked] },
  },
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([], withDisabledInitialNavigation()),
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({
              ...mockUser,
              displayName: 'Marina Oliveira',
              email: 'marina@example.org',
              isAdmin: true,
            }),
            logoutError: signal(null),
            logout: () => undefined,
          },
        },
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<ApplicationsComponent>;

export const Default: Story = {};

export const SetupIntegrations: Story = {
  parameters: { msw: { handlers: [applications(catalog), discordHandlers.notLinked] } },
};

export const Empty: Story = {
  parameters: { msw: { handlers: [applications([]), discordHandlers.notLinked] } },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/auth/applications', async () => {
          await delay('infinite');
          return HttpResponse.json([]);
        }),
        discordHandlers.delayed,
      ],
    },
  },
};

export const Error: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/auth/applications', () => new HttpResponse(null, { status: 503 })),
        http.get('*/discord/status', () => new HttpResponse(null, { status: 503 })),
      ],
    },
  },
};

export const LongContent: Story = {
  parameters: {
    msw: {
      handlers: [
        applications([
          {
            ...catalog[0],
            name: 'Portal de atividades acadêmicas e projetos de extensão universitária',
            description:
              'Consulte inscrições, acompanhe atividades e encontre os materiais disponibilizados pelos responsáveis por cada projeto.',
          },
        ]),
        discordHandlers.linked,
      ],
    },
  },
};

export const WithoutProfilePicture: Story = {
  decorators: [
    applicationConfig({
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({
              ...mockUser,
              displayName: 'Marina Oliveira',
              email: 'marina@example.org',
              picture: undefined,
            }),
            logoutError: signal(null),
            logout: () => undefined,
          },
        },
      ],
    }),
  ],
};
