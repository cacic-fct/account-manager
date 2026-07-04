import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService, ServerSetting } from '../../../shared/services/api.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { LoggerService } from '../../../shared/services/logger.service';

@Component({
  selector: 'app-discord-admin',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './discord-admin.component.html',
  styleUrl: './discord-admin.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscordAdminComponent implements OnInit {
  private apiService = inject(ApiService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);

  private readonly inviteSettingKey = 'student_invite_link';

  isLoading = signal(false);
  settings = signal<ServerSetting[]>([]);
  isSaving = signal(false);
  inviteLinkControl = new FormControl('', { nonNullable: true });

  private readonly inviteLinkValue = toSignal(this.inviteLinkControl.valueChanges, {
    initialValue: this.inviteLinkControl.value,
  });

  inviteSetting = computed(() => this.settings().find((setting) => setting.key === this.inviteSettingKey));

  hasChanges = computed(() => {
    const value = this.inviteLinkValue().trim();
    const currentValue = this.inviteSetting()?.value ?? '';
    return value.length > 0 && value !== currentValue;
  });

  ngOnInit(): void {
    this.loadSettings();
  }

  loadSettings(): void {
    this.isLoading.set(true);
    this.apiService.getServerSettings().subscribe({
      next: (settings: ServerSetting[]) => {
        this.setSettings(settings);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error loading server settings', error);
        this.snackBar.open('Não foi possível carregar o convite do Discord.', 'Fechar', { duration: 5000 });
        this.isLoading.set(false);
      },
    });
  }

  refreshSettings(): void {
    this.apiService.getServerSettingsFresh().subscribe({
      next: (settings: ServerSetting[]) => {
        this.setSettings(settings);
        this.snackBar.open('Convite atualizado.', 'Fechar', { duration: 3000 });
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error refreshing settings', error);
        this.snackBar.open('Não foi possível atualizar o convite.', 'Fechar', { duration: 5000 });
      },
    });
  }

  saveInviteLink(): void {
    const newValue = this.inviteLinkControl.value.trim();
    if (!this.hasChanges() || this.isSaving()) {
      return;
    }

    this.isSaving.set(true);

    this.apiService.updateServerSetting(this.inviteSettingKey, { value: newValue }).subscribe({
      next: (updatedSetting: ServerSetting) => {
        this.settings.update((settings) => {
          const existingIndex = settings.findIndex((setting) => setting.key === this.inviteSettingKey);
          if (existingIndex >= 0) {
            return settings.map((setting) => (setting.key === this.inviteSettingKey ? updatedSetting : setting));
          }
          return [...settings, updatedSetting];
        });

        this.inviteLinkControl.setValue(updatedSetting.value ?? '');
        this.isSaving.set(false);
        this.snackBar.open('Convite salvo.', 'Fechar', { duration: 3000 });
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error saving setting', error);
        this.snackBar.open('Não foi possível salvar o convite.', 'Fechar', {
          duration: 5000,
        });
        this.isSaving.set(false);
      },
    });
  }

  resetInviteLink(): void {
    this.inviteLinkControl.setValue(this.inviteSetting()?.value ?? '');
  }

  private setSettings(settings: ServerSetting[]): void {
    this.settings.set(settings);
    this.inviteLinkControl.setValue(settings.find((setting) => setting.key === this.inviteSettingKey)?.value ?? '');
  }
}
