import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { CacicLogoComponent } from '../shared/assets/cacic-logo.component';
import {
  SettingsNavigationComponent,
  SettingsNavigationGroup,
} from '../shared/components/settings-navigation/settings-navigation.component';

@Component({
  selector: 'app-admin',
  imports: [MatIconModule, MatButtonModule, RouterLink, CacicLogoComponent, SettingsNavigationComponent],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent {
  protected readonly groups: readonly SettingsNavigationGroup[] = [
    {
      title: 'Acessos e validações',
      items: [
        {
          title: 'Permissões',
          description: 'Acessos, grupos e funções',
          icon: 'key',
          route: '/admin/keycloak-permissions',
        },
        {
          title: 'Validação estudantil',
          description: 'Analise comprovantes de vínculo',
          icon: 'school',
          route: '/admin/student-verification',
        },
      ],
    },
    {
      title: 'Discord',
      items: [
        {
          title: 'Servidor e cargos',
          description: 'Convite e cargos para autoatribuição',
          brandIcon: 'assets/discord.svg',
          route: '/admin/discord-integration',
        },
        {
          title: 'Exceções de cargos',
          description: 'Ajustes individuais de acesso',
          icon: 'verified_user',
          route: '/admin/discord-role-overrides',
        },
      ],
    },
    {
      title: 'Gestão de contas',
      items: [
        {
          title: 'Unificação de contas',
          description: 'Revise e acompanhe unificações',
          icon: 'merge_type',
          route: '/admin/account-merges',
        },
        {
          title: 'Exclusão de contas',
          description: 'Gerencie solicitações de exclusão',
          icon: 'manage_accounts',
          route: '/admin/account-deletion',
        },
      ],
    },
  ];
}
