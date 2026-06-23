import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatToolbar } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy',
  imports: [
    MatListModule,
    MatButtonModule,
    MatToolbar,
    MatIconModule,
    RouterLink,
  ],
  templateUrl: './privacy.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './privacy.component.scss',
})
export class PrivacyComponent {}
