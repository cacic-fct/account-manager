import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth/auth.service';
import { LoggerService } from './logger.service';
import { PrivacyService } from './privacy.service';

describe('PrivacyService error recovery', () => {
  const api = { getPrivacySettings: vi.fn(), updatePrivacySetting: vi.fn(), bulkUpdatePrivacySettings: vi.fn() };
  const auth = { isAuthenticated: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    auth.isAuthenticated.mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        PrivacyService,
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    });
  });

  it('preserves the analytics initialization fallback while exposing a safe, retryable load error', async () => {
    api.getPrivacySettings.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 503,
            error: { message: 'private provider diagnostics' },
          }),
      ),
    );
    const service = TestBed.inject(PrivacyService);

    expect(await firstValueFrom(service.loadSettings())).toBeNull();
    expect(service.loadError()).toContain('Não foi possível carregar suas preferências de privacidade.');
    expect(service.loadError()).not.toContain('private');
    expect(service.isLoading()).toBe(false);

    api.getPrivacySettings.mockReturnValue(of({ settings: {} }));
    await firstValueFrom(service.loadSettings());
    expect(service.loadError()).toBeNull();
    expect(service.isLoading()).toBe(false);
  });

  it('reports unauthenticated saves as errors so consumers can clear their loading states', async () => {
    auth.isAuthenticated.mockReturnValue(false);
    const service = TestBed.inject(PrivacyService);

    await expect(firstValueFrom(service.updateSetting('analytics_tracking', false))).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      firstValueFrom(service.bulkUpdateSettings([{ key: 'analytics_tracking', enabled: false }])),
    ).rejects.toMatchObject({ status: 401 });
    expect(api.updatePrivacySetting).not.toHaveBeenCalled();
    expect(api.bulkUpdatePrivacySettings).not.toHaveBeenCalled();
  });
});
