import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiService, DiscordLinkStatus } from '../../../shared/services/api.service';
import { AccountEventsService } from '../../../shared/services/account-events.service';
import { DiscordIntegrationCardComponent } from './discord-integration-card.component';

const unlinked: DiscordLinkStatus = { isLinked: false, eligibleForRole: 'visitor' };

describe('DiscordIntegrationCardComponent', () => {
  const changes = new Subject<void>();
  const api = { getDiscordLinkStatusFresh: vi.fn() };
  beforeEach(async () => {
    api.getDiscordLinkStatusFresh.mockReset().mockReturnValue(of(unlinked));
    await TestBed.configureTestingModule({
      imports: [DiscordIntegrationCardComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AccountEventsService, useValue: { discordChanged$: changes } },
      ],
    }).compileComponents();
  });

  it('refreshes on account changes, not focus, and tears down the subscription', () => {
    const fixture = TestBed.createComponent(DiscordIntegrationCardComponent);
    fixture.detectChanges();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api.getDiscordLinkStatusFresh).toHaveBeenCalledTimes(1);
    api.getDiscordLinkStatusFresh.mockReturnValue(of({ ...unlinked, isLinked: true }));
    changes.next();
    expect(fixture.componentInstance.discordStatus()?.isLinked).toBe(true);
    expect(api.getDiscordLinkStatusFresh).toHaveBeenCalledTimes(2);
    fixture.destroy();
    changes.next();
    expect(api.getDiscordLinkStatusFresh).toHaveBeenCalledTimes(2);
  });

  it('shows a retryable error rather than claiming an unlinked account', () => {
    api.getDiscordLinkStatusFresh.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(DiscordIntegrationCardComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Não foi possível consultar');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Não conectado');
    api.getDiscordLinkStatusFresh.mockReturnValue(of(unlinked));
    fixture.componentInstance.refresh();
    fixture.detectChanges();
    expect(fixture.componentInstance.hasLoadError()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Conectar Discord');
  });

  it('ignores obsolete responses when an event arrives during a request', () => {
    const pending = new Subject<DiscordLinkStatus>();
    api.getDiscordLinkStatusFresh.mockReturnValueOnce(pending).mockReturnValue(of({ ...unlinked, isLinked: true }));
    const fixture = TestBed.createComponent(DiscordIntegrationCardComponent);
    fixture.detectChanges();
    changes.next();
    pending.next(unlinked);
    expect(fixture.componentInstance.discordStatus()?.isLinked).toBe(true);
  });
  it('shows the integration icon and one clear setup link when disconnected', () => {
    const fixture = TestBed.createComponent(DiscordIntegrationCardComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.integration-identity img')?.getAttribute('src')).toBe('assets/discord.svg');
    expect(element.querySelectorAll('a')).toHaveLength(1);
    expect(element.querySelector('a')?.textContent).toContain('Conectar Discord');
  });

  it('distinguishes the linked identity and labels the compact account actions', () => {
    api.getDiscordLinkStatusFresh.mockReturnValue(
      of({
        ...unlinked,
        isLinked: true,
        inviteLink: 'https://discord.gg/example',
        discordLinks: [
          {
            id: 'link',
            userId: 'user',
            discordId: 'discord-user',
            discordUsername: 'joao',
            discordGlobalName: 'João Silva',
            isVerified: true,
            createdAt: new Date(),
          },
        ],
      } satisfies DiscordLinkStatus),
    );
    const fixture = TestBed.createComponent(DiscordIntegrationCardComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.linked-accounts strong')?.textContent).toBe('João Silva');
    expect(element.querySelector('.account-handle')?.textContent).toBe('@joao');
    expect(element.querySelector('[aria-label="Gerenciar vínculo com o Discord"]')?.getAttribute('href')).toBe(
      '/settings/linked-accounts/discord',
    );
    expect(element.querySelector('[aria-label="Atualizar conexão com o Discord"]')).not.toBeNull();
    expect(element.querySelector('.secondary-actions')?.textContent).toContain('Notificações');
  });
});
