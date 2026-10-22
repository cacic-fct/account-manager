import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import type { Application, User } from '@cacic/shared-types';
import { ApplicationsComponent } from './applications.component';
import { AuthService } from '../shared/services/auth/auth.service';
import { ApiService } from '../shared/services/api.service';
import { AccountEventsService } from '../shared/services/account-events.service';

const applications: Application[] = [
  {
    id: 'events',
    name: 'Eventos',
    description: 'Inscrições e certificados',
    category: 'Acadêmico',
    enabled: true,
    url: 'https://example.org/events',
  },
  { id: 'voting', name: 'Votação', enabled: false },
];

describe('ApplicationsComponent', () => {
  let fixture: ComponentFixture<ApplicationsComponent>;
  let component: ApplicationsComponent;
  const api = { getApplicationsFresh: vi.fn(), getDiscordLinkStatusFresh: vi.fn() };
  const auth = {
    currentUser: signal<Pick<User, 'displayName' | 'email' | 'isAdmin' | 'picture'>>({
      displayName: 'Ana',
      email: 'ana@example.org',
      isAdmin: false,
    }),
    logoutError: signal(null),
    logout: vi.fn(),
  };

  beforeEach(async () => {
    auth.currentUser.set({ displayName: 'Ana', email: 'ana@example.org', isAdmin: false });
    api.getApplicationsFresh.mockReturnValue(of(applications));
    api.getDiscordLinkStatusFresh.mockReturnValue(of({ isLinked: false, eligibleForRole: 'visitor' }));
    await TestBed.configureTestingModule({
      imports: [ApplicationsComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: AccountEventsService, useValue: { discordChanged$: new Subject<void>() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ApplicationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('filters names and descriptions without accents', () => {
    for (const query of ['inscricoes', 'EVENTOS']) {
      component.searchTerm.set(query);
      expect(component.filteredApplications().map((app) => app.id)).toEqual(['events']);
    }
    component.searchTerm.set('votacao');
    expect(component.filteredApplications()[0].id).toBe('voting');
  });

  it('distinguishes errors from an empty catalog and supports retry', () => {
    api.getApplicationsFresh.mockReturnValue(throwError(() => new Error('offline')));
    component.loadApplications();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Não foi possível atualizar');
    expect(component.applications()).toEqual(applications);
    api.getApplicationsFresh.mockReturnValue(of([]));
    component.loadApplications();
    fixture.detectChanges();
    expect(component.hasLoadError()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Nenhum aplicativo disponível');
  });

  it('labels the account control and provides a search reset', () => {
    component.searchTerm.set('missing');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.account-button')?.getAttribute('aria-label')).toBe('Abrir menu da conta de Ana');
    expect(element.querySelector('.avatar-initials')?.textContent).toBe('A');
    const clear = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Limpar busca'),
    );
    clear?.click();
    expect(component.filteredApplications()).toHaveLength(2);
  });
  it('keeps account names compact and uses initials when a picture fails', () => {
    auth.currentUser.set({
      displayName: 'Marina Oliveira',
      email: 'marina@example.org',
      isAdmin: false,
      picture: 'https://example.org/avatar.jpg',
    });
    fixture.detectChanges();
    const image = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('.account-button img');
    expect(image?.getAttribute('src')).toBe('https://example.org/avatar.jpg');
    image?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.avatar-initials')?.textContent).toBe('MO');
    expect(component.userShortName()).toBe('Marina');
    expect(component.userInitials()).toBe('MO');
    expect((fixture.nativeElement as HTMLElement).querySelector('.account-label')?.textContent).toBe('Marina');
  });
});
