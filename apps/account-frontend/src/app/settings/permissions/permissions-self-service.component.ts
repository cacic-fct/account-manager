import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  KEYCLOAK_PERMISSION_CLIENTS,
  PERMISSION_GROUP_CATALOG,
  type KeycloakPermissionGrant,
  type PermissionGroupMembership,
  type PermissionSelfServiceAccess,
} from '@cacic/shared-types';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../shared/services/api.service';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog.component';

@Component({
  selector: 'app-permissions-self-service',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatToolbarModule,
    MatTooltipModule,
  ],
  templateUrl: './permissions-self-service.component.html',
  styleUrl: './permissions-self-service.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionsSelfServiceComponent implements OnInit {
  private apiService = inject(ApiService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  protected access = signal<PermissionSelfServiceAccess>({
    memberships: [],
    grants: [],
  });
  protected loading = signal(true);
  protected deletingId = signal<string | null>(null);

  protected memberships = computed(() => this.access().memberships);
  protected grants = computed(() => this.access().grants);
  protected hasAccess = computed(
    () => this.memberships().length > 0 || this.grants().length > 0,
  );

  ngOnInit(): void {
    this.loadAccess();
  }

  protected refresh(): void {
    this.loadAccess();
  }

  protected confirmRemoveMembership(membership: PermissionGroupMembership): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '460px',
      data: {
        title: 'Sair do grupo',
        message: `Remover seu vínculo com ${this.getGroupLabel(membership)}?`,
        confirmText: 'Remover',
        cancelText: 'Cancelar',
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.removeMembership(membership.id);
      }
    });
  }

  protected confirmRemoveGrant(grant: KeycloakPermissionGrant): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '460px',
      data: {
        title: 'Remover permissão',
        message: `Remover ${this.getPermissionLabel(grant)} da sua conta?`,
        confirmText: 'Remover',
        cancelText: 'Cancelar',
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.removeGrant(grant.id);
      }
    });
  }

  protected getGroupLabel(membership: PermissionGroupMembership): string {
    return (
      PERMISSION_GROUP_CATALOG.find(
        (definition) => definition.key === membership.groupKey,
      )?.label ?? membership.groupKey
    );
  }

  protected getPermissionLabel(grant: KeycloakPermissionGrant): string {
    const roleLabels: Record<string, string> = {
      access: 'Acesso',
      'super-admin': 'Super Admin',
    };
    const readableRole =
      roleLabels[grant.roleName] ??
      grant.roleName.replace(/#/g, ' ').replace(/-/g, ' ');
    return `${this.getClientLabel(grant.clientId)} · ${readableRole}`;
  }

  protected getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Ativa',
      scheduled: 'Agendada',
      expired: 'Expirada',
    };

    return labels[status] ?? status;
  }

  protected formatMembership(membership: PermissionGroupMembership): string {
    return this.formatPeriod(membership.validFrom, membership.validUntil);
  }

  protected formatGrant(grant: KeycloakPermissionGrant): string {
    return this.formatPeriod(grant.validFrom, grant.validUntil);
  }

  private loadAccess(): void {
    this.loading.set(true);
    this.apiService.getSelfServicePermissions().subscribe({
      next: (access) => {
        this.access.set(access);
        this.loading.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao carregar permissões.', 'Fechar', {
          duration: 5000,
        });
        this.loading.set(false);
      },
    });
  }

  private removeMembership(id: string): void {
    this.deletingId.set(id);
    this.apiService.selfRemovePermissionGroupMembership(id).subscribe({
      next: () => {
        this.snackBar.open('Vínculo removido.', 'Fechar', {
          duration: 4000,
        });
        this.deletingId.set(null);
        this.loadAccess();
      },
      error: () => {
        this.snackBar.open('Erro ao remover vínculo.', 'Fechar', {
          duration: 5000,
        });
        this.deletingId.set(null);
      },
    });
  }

  private removeGrant(id: string): void {
    this.deletingId.set(id);
    this.apiService.selfRemovePermissionGrant(id).subscribe({
      next: () => {
        this.snackBar.open('Permissão removida.', 'Fechar', {
          duration: 4000,
        });
        this.deletingId.set(null);
        this.loadAccess();
      },
      error: () => {
        this.snackBar.open('Erro ao remover permissão.', 'Fechar', {
          duration: 5000,
        });
        this.deletingId.set(null);
      },
    });
  }

  private getClientLabel(clientId: string): string {
    return (
      KEYCLOAK_PERMISSION_CLIENTS.find(
        (definition) => definition.clientId === clientId,
      )?.label ?? clientId
    );
  }

  private formatPeriod(
    validFrom: string | null | undefined,
    validUntil: string | null | undefined,
  ): string {
    const start = validFrom ? this.formatDate(validFrom) : 'agora';
    const end = validUntil ? this.formatDate(validUntil) : 'sem fim';
    return `${start} até ${end}`;
  }

  private formatDate(value: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  }
}
