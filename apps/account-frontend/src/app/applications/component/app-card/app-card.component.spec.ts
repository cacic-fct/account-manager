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
