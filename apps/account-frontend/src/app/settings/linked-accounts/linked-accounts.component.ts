import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { RouterLink } from '@angular/router';
import { LINKED_ACCOUNT_ROUTE_PATHS } from '@cacic/shared-types';

@Component({
  selector: 'app-linked-accounts',
  imports: [MatToolbarModule, MatIconModule, MatButtonModule, MatListModule, RouterLink],
  templateUrl: './linked-accounts.component.html',
  styleUrl: './linked-accounts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkedAccountsComponent {
  protected readonly integrations = [
    {
      title: 'Google',
      description: 'Contas de login e e-mails vinculados',
      icon: 'account_circle',
      route: LINKED_ACCOUNT_ROUTE_PATHS.google,
    },
    {
      title: 'Discord',
      description: 'Conta vinculada e acesso ao servidor do CACiC',
      icon: 'discord',
      route: LINKED_ACCOUNT_ROUTE_PATHS.discord,
    },
    {
      title: 'Unesp',
      description: 'Verificação de estudante da graduação',
      icon: 'school',
      route: LINKED_ACCOUNT_ROUTE_PATHS.unesp,
    },
  ] as const;
}
