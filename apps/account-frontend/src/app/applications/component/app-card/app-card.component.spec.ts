import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Application } from '@cacic/shared-types';

import { AppCardComponent, DEFAULT_APPLICATION_ICON_URL } from './app-card.component';

describe('AppCardComponent', () => {
  let component: AppCardComponent;
  let fixture: ComponentFixture<AppCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AppCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('app', {
      id: 'test-app',
      name: 'Test app',
      enabled: true,
    });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders an OIDC logo URL, including SVG URLs', () => {
    fixture.componentRef.setInput('app', {
      id: 'svg-app',
      name: 'SVG app',
      iconUrl: 'https://example.org/app-logo.svg',
      enabled: true,
    } satisfies Application);
    fixture.detectChanges();

    const logo = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('.app-logo');
    expect(logo?.getAttribute('src')).toBe('https://example.org/app-logo.svg');
  });

  it('uses the default icon when no logo is configured', () => {
    const logo = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('.app-logo');

    expect(logo?.getAttribute('src')).toBe(DEFAULT_APPLICATION_ICON_URL);
  });

  it('falls back to the default icon when the configured logo cannot load', () => {
    fixture.componentRef.setInput('app', {
      id: 'broken-logo-app',
      name: 'Broken logo app',
      iconUrl: 'https://example.org/missing-logo.svg',
      enabled: true,
    } satisfies Application);
    fixture.detectChanges();

    const logo = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('.app-logo');
    logo?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(logo?.getAttribute('src')).toBe(DEFAULT_APPLICATION_ICON_URL);
  });
});

describe('Application navigation', () => {
  it('keeps cards focused on the name, description and action even when metadata exists', async () => {
    await TestBed.configureTestingModule({ imports: [AppCardComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AppCardComponent);
    fixture.componentRef.setInput('app', {
      id: 'app',
      name: 'Votações',
      category: 'Participação',
      description: 'Participe das eleições.',
      enabled: true,
      url: 'https://example.org/vote',
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Participe das eleições.');
    expect(element.textContent).not.toContain('Participação');
    expect(element.textContent).not.toContain('example.org');
    expect(element.querySelector('a')?.href).toBe('https://example.org/vote');
  });

  it.each([
    { enabled: false, url: 'https://example.org' },
    { enabled: true, url: undefined },
    { enabled: true, url: 'javascript:alert(1)' },
    { enabled: true, url: 'not a url' },
  ])('does not offer a link for an unavailable destination: %o', async (app) => {
    await TestBed.configureTestingModule({ imports: [AppCardComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AppCardComponent);
    fixture.componentRef.setInput('app', { id: 'app', name: 'Aplicativo', ...app });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('a')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('button')?.disabled).toBe(true);
  });

  it('uses a native link with a named new-tab destination', async () => {
    await TestBed.configureTestingModule({ imports: [AppCardComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AppCardComponent);
    fixture.componentRef.setInput('app', {
      id: 'app',
      name: 'Eventos',
      enabled: true,
      url: 'https://example.org/events',
    });
    fixture.detectChanges();
    const anchor = (fixture.nativeElement as HTMLElement).querySelector('a');
    expect(anchor?.href).toBe('https://example.org/events');
    expect(anchor?.getAttribute('aria-label')).toBe('Abrir Eventos em uma nova aba');
    expect(anchor?.target).toBe('_blank');
    expect(anchor?.rel).toContain('noopener');
  });
});
