import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { DiscordRole } from '@cacic/shared-types';

import { normalizeDiscordRoleColor } from '../utils/discord-role-color.util';

@Component({
  selector: 'app-discord-role-option',
  imports: [MatIconModule],
  template: `
    <div class="role-info">
      <span
        class="role-swatch"
        [style.background-color]="roleColor()"
        [attr.aria-label]="'Cor do cargo ' + role().name"
      ></span>
      <span class="role-copy">
        <span class="role-name" [class.muted]="muted()">
          {{ role().name }}
        </span>
        @if (meta()) {
          <span class="role-meta">{{ meta() }}</span>
        }
      </span>
      @if (icon()) {
        <mat-icon class="role-icon" inline>{{ icon() }}</mat-icon>
      }
    </div>
  `,
  styles: `
    .role-info {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      width: 100%;
      margin-left: 8px;
    }

    .role-swatch {
      width: 18px;
      height: 18px;
      border: 1px solid color-mix(in srgb, var(--mat-sys-on-surface) 24%, transparent);
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.28);
    }

    .role-copy {
      display: grid;
      min-width: 0;
      gap: 2px;
    }

    .role-name {
      overflow: hidden;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-title-small);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .role-name.muted,
    .role-meta {
      color: var(--mat-sys-on-surface-variant);
    }

    .role-meta {
      font: var(--mat-sys-label-medium);
    }

    .role-icon {
      width: 18px;
      height: 18px;
      color: var(--mat-sys-error);
      font-size: 18px;
    }

    @media (max-width: 680px) {
      .role-info {
        grid-template-columns: auto minmax(0, 1fr);
      }

      .role-icon {
        grid-column: 2;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscordRoleOptionComponent {
  role = input.required<DiscordRole>();
  meta = input('');
  muted = input(false);
  icon = input('');

  roleColor = computed(() => normalizeDiscordRoleColor(this.role().color));
}
