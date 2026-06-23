import { Component, input } from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardActions,
} from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import type { Application } from '@cacic/shared-types';

@Component({
  selector: 'app-card',
  templateUrl: './app-card.component.html',
  styleUrls: ['./app-card.component.scss'],
  imports: [MatCard, MatCardContent, MatCardActions, MatButton, MatIcon],
})
export class AppCardComponent {
  app = input.required<Application>();

  openApp() {
    const application = this.app();
    if (application.url) {
      window.open(application.url, '_blank', 'noopener,noreferrer');
    }
  }
}
