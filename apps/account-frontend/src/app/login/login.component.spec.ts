import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import {
  ActivatedRoute,
  convertToParamMap,
  Router,
} from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../shared/services/auth/auth.service';

type LoginComponentTestApi = {
  form: FormGroup;
  submit: () => void;
  loginWithSso: () => void;
  errorMessage: () => string | null;
  isSubmitting: () => boolean;
};

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let authService: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isOnboarded: ReturnType<typeof vi.fn>;
    passwordLogin: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
  };
  let router: {
    navigateByUrl: ReturnType<typeof vi.fn>;
  };

  async function setup(queryParams: Record<string, string> = {}) {
    authService = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      isOnboarded: vi.fn().mockReturnValue(true),
      passwordLogin: vi.fn().mockReturnValue(
        of({
          success: true,
          isAuthenticated: true,
          isOnboarded: true,
          redirectUrl: 'http://localhost:4200/app/settings',
        }),
      ),
      login: vi.fn(),
    };
    router = {
      navigateByUrl: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(queryParams),
            },
          },
        },
        {
          provide: Router,
          useValue: router,
        },
        {
          provide: PLATFORM_ID,
          useValue: 'server',
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('submits credentials through the dev password login endpoint', async () => {
    await setup({ returnTo: '/settings' });
    const component = fixture.componentInstance as unknown as LoginComponentTestApi;

    component.form.setValue({
      email: 'aluno@unesp.br',
      password: '1',
    });
    component.submit();

    expect(authService.passwordLogin).toHaveBeenCalledWith(
      'aluno@unesp.br',
      '1',
      '/settings',
    );
    expect(component.isSubmitting()).toBe(false);
    expect(component.errorMessage()).toBeNull();
  });

  it('shows the Portuguese invalid-credentials message when password login fails', async () => {
    await setup();
    authService.passwordLogin.mockReturnValue(
      throwError(() => new Error('Invalid email or password')),
    );
    const component = fixture.componentInstance as unknown as LoginComponentTestApi;

    component.form.setValue({
      email: 'aluno@unesp.br',
      password: 'wrong-password',
    });
    component.submit();

    expect(component.isSubmitting()).toBe(false);
    expect(component.errorMessage()).toBe('E-mail ou senha inválidos.');
  });

  it('passes the return target to SSO login', async () => {
    await setup({ returnTo: '/applications' });
    const component = fixture.componentInstance as unknown as LoginComponentTestApi;

    component.loginWithSso();

    expect(authService.login).toHaveBeenCalledWith('/applications');
  });

  it('shows the callback failure message from the route query', async () => {
    await setup({ error: 'auth_failed' });
    const component = fixture.componentInstance as unknown as LoginComponentTestApi;

    expect(component.errorMessage()).toBe(
      'Não foi possível entrar. Tente novamente.',
    );
  });

  it('redirects already authenticated users away from the login form', async () => {
    await setup();
    authService.isAuthenticated.mockReturnValue(true);

    fixture = TestBed.createComponent(LoginComponent);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/applications');
  });
});
