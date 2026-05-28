import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import {
  ApiService,
  ServerSetting,
} from '../../../shared/services/api.service';
import { LoggerService } from '../../../shared/services/logger.service';

@Component({
  selector: 'app-discord-admin',
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatDividerModule,
  ],
  templateUrl: './discord-admin.component.html',
  styleUrl: './discord-admin.component.scss',
})
export class DiscordAdminComponent implements OnInit {
  private apiService = inject(ApiService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);

  isLoading = signal(false);
  settings = signal<ServerSetting[]>([]);
  pendingChanges = signal<Record<string, string>>({});
  savingStates = signal<Record<string, boolean>>({});
  isRegisteringMetadata = signal(false);

  // Known setting keys with display names and descriptions
  private readonly settingDisplayNames: Record<string, string> = {
    student_invite_link: 'Convite do servidor de Discord para estudantes',
  };

  private readonly settingDescriptions: Record<string, string> = {
    student_invite_link: 'Convite do servidor de Discord para estudantes',
  };

  // Get all settings including predefined ones that may not exist in DB yet
  allSettings = signal<ServerSetting[]>([]);

  ngOnInit(): void {
    this.loadSettings();
  }

  loadSettings(): void {
    this.isLoading.set(true);
    this.apiService.getServerSettings().subscribe({
      next: (settings: ServerSetting[]) => {
        this.settings.set(settings);
        this.updateAllSettings(settings);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error loading server settings', error);
        this.snackBar.open(
          'Failed to load server settings. Please try again.',
          'Close',
          { duration: 5000 },
        );
        this.isLoading.set(false);
      },
    });
  }

  private updateAllSettings(existingSettings: ServerSetting[]): void {
    const predefinedKeys = Object.keys(this.settingDisplayNames);
    const combined: ServerSetting[] = [];

    // Add existing settings
    existingSettings.forEach((setting) => {
      combined.push(setting);
    });

    // Add predefined settings that don't exist yet
    predefinedKeys.forEach((key) => {
      if (!existingSettings.find((s) => s.key === key)) {
        combined.push({
          id: `new-${key}`,
          key: key,
          value: '',
          description: this.settingDescriptions[key] || '',
          updatedAt: new Date(),
        });
      }
    });

    this.allSettings.set(combined);
  }

  refreshSettings(): void {
    this.apiService.getServerSettingsFresh().subscribe({
      next: (settings: ServerSetting[]) => {
        this.settings.set(settings);
        this.updateAllSettings(settings);
        this.pendingChanges.set({});
        this.snackBar.open('Settings refreshed', 'Close', { duration: 3000 });
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error refreshing settings', error);
        this.snackBar.open(
          'Failed to refresh settings. Please try again.',
          'Close',
          { duration: 5000 },
        );
      },
    });
  }

  updateSettingValue(key: string, event: Event): void {
    const target = event.target as HTMLInputElement;
    const newValue = target.value;

    this.pendingChanges.update((changes) => ({
      ...changes,
      [key]: newValue,
    }));
  }

  hasChanges(key: string): boolean {
    const pending = this.pendingChanges()[key];
    // For new settings, any non-empty value is a change
    const setting = this.allSettings().find((s) => s.key === key);
    if (setting?.id.startsWith('new-')) {
      return pending !== undefined && pending.trim() !== '';
    }
    // For existing settings, compare with current value
    const current = setting?.value || '';
    return pending !== undefined && pending !== current;
  }

  isSaving(key: string): boolean {
    return this.savingStates()[key] || false;
  }

  saveSetting(key: string): void {
    const newValue = this.pendingChanges()[key];
    if (!newValue || !this.hasChanges(key)) {
      return;
    }

    this.savingStates.update((states) => ({
      ...states,
      [key]: true,
    }));

    this.apiService.updateServerSetting(key, { value: newValue }).subscribe({
      next: (updatedSetting: ServerSetting) => {
        // Update the settings array
        this.settings.update((settings) => {
          const existingIndex = settings.findIndex((s) => s.key === key);
          if (existingIndex >= 0) {
            // Update existing setting
            return settings.map((s) => (s.key === key ? updatedSetting : s));
          } else {
            // Add new setting
            return [...settings, updatedSetting];
          }
        });

        // Refresh allSettings to update UI
        this.updateAllSettings(this.settings());

        // Clear pending changes for this key
        this.pendingChanges.update((changes) => {
          const newChanges = { ...changes };
          delete newChanges[key];
          return newChanges;
        });

        this.savingStates.update((states) => ({
          ...states,
          [key]: false,
        }));

        const isNewSetting = this.allSettings()
          .find((s) => s.key === key)
          ?.id.startsWith('new-');
        const action = isNewSetting ? 'created' : 'updated';

        this.snackBar.open(
          `${this.getSettingDisplayName(key)} ${action} successfully`,
          'Close',
          { duration: 3000 },
        );
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error saving setting', error);
        this.snackBar.open(
          `Failed to update ${this.getSettingDisplayName(key)}. Please try again.`,
          'Close',
          { duration: 5000 },
        );

        this.savingStates.update((states) => ({
          ...states,
          [key]: false,
        }));
      },
    });
  }

  resetSetting(key: string): void {
    this.pendingChanges.update((changes) => {
      const newChanges = { ...changes };
      delete newChanges[key];
      return newChanges;
    });

    // Reset the input value to current setting value
    const currentValue =
      this.allSettings().find((s) => s.key === key)?.value || '';

    // Find and update the input field by looking for the specific input in the setting
    setTimeout(() => {
      const settingElement = document.querySelector(
        `[data-setting-key="${key}"]`,
      );
      if (settingElement) {
        const input = settingElement.querySelector('input') as HTMLInputElement;
        if (input) {
          input.value = currentValue;
        }
      }
    });
  }

  registerMetadata(): void {
    this.isRegisteringMetadata.set(true);
    this.apiService.registerDiscordMetadata().subscribe({
      next: (response) => {
        this.isRegisteringMetadata.set(false);
        this.snackBar.open(
          'Discord metadata registered successfully! You can now set up Linked Roles in Discord.',
          'Close',
          { duration: 5000 },
        );
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error registering Discord metadata', error);
        this.isRegisteringMetadata.set(false);
        this.snackBar.open(
          'Failed to register Discord metadata. Please check your Discord bot configuration.',
          'Close',
          { duration: 5000 },
        );
      },
    });
  }

  getSettingDisplayName(key: string): string {
    return (
      this.settingDisplayNames[key] ||
      key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
    );
  }
}
