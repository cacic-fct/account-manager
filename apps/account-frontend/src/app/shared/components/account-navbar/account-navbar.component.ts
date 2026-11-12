import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { CacicLogoComponent } from '../../assets/cacic-logo.component';

@Component({
  selector: 'app-account-navbar',
  imports: [NgTemplateOutlet, MatButtonModule, MatIconModule, RouterLink, CacicLogoComponent],
  template: `
    <header>
      <div class="navbar-content" [class.narrow]="narrow()">
        <div class="navbar-start">
          @if (backLink(); as link) {
            <a matIconButton [routerLink]="link" [attr.aria-label]="backLabel()">
              <mat-icon>arrow_back</mat-icon>
            </a>
          }
          @if (linkToApplications()) {
            <a class="brand" routerLink="/applications" aria-label="Conta CACiC — aplicativos">
              <ng-container [ngTemplateOutlet]="brand" />
            </a>
          } @else {
            <span class="brand"><ng-container [ngTemplateOutlet]="brand" /></span>
          }
        </div>
        <ng-content />
      </div>
    </header>
    <ng-template #brand>
      <app-cacic-logo class="logo" fillColor="currentColor" />
      <span>Conta CACiC</span>
    </ng-template>
  `,
  styleUrl: './account-navbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountNavbarComponent {
  linkToApplications = input(true);
  backLink = input<string>();
  backLabel = input('Voltar');
  narrow = input(false);
}
