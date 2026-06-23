import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { AuthService } from '../shared/services/auth/auth.service';

@Component({
  selector: 'app-logout',
  imports: [],
  templateUrl: './logout.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './logout.component.scss',
})
export class LogoutComponent {
  authService = inject(AuthService);
  constructor() {
    this.authService.logout();
  }
}
