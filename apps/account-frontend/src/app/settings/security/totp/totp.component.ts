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
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { TOTP_PERIOD_SECONDS, formatTotpCode, generateTotpCode } from '@cacic/m2m-contracts';
import type { TotpSeed, TotpStatus } from '@cacic/shared-types';
import { ApiService } from '../../../shared/services/api.service';
import { LoggerService } from '../../../shared/services/logger.service';

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
  private codeRequest = 0;
  private animationFrame: number | null = null;

  readonly status = signal<TotpStatus | null>(null);
  readonly seed = signal<TotpSeed | null>(null);
  readonly code = signal('');
  readonly now = signal(Date.now());
  readonly isLoading = signal(true);
  readonly hasLoadError = signal(false);
  readonly isRotating = signal(false);

  readonly displayCode = computed(() => (this.code() ? formatTotpCode(this.code()) : '--- ---'));
  readonly currentStep = computed(() => Math.floor(this.now() / TOTP_PERIOD_MS));
  readonly progressValue = computed(() => {
    const elapsed = this.now() % TOTP_PERIOD_MS;
    return ((TOTP_PERIOD_MS - elapsed) / TOTP_PERIOD_MS) * 100;
  });
  readonly primaryEmail = computed(() => this.seed()?.primaryEmail ?? null);

  constructor() {
    this.loadStatus();

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
        return;
      }

      void this.updateCode(seed.seed, step * TOTP_PERIOD_MS);
    });
  }

  requestRotateSeed(): void {
    this.dialog
      .open(ConfirmRotateTotpDialog, {
        autoFocus: false,
        width: 'min(420px, calc(100vw - 32px))',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed === true) {
          this.rotateSeed();
        }
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
          this.snackBar.open('Erro ao trocar código secreto', 'Fechar', {
            duration: 5000,
            panelClass: ['error-snackbar'],
          });
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
        this.snackBar.open('Não foi possível copiar o código', 'Fechar', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
      },
    );
  }

  retry(): void {
    this.hasLoadError.set(false);
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
          this.loadSeed();
        },
        error: (error) => {
      this.logger.error('Erro ao carregar status TOTP', error, { operation: 'totp-status' });
          this.isLoading.set(false);
          this.hasLoadError.set(true);
          this.snackBar.open('Erro ao carregar código off-line', 'Fechar', {
            duration: 5000,
            panelClass: ['error-snackbar'],
          });
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
        },
        error: (error) => {
      this.logger.error('Erro ao preparar TOTP', error, { operation: 'totp-prepare' });
          this.isLoading.set(false);
          this.hasLoadError.set(true);
          this.snackBar.open('Erro ao preparar código off-line', 'Fechar', {
            duration: 5000,
            panelClass: ['error-snackbar'],
          });
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
      }
    } catch (error) {
      this.logger.error('Erro ao gerar TOTP', error, { operation: 'totp-generate' });
      if (request === this.codeRequest) {
        this.code.set('');
      }
    }
  }
}

@Component({
  selector: 'app-confirm-rotate-totp-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Cuidado!</h2>
    <mat-dialog-content>
      <p>
        Esse botão não atualiza o número que está sendo exibido na tela. Ele troca o código secreto usado para gerar os
        códigos.
      </p>
      <p>Use esta opção se você esqueceu sua conta logada em um dispositivo compartilhado.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="warn" type="button" [mat-dialog-close]="true">
        <mat-icon>sync_lock</mat-icon>
        Trocar código secreto
      </button>
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
export class ConfirmRotateTotpDialog {}
