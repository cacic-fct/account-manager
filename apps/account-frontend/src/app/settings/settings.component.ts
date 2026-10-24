import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { AuthService } from '../shared/services/auth/auth.service';
import { CacicLogoComponent } from '../shared/assets/cacic-logo.component';
import {
  SettingsNavigationComponent,
  SettingsNavigationGroup,
} from '../shared/components/settings-navigation/settings-navigation.component';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  imports: [MatIconModule, MatButtonModule, RouterLink, CacicLogoComponent, SettingsNavigationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  private readonly authService = inject(AuthService);
  protected readonly currentUser = this.authService.currentUser;
  protected readonly isAdmin = computed(() => this.currentUser()?.isAdmin ?? false);
  protected readonly displayName = computed(() => {
    const user = this.currentUser();
    return user?.fullname || user?.displayName || user?.email.split('@')[0] || '';
  });
  protected readonly groups: readonly SettingsNavigationGroup[] = [
    {
      title: 'Sua conta',
      items: [
        {
          title: 'Perfil',
          description: 'Nome, contato e dados pessoais',
          icon: 'person',
          route: '/settings/profile/edit',
        },
        {
          title: 'Código off-line',
          description: 'Identifique-se sem conexão',
          icon: 'shield_lock',
          route: '/settings/security/totp',
        },
        {
          title: 'Minhas permissões',
          description: 'Acessos aos serviços do CACiC',
          icon: 'key',
          route: '/settings/permissions',
        },
      ],
    },
    {
      title: 'Integrações',
      items: [
        {
          title: 'Google',
          description: 'Contas e e-mails vinculados',
          brandIcon: 'assets/google.svg',
          route: '/settings/linked-accounts/google',
        },
        {
          title: 'Discord',
          description: 'Conta, servidor e notificações',
          brandIcon: 'assets/discord.svg',
          route: '/settings/linked-accounts/discord',
        },
        {
          title: 'Unesp',
          description: 'Comprovação de vínculo estudantil',
          icon: 'school',
          route: '/settings/linked-accounts/unesp',
        },
      ],
    },
    {
      title: 'Privacidade',
      items: [
        {
          title: 'Meus dados',
          description: 'Exporte seus dados ou exclua a conta',
          icon: 'article_person',
          route: '/settings/privacy/lgpd',
        },
        {
          title: 'Preferências de privacidade',
          description: 'Opções de uso e compartilhamento',
          icon: 'privacy_tip',
          route: '/settings/privacy',
        },
      ],
    },
  ];

  protected logout(): void {
    this.authService.logout();
  }
}
