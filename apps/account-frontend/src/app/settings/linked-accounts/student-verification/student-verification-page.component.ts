import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { LINKED_ACCOUNT_ROUTE_PATHS } from '@cacic/shared-types';
import { StudentVerificationCardComponent } from '../components/student-verification-card.component';

@Component({
  selector: 'app-student-verification-page',
  imports: [MatToolbarModule, MatIconModule, MatButtonModule, RouterLink, StudentVerificationCardComponent],
  template: `
    <div class="linked-account-page">
      <mat-toolbar color="primary" class="toolbar">
        <button mat-icon-button [routerLink]="linkedAccountsRoute">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <span>Unesp</span>
        <span class="spacer"></span>
      </mat-toolbar>

      <div class="content">
        <app-student-verification-card></app-student-verification-card>
      </div>
    </div>
  `,
  styleUrl: '../linked-account-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentVerificationPageComponent {
  protected readonly linkedAccountsRoute = LINKED_ACCOUNT_ROUTE_PATHS.index;
}
