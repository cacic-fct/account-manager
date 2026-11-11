import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CacicLogoComponent } from '../shared/assets/cacic-logo.component';

@Component({
  selector: 'app-not-found',
  imports: [CacicLogoComponent, MatButtonModule, MatExpansionModule, MatIconModule, RouterLink],
  templateUrl: './not-found.component.html',
  styleUrl: './not-found.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly signInError = this.route.snapshot.data['signInError'] === true;
  protected readonly diagnostics = computed(() => {
    if (!this.signInError) {
      return JSON.stringify({ statusCode: 404 }, null, 2);
    }

    const reference = this.queryParams().get('ref');
    const diagnostics =
      reference && /^[a-f0-9]{16}$/.test(reference) ? { code: 'auth_failed', reference } : { code: 'auth_failed' };
    return JSON.stringify(diagnostics, null, 2);
  });

  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly snackBar = inject(MatSnackBar);

  async copyDetails(): Promise<void> {
    const clipboard = this.document.defaultView?.navigator.clipboard;
    if (!isPlatformBrowser(this.platformId) || !clipboard) {
      this.snackBar.open('Área de transferência indisponível.', 'OK', { duration: 3000 });
      return;
    }

    try {
      await clipboard.writeText(this.diagnostics());
      this.snackBar.open('Detalhes técnicos copiados.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível copiar os detalhes.', 'OK', { duration: 3000 });
    }
  }
}
