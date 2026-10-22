import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatCard, MatCardContent, MatCardActions } from '@angular/material/card';
import { NgOptimizedImage } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import type { Application } from '@cacic/shared-types';

export const DEFAULT_APPLICATION_ICON_URL = 'assets/default-app-icon.svg';

@Component({
  selector: 'app-card',
  templateUrl: './app-card.component.html',
  styleUrls: ['./app-card.component.scss'],
  imports: [MatCard, MatCardContent, MatCardActions, MatButton, MatIcon, NgOptimizedImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppCardComponent {
  app = input.required<Application>();
  private readonly failedIconUrl = signal<string | null>(null);

  readonly iconUrl = computed(() => {
    const configuredIconUrl = this.app().iconUrl?.trim();
    return configuredIconUrl && configuredIconUrl !== this.failedIconUrl()
      ? configuredIconUrl
      : DEFAULT_APPLICATION_ICON_URL;
  });

  onLogoError(): void {
    const configuredIconUrl = this.app().iconUrl?.trim();
    if (configuredIconUrl) {
      this.failedIconUrl.set(configuredIconUrl);
    }
  }

  readonly destination = computed(() => {
    try {
      const url = new URL(this.app().url ?? '');
      return ['https:', 'http:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  });

  readonly canOpen = computed(() => this.app().enabled && !!this.destination());
}
