import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { NotFoundComponent } from './not-found.component';

describe('NotFoundComponent', () => {
  const open = vi.fn();
  const writeText = vi.fn();
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  beforeEach(() => {
    open.mockClear();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    TestBed.configureTestingModule({
      imports: [NotFoundComponent],
      providers: [provideRouter([]), { provide: MatSnackBar, useValue: { open } }],
    });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('keeps technical details collapsed until requested', async () => {
    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();
    const header = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('mat-expansion-panel-header');

    expect(header?.getAttribute('aria-expanded')).toBe('false');
    header?.click();
    await fixture.whenStable();

    expect(header?.getAttribute('aria-expanded')).toBe('true');
    expect((fixture.nativeElement as HTMLElement).querySelector('code')?.textContent).toContain('404');
  });

  it('copies only the status code and announces success', async () => {
    const component = TestBed.createComponent(NotFoundComponent).componentInstance;

    await component.copyDetails();

    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ statusCode: 404 }, null, 2));
    expect(open).toHaveBeenCalledWith('Detalhes técnicos copiados.', 'OK', { duration: 3000 });
  });

  it('announces a clipboard failure without throwing', async () => {
    writeText.mockRejectedValue(new Error('Clipboard permission denied'));
    const component = TestBed.createComponent(NotFoundComponent).componentInstance;

    await component.copyDetails();

    expect(open).toHaveBeenCalledWith('Não foi possível copiar os detalhes.', 'OK', { duration: 3000 });
  });

  it('handles browsers without clipboard support', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const component = TestBed.createComponent(NotFoundComponent).componentInstance;

    await component.copyDetails();

    expect(open).toHaveBeenCalledWith('Área de transferência indisponível.', 'OK', { duration: 3000 });
  });
});
