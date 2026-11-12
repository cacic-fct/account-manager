import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AccountNavbarComponent } from '../../shared/components/account-navbar/account-navbar.component';
import {
  SettingsNavigationComponent,
  SettingsNavigationGroup,
} from '../../shared/components/settings-navigation/settings-navigation.component';

@Component({
  selector: 'app-privacy',
  imports: [AccountNavbarComponent, SettingsNavigationComponent],
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
