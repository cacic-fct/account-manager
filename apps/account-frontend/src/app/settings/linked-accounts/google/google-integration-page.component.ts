import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { LINKED_ACCOUNT_ROUTE_PATHS } from '@cacic/shared-types';
import { GoogleAccountLinkingComponent } from '../components/google-account-linking.component';

@Component({
  selector: 'app-google-integration-page',
  imports: [
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    RouterLink,
    GoogleAccountLinkingComponent,
  ],
  template: `
    <div class="linked-account-page">
      <mat-toolbar color="primary" class="toolbar">
        <button mat-icon-button [routerLink]="linkedAccountsRoute">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <span>Google</span>
        <span class="spacer"></span>
      </mat-toolbar>

      <div class="content">
        <app-google-account-linking></app-google-account-linking>
      </div>
    </div>
  `,
  styleUrl: '../linked-account-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoogleIntegrationPageComponent {
  protected readonly linkedAccountsRoute = LINKED_ACCOUNT_ROUTE_PATHS.index;
}
