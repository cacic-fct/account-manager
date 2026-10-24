import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of, throwError } from 'rxjs';
import type { TotpSeed } from '@cacic/shared-types';
import { ApiService } from '../../../shared/services/api.service';
import { LoggerService } from '../../../shared/services/logger.service';
import { CsrfService } from '../../../shared/services/csrf.service';
import { ConfirmRotateTotpDialog, TotpComponent } from './totp.component';

const seed: TotpSeed = {
  userId: 'user-1',
  primaryEmail: 'user@example.test',
  seed: 'JBSWY3DPEHPK3PXP',
  algorithm: 'SHA512',
  digits: 6,
  periodSeconds: 30,
  serverTime: '2026-10-23T12:00:00Z',
};
const loginUrl = 'http://localhost:3000/api/auth/login/redirect?action=rotate-totp';

describe(TotpComponent.name, () => {
  let fixture: ComponentFixture<TotpComponent>;
  const api = {
    getTotpStatus: vi.fn(),
    getOrCreateTotpSeed: vi.fn(),
    rotateTotpSeed: vi.fn(),
    getTotpRotationLoginUrl: vi.fn(),
  };
  const dialog = { open: vi.fn() };
  const snackBar = { open: vi.fn() };
  const csrf = { fetchToken: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    api.getTotpStatus.mockReturnValue(of({ configured: true, ...seed }));
    api.getOrCreateTotpSeed.mockReturnValue(of(seed));
    api.rotateTotpSeed.mockReturnValue(of({ ...seed, seed: 'MZXW6YTBOI' }));
    api.getTotpRotationLoginUrl.mockReturnValue(loginUrl);
    csrf.fetchToken.mockReturnValue(of('new-session-token'));
    TestBed.configureTestingModule({
      imports: [TotpComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: CsrfService, useValue: csrf },
      ],
    });
    TestBed.overrideProvider(MatDialog, { useValue: dialog });
  });

  afterEach(() => vi.restoreAllMocks());

  function createComponent(rotation = false, platform = 'browser'): void {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: platform });
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap(rotation ? { totpRotation: 'confirm' } : {}) } },
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(TotpComponent);
    fixture.detectChanges();
  }

  it('loads the code without starting a rotation or login', () => {
    createComponent();

    expect(fixture.componentInstance.seed()).toEqual(seed);
    expect(api.rotateTotpSeed).not.toHaveBeenCalled();
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('offers the Keycloak login link before rotation', () => {
    createComponent();

    fixture.componentInstance.requestRotateSeed();

    expect(dialog.open).toHaveBeenCalledWith(
      ConfirmRotateTotpDialog,
      expect.objectContaining({
        data: { loginUrl },
      }),
    );
    expect(api.rotateTotpSeed).not.toHaveBeenCalled();
  });

  it('resumes rotation after Keycloak login and removes the return marker', () => {
    createComponent(true);

    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { totpRotation: null },
        replaceUrl: true,
      }),
    );
    expect(api.rotateTotpSeed).toHaveBeenCalledTimes(1);
    expect(csrf.fetchToken).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.seed()?.seed).toBe('MZXW6YTBOI');
    expect(snackBar.open).toHaveBeenCalledWith('Código secreto trocado', 'Fechar', expect.any(Object));

    fixture.componentInstance.retry();
    expect(api.rotateTotpSeed).toHaveBeenCalledTimes(1);
  });

  it('waits for a fresh session CSRF token before loading or rotating the seed', () => {
    const token = new Subject<string>();
    csrf.fetchToken.mockReturnValue(token);
    createComponent(true);

    expect(api.getTotpStatus).not.toHaveBeenCalled();
    expect(api.getOrCreateTotpSeed).not.toHaveBeenCalled();
    expect(api.rotateTotpSeed).not.toHaveBeenCalled();
    token.next('new-session-token');
    token.complete();

    expect(api.rotateTotpSeed).toHaveBeenCalledTimes(1);
  });

  it('offers another login if the rotation authorization has expired', () => {
    api.rotateTotpSeed.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { code: 'TOTP_ROTATION_LOGIN_REQUIRED' },
          }),
      ),
    );

    createComponent(true);

    expect(dialog.open).toHaveBeenCalledWith(ConfirmRotateTotpDialog, expect.objectContaining({ data: { loginUrl } }));
    expect(fixture.componentInstance.seed()).toEqual(seed);
    expect(fixture.componentInstance.isRotating()).toBe(false);
  });

  it('keeps the current code available when rotation fails without retrying the mutation', () => {
    api.rotateTotpSeed.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    createComponent(true);

    expect(fixture.componentInstance.seed()).toEqual(seed);
    expect(fixture.componentInstance.isRotating()).toBe(false);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Não foi possível confirmar a troca do código secreto. Atualize a página para ver qual código está ativo antes de usá-lo.',
      'Fechar',
      expect.any(Object),
    );
    fixture.componentInstance.retry();
    expect(api.rotateTotpSeed).toHaveBeenCalledTimes(1);
  });

  it('does not resume rotation during server rendering', () => {
    createComponent(true, 'server');

    expect(api.rotateTotpSeed).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });
});
