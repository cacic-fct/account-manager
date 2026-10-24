import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import {
  SettingsNavigationComponent,
  SettingsNavigationGroup,
} from '../../shared/components/settings-navigation/settings-navigation.component';

@Component({
  selector: 'app-privacy',
  imports: [MatButtonModule, MatIconModule, RouterLink, SettingsNavigationComponent],
  templateUrl: './privacy.component.html',
  styleUrl: './privacy.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyComponent {
  protected readonly groups: readonly SettingsNavigationGroup[] = [
    {
      title: 'Preferências e dados',
      items: [
        {
          title: 'Análise',
          description: 'Rastreamento e diagnóstico',
          icon: 'timeline',
          route: '/settings/privacy/analytics',
        },
        {
          title: 'Meus dados',
          description: 'Solicitações e histórico',
          icon: 'article_person',
          route: '/settings/privacy/lgpd',
        },
      ],
    },
  ];
}
