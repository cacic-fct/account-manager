import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, http, HttpResponse } from 'msw';
import { Observable } from 'rxjs';

import { LgpdComponent } from './lgpd.component';
import { AuthService } from '../../../shared/services/auth/auth.service';
import { CacheService } from '../../../shared/services/cache.service';
import type {
  DeleteAccountResponse,
  LgpdRequest,
} from '../../../shared/services/api.service';
import { authHandlers } from '../../../../storybook/mocks/msw-handlers';

type LgpdScenario =
  | 'empty'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'mixed'
  | 'cooldown';

type LgpdFailureMode = 'none' | 'load' | 'create' | 'delete';

type LgpdStoryState = {
  scenario: LgpdScenario;
  failureMode: LgpdFailureMode;
  responseDelayMs: number;
};

type StoryArgs = LgpdComponent & LgpdStoryState;

const API_BASE = '*/api';
const defaultStoryState: LgpdStoryState = {
  scenario: 'mixed',
  failureMode: 'none',
  responseDelayMs: 0,
};

let storyState = defaultStoryState;
let createdRequest: LgpdRequest | null = null;

class NoCacheStoryCacheService {
  getOrSet<T>(
    _key: string,
    source: () => Observable<T>,
  ): Observable<T> {
    return source();
  }

  invalidate(): void {
    return undefined;
  }

  invalidatePattern(): void {
    return undefined;
  }

  clear(): void {
    return undefined;
  }
}

const render = (args: LgpdStoryState) => {
  storyState = {
    ...defaultStoryState,
    ...args,
  };
  createdRequest = null;

  return {
    props: args,
  };
};

const waitForStory = async (): Promise<void> => {
  if (storyState.responseDelayMs > 0) {
    await delay(storyState.responseDelayMs);
  }
};

const isoMinutesAgo = (minutes: number): Date =>
  new Date(Date.now() - minutes * 60 * 1000);

const isoDaysAgo = (days: number): Date =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const isoDaysFromNow = (days: number): Date =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const makeRequest = (
  id: string,
  status: LgpdRequest['status'],
  createdAt: Date,
  overrides: Partial<LgpdRequest> = {},
): LgpdRequest => ({
  id,
  status,
  createdAt,
  ...overrides,
});

const getRequestsForScenario = (): LgpdRequest[] => {
  const completed = makeRequest('lgpd-completed', 'completed', isoDaysAgo(2), {
    fileSize: 1_924_608,
    downloadedAt: isoDaysAgo(1),
    expiresAt: isoDaysFromNow(5),
  });
  const expired = makeRequest('lgpd-expired', 'completed', isoDaysAgo(12), {
    fileSize: 884_224,
    expiresAt: isoDaysAgo(4),
  });
  const failed = makeRequest('lgpd-failed', 'failed', isoDaysAgo(3), {
    errorMessage: 'Falha ao gerar arquivo de exportacao.',
  });
  const processing = makeRequest('lgpd-processing', 'processing', isoMinutesAgo(18));
  const pending = makeRequest('lgpd-pending', 'pending', isoMinutesAgo(4));
  const cooldown = makeRequest('lgpd-cooldown', 'completed', isoMinutesAgo(35), {
    fileSize: 524_288,
    expiresAt: isoDaysFromNow(6),
  });

  const scenarioRequests: Record<LgpdScenario, LgpdRequest[]> = {
    empty: [],
    pending: [pending],
    processing: [processing],
    completed: [completed],
    expired: [expired],
    failed: [failed],
    mixed: [processing, completed, expired, failed],
    cooldown: [cooldown],
  };

  return [
    ...(createdRequest ? [createdRequest] : []),
    ...scenarioRequests[storyState.scenario],
  ];
};

const handlers = [
  authHandlers.csrf,
  http.get(`${API_BASE}/lgpd/requests`, async () => {
    await waitForStory();

    if (storyState.failureMode === 'load') {
      return HttpResponse.json(
        { message: 'Erro ao carregar solicitacoes LGPD.' },
        { status: 500 },
      );
    }

    return HttpResponse.json(getRequestsForScenario());
  }),
  http.post(`${API_BASE}/lgpd/request`, async () => {
    await waitForStory();

    if (storyState.failureMode === 'create') {
      return HttpResponse.json(
        { message: 'Aguarde antes de criar uma nova solicitacao.' },
        { status: 429 },
      );
    }

    createdRequest = makeRequest('lgpd-created-story', 'pending', new Date());

    return HttpResponse.json({
      ...createdRequest,
      userId: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad',
      email: 'joao.silva@unesp.br',
      updatedAt: new Date(),
    });
  }),
  http.get(`${API_BASE}/lgpd/download/:requestId`, async () => {
    await waitForStory();

    return HttpResponse.text('Mock LGPD export file', {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="dados-lgpd.zip"',
      },
    });
  }),
  http.post(`${API_BASE}/lgpd/delete-account`, async () => {
    await waitForStory();

    if (storyState.failureMode === 'delete') {
      return HttpResponse.json(
        { message: 'Nao foi possivel solicitar a exclusao agora.' },
        { status: 500 },
      );
    }

    const response: DeleteAccountResponse = {
      message: 'Solicitacao de exclusao registrada.',
      requestedAt: new Date(),
      servicesNotified: ['keycloak', 'users', 'integrations'],
      scheduledHardDeleteAt: isoDaysFromNow(365),
    };

    return HttpResponse.json(response);
  }),
];

const meta: Meta<StoryArgs> = {
  title: 'Settings/Privacy/LGPD',
  component: LgpdComponent,
  tags: ['autodocs'],
  render,
  decorators: [
    applicationConfig({
      providers: [
        {
          provide: AuthService,
          useValue: {
            logout: () => undefined,
          },
        },
        {
          provide: CacheService,
          useClass: NoCacheStoryCacheService,
        },
      ],
    }),
  ],
  args: defaultStoryState,
  argTypes: {
    scenario: {
      control: 'radio',
      options: [
        'empty',
        'pending',
        'processing',
        'completed',
        'expired',
        'failed',
        'mixed',
        'cooldown',
      ],
    },
    failureMode: {
      control: 'radio',
      options: ['none', 'load', 'create', 'delete'],
    },
    responseDelayMs: {
      control: { type: 'range', min: 0, max: 1500, step: 100 },
    },
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers,
    },
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const MixedHistory: Story = {};

export const EmptyHistory: Story = {
  args: {
    scenario: 'empty',
  },
};

export const PendingRequest: Story = {
  args: {
    scenario: 'pending',
  },
};

export const ProcessingRequest: Story = {
  args: {
    scenario: 'processing',
  },
};

export const ReadyToDownload: Story = {
  args: {
    scenario: 'completed',
  },
};

export const ExpiredDownload: Story = {
  args: {
    scenario: 'expired',
  },
};

export const FailedRequest: Story = {
  args: {
    scenario: 'failed',
  },
};

export const CooldownBlocked: Story = {
  args: {
    scenario: 'cooldown',
  },
};

export const SlowNetwork: Story = {
  args: {
    scenario: 'mixed',
    responseDelayMs: 1200,
  },
};

export const LoadError: Story = {
  args: {
    scenario: 'mixed',
    failureMode: 'load',
  },
};

export const CreateError: Story = {
  args: {
    scenario: 'empty',
    failureMode: 'create',
  },
};

export const DeleteError: Story = {
  args: {
    scenario: 'mixed',
    failureMode: 'delete',
  },
};
