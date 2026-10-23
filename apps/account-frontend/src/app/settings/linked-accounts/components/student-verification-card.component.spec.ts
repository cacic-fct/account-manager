import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject, of } from 'rxjs';
import { StudentVerificationCardComponent } from './student-verification-card.component';
import { StudentVerificationService } from '../../../shared/services/student-verification/student-verification.service';

describe('StudentVerificationCardComponent inline upload', () => {
  const result = new Subject<{ success?: boolean }>();
  const dialog = { open: vi.fn(() => ({ afterClosed: () => result })) };

  beforeEach(async () => {
    dialog.open.mockClear();
    await TestBed.configureTestingModule({
      imports: [StudentVerificationCardComponent],
      providers: [
        {
          provide: StudentVerificationService,
          useValue: { getVerificationStatus: () => of({ status: 'not_submitted' }) },
        },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();
  });

  it('shows the file selector directly without a details navigation', () => {
    const fixture = TestBed.createComponent(StudentVerificationCardComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.file-drop-area')?.textContent).toContain('Selecionar documento');
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
  });

  it('starts validation on selection and prevents a second upload while validating', () => {
    const fixture = TestBed.createComponent(StudentVerificationCardComponent);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['PDF'], 'matricula.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new Event('change'));
    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.uploading()).toBe(true);
    fixture.componentInstance.startValidation();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    result.next({});
    expect(fixture.componentInstance.uploading()).toBe(false);
    fixture.destroy();
  });

  it('rejects unsupported files before opening validation', () => {
    const fixture = TestBed.createComponent(StudentVerificationCardComponent);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['image'], 'photo.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    expect(dialog.open).not.toHaveBeenCalled();
    expect(fixture.componentInstance.currentBanner()?.title).toBe('Formato inválido');
    fixture.destroy();
  });
});
