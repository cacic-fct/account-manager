import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef
} from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../shared/services/api.service';
import { PrivacyService } from '../../../shared/services/privacy.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface PrivacyToggle {
  key: string;
  title: string;
  description: string;
  icon: string;
  enabled: boolean;
  loading: boolean;
}

@Component({
  selector: 'app-analytics',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatToolbarModule,
    RouterLink,
    FormsModule,
  ],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
})
export class AnalyticsComponent implements OnInit {
  private apiService = inject(ApiService);
  private privacyService = inject(PrivacyService);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  // Remove the loading state - show options immediately
  isUpdating = signal(false);

  // Track individual toggle loading states
  toggleLoadingStates = signal<Record<string, boolean>>({});

  // Use privacy service for settings
  privacySettings = this.privacyService.settings;

  // Define base toggle configurations
  private baseToggles: Omit<PrivacyToggle, 'enabled' | 'loading'>[] = [
    {
      key: 'analytics_tracking',
      title: 'Análise',
      description:
        'Para entendermos como nossas aplicações são utilizadas e, com isso, para melhorá-las continuamente',
      icon: 'timeline',
    },
    {
      key: 'error_debugging',
      title: 'Diagnóstico de erros',
      description:
        'Coleta de relatórios de erros e de informações de diagnóstico para melhorar a estabilidade das aplicações',
      icon: 'bug_report',
    },
    {
      key: 'performance_monitoring',
      title: 'Performance',
      description:
        'Coleta de performance das aplicações para resolver problemas de lentidão',
      icon: 'speed',
    },
  ];

  // Computed signal that combines base toggles with current settings
  privacyToggles = computed(() => {
    const settings = this.privacySettings();
    const loadingStates = this.toggleLoadingStates();

    // Handle the new JSONB structure
    const settingsObj = settings?.settings || {
      analytics_tracking: false,
      error_debugging: false,
      performance_monitoring: false,
      cookie_banner_accepted: false,
    };

    return this.baseToggles.map((toggle) => ({
      ...toggle,
      enabled: settingsObj[toggle.key as keyof typeof settingsObj] ?? false,
      loading: loadingStates[toggle.key] || false,
    }));
  });

  ngOnInit(): void {
    // Load settings in background without showing loading spinner
    this.loadPrivacySettings();
  }

  loadPrivacySettings(): void {
    this.privacyService
      .loadSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Settings are automatically updated via the computed signal
          // No need to manually update toggles
        },
        error: (error) => {
          console.error('Error loading privacy settings:', error);
          this.snackBar.open(
            'Erro ao carregar configurações de privacidade',
            'Fechar',
            {
              duration: 5000,
              panelClass: ['error-snackbar'],
            },
          );
        },
      });
  }

  onToggleChange(toggleKey: string, enabled: boolean): void {
    // Set loading state for this specific toggle
    this.toggleLoadingStates.update((states) => ({
      ...states,
      [toggleKey]: true,
    }));

    this.privacyService
      .updateSetting(toggleKey, enabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (setting) => {
          // Clear loading state - the computed signal will automatically update with new settings
          this.toggleLoadingStates.update((states) => ({
            ...states,
            [toggleKey]: false,
          }));

          this.snackBar.open(
            `Configuração ${enabled ? 'ativada' : 'desativada'} com sucesso`,
            'Fechar',
            {
              duration: 3000,
              panelClass: ['success-snackbar'],
            },
          );
        },
        error: (error) => {
          console.error('Error updating privacy setting:', error);

          // Clear loading state
          this.toggleLoadingStates.update((states) => ({
            ...states,
            [toggleKey]: false,
          }));

          this.snackBar.open(
            'Erro ao atualizar configuração de privacidade',
            'Fechar',
            {
              duration: 5000,
              panelClass: ['error-snackbar'],
            },
          );
        },
      });
  }
}
