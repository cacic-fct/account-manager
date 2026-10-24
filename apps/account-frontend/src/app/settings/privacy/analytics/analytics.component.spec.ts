import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../../shared/services/api.service';
import { AuthService } from '../../../shared/services/auth/auth.service';
import { LoggerService } from '../../../shared/services/logger.service';
import { PrivacyService } from '../../../shared/services/privacy.service';
import { AnalyticsComponent } from './analytics.component';

describe('AnalyticsComponent', () => {
  let fixture: ComponentFixture<AnalyticsComponent>;
  const apiService = { getPrivacySettings: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    apiService.getPrivacySettings.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    await TestBed.configureTestingModule({
      imports: [AnalyticsComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: apiService },
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        PrivacyService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticsComponent);
  });

  it('shows a retryable error when privacy preferences cannot be loaded', () => {
    fixture.detectChanges();

    const pageText = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(pageText).toContain('Não foi possível carregar suas preferências de privacidade.');
    expect(pageText).toContain('Tentar novamente');
    expect(fixture.nativeElement.querySelector('.toggles-container')).toBeNull();

    const element = fixture.nativeElement as HTMLElement;
    const retryButton = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Tentar novamente'),
    );
    retryButton?.click();
    fixture.detectChanges();

    expect(apiService.getPrivacySettings).toHaveBeenCalledTimes(2);
    expect(element.textContent).toContain('Não foi possível carregar suas preferências de privacidade.');
  });
});
