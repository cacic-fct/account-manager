import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCard, MatCardContent, MatCardActions } from '@angular/material/card';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, merge, startWith, Subject, switchMap, tap } from 'rxjs';
import { ApiService, DiscordLinkStatus } from '../../../shared/services/api.service';
import { AccountEventsService } from '../../../shared/services/account-events.service';
import { LoggerService } from '../../../shared/services/logger.service';
import { getApiErrorMessage } from '../../../shared/utils/api-error-message';

@Component({
  selector: 'app-discord-integration-card',
  imports: [
    MatCard,
    MatCardContent,
    MatCardActions,
    MatButton,
    MatIconButton,
    MatTooltipModule,
    MatIcon,
    MatProgressBar,
    RouterLink,
    NgOptimizedImage,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card appearance="outlined">
      <mat-card-content>
        <div class="title-row">
          <div class="integration-identity">
            <img ngSrc="assets/discord.svg" width="40" height="40" alt="" />
            <div>
              <h3>Discord</h3>
              @if (discordStatus() && !hasLoadError()) {
                <span class="status">
                  <mat-icon>{{ discordStatus()?.isLinked ? 'check_circle' : 'link_off' }}</mat-icon>
                  {{ discordStatus()?.isLinked ? 'Conectado' : 'Não conectado' }}
                </span>
              }
            </div>
          </div>
          <button
            matIconButton
            (click)="refresh()"
            [disabled]="isLoading()"
            aria-label="Atualizar conexão com o Discord"
            matTooltip="Atualizar conexão">
            <mat-icon>refresh</mat-icon>
          </button>
        </div>
        @if (isLoading()) {
          <div role="status">
            <mat-progress-bar mode="indeterminate" aria-label="Carregando Discord" />
            <p>Consultando conexão…</p>
          </div>
        }
        @if (hasLoadError()) {
          <p role="alert">{{ loadErrorMessage() }}</p>
        } @else if (discordStatus(); as status) {
          @if (status.isLinked) {
            <p>Acesse o servidor do CACiC e escolha quais notificações receber.</p>
            @if (status.discordLinks?.length) {
              <ul class="linked-accounts" aria-label="Contas vinculadas ao Discord">
                @for (link of status.discordLinks; track link.id) {
                  <li>
                    @if (link.discordGlobalName && link.discordGlobalName !== link.discordUsername) {
                      <strong>{{ link.discordGlobalName }}</strong>
                      <span class="account-handle">{{ '@' + link.discordUsername }}</span>
                    } @else {
                      <strong>{{ '@' + link.discordUsername }}</strong>
                    }
                  </li>
                }
              </ul>
            }
          } @else {
            <p>Conecte sua conta para participar do servidor do CACiC e configurar notificações.</p>
          }
        }
      </mat-card-content>
      <mat-card-actions>
        @if (hasLoadError()) {
          <button matButton="outlined" (click)="refresh()" [disabled]="isLoading()">
            <mat-icon>refresh</mat-icon>Tentar novamente
          </button>
        } @else if (discordStatus(); as status) {
          @if (status.isLinked) {
            @if (status.inviteLink) {
              <a
                matButton="tonal"
                [href]="status.inviteLink"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir servidor do CACiC (nova aba)">
                <mat-icon>groups</mat-icon>Abrir servidor
              </a>
            }
            <div class="secondary-actions">
              <a matButton routerLink="/settings/linked-accounts/discord/role-selection">
                <mat-icon>notifications</mat-icon>Notificações
              </a>
              <a
                matIconButton
                routerLink="/settings/linked-accounts/discord"
                aria-label="Gerenciar vínculo com o Discord"
                matTooltip="Gerenciar vínculo">
                <mat-icon>settings</mat-icon>
              </a>
            </div>
          } @else {
            <a matButton="tonal" routerLink="/settings/linked-accounts/discord">
              <mat-icon>link</mat-icon>Conectar Discord
            </a>
          }
        }
      </mat-card-actions>
    </mat-card>
  `,
  styles: `
    :host {
      display: block;
    }
    mat-card {
      background: var(--mat-sys-surface-container-low);
    }
    mat-card-content {
      padding: 20px 20px 0;
    }
    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 16px;
    }
    .integration-identity {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .integration-identity img {
      flex-shrink: 0;
    }
    h3 {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }
    .status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .status mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    p {
      font-size: 0.875rem;
      line-height: 1.6;
      color: var(--mat-sys-on-surface-variant);
      margin: 12px 0;
    }
    .linked-accounts {
      list-style: none;
      margin: 20px 0 4px;
      padding: 0;
    }
    .linked-accounts li {
      display: grid;
      gap: 4px;
      overflow-wrap: anywhere;
    }
    .linked-accounts li + li {
      margin-top: 12px;
    }
    .linked-accounts strong {
      font-size: 0.9375rem;
      font-weight: 600;
    }
    .account-handle {
      font-size: 0.8125rem;
      color: var(--mat-sys-on-surface-variant);
    }
    mat-card-actions {
      padding: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .secondary-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  `,
})
export class DiscordIntegrationCardComponent implements OnInit {
  private readonly apiService = inject(ApiService);
  private readonly accountEvents = inject(AccountEventsService);
  private readonly logger = inject(LoggerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshRequested = new Subject<void>();
  readonly isLoading = signal(true);
  readonly hasLoadError = signal(false);
  readonly loadErrorMessage = signal('');
  readonly discordStatus = signal<DiscordLinkStatus | null>(null);

  ngOnInit(): void {
    merge(this.refreshRequested, this.accountEvents.discordChanged$)
      .pipe(
        startWith(undefined),
        tap(() => {
          this.isLoading.set(true);
          this.hasLoadError.set(false);
          this.loadErrorMessage.set('');
        }),
        switchMap(() =>
          this.apiService.getDiscordLinkStatusFresh().pipe(
            catchError((error: unknown) => {
              this.logger.error('Error loading Discord status', error, { operation: 'discord-status' });
              this.hasLoadError.set(true);
              this.isLoading.set(false);
              this.loadErrorMessage.set(
                getApiErrorMessage(error, 'Não foi possível consultar sua conexão com o Discord. Tente novamente.'),
              );
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((status) => {
        this.discordStatus.set(status);
        this.isLoading.set(false);
        this.loadErrorMessage.set('');
      });
  }

  refresh(): void {
    this.refreshRequested.next();
  }
}
