import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

export interface SettingsNavigationGroup {
  readonly title: string;
  readonly items: readonly {
    readonly title: string;
    readonly description: string;
    readonly route: string;
    readonly icon?: string;
    readonly brandIcon?: string;
  }[];
}

@Component({
  selector: 'app-settings-navigation',
  imports: [NgOptimizedImage, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="label()">
      @for (group of groups(); track group.title) {
        <section>
          <h2>{{ group.title }}</h2>
          @for (item of group.items; track item.route) {
            <a [routerLink]="item.route">
              @if (item.brandIcon) {
                <img [ngSrc]="item.brandIcon" width="24" height="24" alt="" />
              } @else {
                <mat-icon aria-hidden="true">{{ item.icon }}</mat-icon>
              }
              <span class="label">
                <span class="title">{{ item.title }}</span>
                <span class="description">{{ item.description }}</span>
              </span>
              <mat-icon class="chevron" aria-hidden="true">chevron_right</mat-icon>
            </a>
          }
        </section>
      }
    </nav>
  `,
  styleUrl: './settings-navigation.component.scss',
})
export class SettingsNavigationComponent {
  readonly groups = input.required<readonly SettingsNavigationGroup[]>();
  readonly label = input.required<string>();
}
