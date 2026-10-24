import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { TOTP_PERIOD_SECONDS, formatTotpCode, generateTotpCode } from '@cacic/m2m-contracts';
import type { TotpSeed, TotpStatus } from '@cacic/shared-types';
import { ApiService } from '../../../shared/services/api.service';
import { LoggerService } from '../../../shared/services/logger.service';
import { CsrfService } from '../../../shared/services/csrf.service';
import { getApiErrorMessage } from '../../../shared/utils/api-error-message';

const TOTP_PERIOD_MS = TOTP_PERIOD_SECONDS * 1000;

@Component({
  selector: 'app-totp',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatToolbarModule,
  ],
  templateUrl: './totp.component.html',
  styleUrl: './totp.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TotpComponent {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly logger = inject(LoggerService);
  private readonly csrf = inject(CsrfService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private resumeRotation = this.isBrowser && this.route.snapshot.queryParamMap.get('totpRotation') === 'confirm';
  private codeRequest = 0;
  private animationFrame: number | null = null;

  readonly status = signal<TotpStatus | null>(null);
  readonly seed = signal<TotpSeed | null>(null);
  readonly code = signal('');
  readonly now = signal(Date.now());
  readonly isLoading = signal(true);
  readonly hasLoadError = signal(false);
  readonly loadErrorMessage = signal('');
  readonly codeErrorMessage = signal('');
  readonly isRotating = signal(false);

  readonly displayCode = computed(() => (this.code() ? formatTotpCode(this.code()) : '--- ---'));
  readonly currentStep = computed(() => Math.floor(this.now() / TOTP_PERIOD_MS));
  readonly progressValue = computed(() => {
    const elapsed = this.now() % TOTP_PERIOD_MS;
    return ((TOTP_PERIOD_MS - elapsed) / TOTP_PERIOD_MS) * 100;
  });
  readonly primaryEmail = computed(() => this.seed()?.primaryEmail ?? null);

  constructor() {
    if (this.resumeRotation) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { totpRotation: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      // Keycloak login regenerates the session, so refresh its CSRF cookie before any seed request.
      this.csrf
        .fetchToken()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.loadStatus(),
          error: (error: unknown) => {
            this.logger.error('Erro ao preparar sessão para troca do código secreto', error, {
              operation: 'totp-session',
            });
            this.resumeRotation = false;
            this.isLoading.set(false);
            this.hasLoadError.set(true);
            this.loadErrorMessage.set(
              getApiErrorMessage(
                error,
                'Não foi possível atualizar sua sessão. Entre novamente e volte para trocar o código secreto.',
              ),
            );
          },
        });
    } else {
      this.loadStatus();
    }

    if (this.isBrowser) {
      const tick = () => {
        this.now.set(Date.now());
        this.animationFrame = window.requestAnimationFrame(tick);
      };

      this.animationFrame = window.requestAnimationFrame(tick);
      this.destroyRef.onDestroy(() => {
        if (this.animationFrame !== null) {
          window.cancelAnimationFrame(this.animationFrame);
        }
      });
    }

    effect(() => {
      const seed = this.seed();
      const step = this.currentStep();

      if (!seed) {
        this.code.set('');
        this.codeErrorMessage.set('');
        return;
      }

      void this.updateCode(seed.seed, step * TOTP_PERIOD_MS);
    });
  }

  requestRotateSeed(): void {
    this.dialog.open(ConfirmRotateTotpDialog, {
      autoFocus: false,
      width: 'min(420px, calc(100vw - 32px))',
      data: { loginUrl: this.api.getTotpRotationLoginUrl() },
    });
  }

  private rotateSeed(): void {
    this.isRotating.set(true);
    this.api
      .rotateTotpSeed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (seed) => {
          this.seed.set(seed);
          this.status.set({
            configured: true,
            algorithm: seed.algorithm,
            digits: seed.digits,
            periodSeconds: seed.periodSeconds,
            serverTime: seed.serverTime,
            createdAt: seed.serverTime,
            rotatedAt: seed.serverTime,
          });
          this.isRotating.set(false);
          this.snackBar.open('Código secreto trocado', 'Fechar', {
            duration: 3000,
          });
        },
        error: (error) => {
          this.logger.error('Erro ao trocar segredo TOTP', error, { operation: 'totp-rotate' });
          this.isRotating.set(false);
          if (error instanceof HttpErrorResponse && error.error?.code === 'TOTP_ROTATION_LOGIN_REQUIRED') {
            this.requestRotateSeed();
            return;
          }
          this.snackBar.open(
            getApiErrorMessage(
              error,
              'Não foi possível confirmar a troca do código secreto. Atualize a página para ver qual código está ativo antes de usá-lo.',
            ),
            'Fechar',
            {
              duration: 5000,
              panelClass: ['error-snackbar'],
            },
          );
        },
      });
  }

  copyCode(): void {
    if (!this.isBrowser || !this.code()) {
      return;
    }

    void navigator.clipboard.writeText(this.code()).then(
      () => {
        this.snackBar.open('Código copiado', 'Fechar', {
          duration: 2500,
        });
      },
      () => {
        this.snackBar.open('Não foi possível copiar o código. Você pode copiá-lo manualmente na tela.', 'Fechar', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
      },
    );
  }

  retry(): void {
    this.hasLoadError.set(false);
    this.loadErrorMessage.set('');
    this.isLoading.set(true);
    this.loadStatus();
  }

  private loadStatus(): void {
    this.api
      .getTotpStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.loadErrorMessage.set('');
          this.loadSeed();
        },
        error: (error) => {
          this.logger.error('Erro ao carregar status TOTP', error, { operation: 'totp-status' });
          this.isLoading.set(false);
          this.hasLoadError.set(true);
          this.loadErrorMessage.set(
            getApiErrorMessage(error, 'Não foi possível carregar o status do código off-line. Tente novamente.'),
          );
        },
      });
  }

  private loadSeed(): void {
    this.api
      .getOrCreateTotpSeed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (seed) => {
          this.applySeed(seed);
          this.isLoading.set(false);
          this.hasLoadError.set(false);
          this.loadErrorMessage.set('');
          if (this.resumeRotation) {
            this.resumeRotation = false;
            this.rotateSeed();
          }
        },
        error: (error) => {
          this.logger.error('Erro ao preparar TOTP', error, { operation: 'totp-prepare' });
          this.isLoading.set(false);
          this.hasLoadError.set(true);
          this.loadErrorMessage.set(
            getApiErrorMessage(error, 'Não foi possível preparar seu código off-line. Tente novamente.'),
          );
        },
      });
  }

  private applySeed(seed: TotpSeed): void {
    const currentStatus = this.status();
    this.seed.set(seed);
    this.status.set({
      ...(currentStatus ?? {}),
      configured: true,
      algorithm: seed.algorithm,
      digits: seed.digits,
      periodSeconds: seed.periodSeconds,
      serverTime: seed.serverTime,
    });
  }

  private async updateCode(seed: string, timestamp: number): Promise<void> {
    const request = ++this.codeRequest;

    try {
      const code = await generateTotpCode({ seed, timestamp });
      if (request === this.codeRequest) {
        this.code.set(code);
        this.codeErrorMessage.set('');
      }
    } catch (error) {
      this.logger.error('Erro ao gerar TOTP', error, { operation: 'totp-generate' });
      if (request === this.codeRequest) {
        this.code.set('');
        this.codeErrorMessage.set('Não foi possível gerar um código agora. Atualize a página e tente novamente.');
      }
    }
  }
}

@Component({
  selector: 'app-confirm-rotate-totp-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Trocar código secreto?</h2>
    <mat-dialog-content>
      <p>
        Esse botão não atualiza o número que está sendo exibido na tela. Ele troca o código secreto usado para gerar os
        códigos.
      </p>
      <p>
        Você vai entrar novamente pelo Keycloak. Depois, o código secreto será trocado e os códigos antigos deixarão de
        funcionar.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancelar</button>
      <a mat-flat-button [href]="data.loginUrl">
        <mat-icon>login</mat-icon>
        Entrar e trocar código secreto
      </a>
    </mat-dialog-actions>
  `,
  styles: [
    `
      p {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
        line-height: 1.5;
      }

      button mat-icon {
        margin-right: 0.5rem;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmRotateTotpDialog {
  readonly data = inject<{ loginUrl: string }>(MAT_DIALOG_DATA);
}
