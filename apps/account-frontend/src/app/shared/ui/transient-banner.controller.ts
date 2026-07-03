import { signal } from '@angular/core';

export type TransientBannerType = 'success' | 'error' | 'warning' | 'info';

export interface TransientBannerConfig {
  type: TransientBannerType;
  title: string;
  message: string;
  icon: string;
  visible: boolean;
  dismissible?: boolean;
}

export class TransientBannerController {
  readonly currentBanner = signal<TransientBannerConfig | null>(null);
  private bannerTimeout?: ReturnType<typeof setTimeout>;

  show(
    type: TransientBannerType,
    title: string,
    message: string,
    options: {
      dismissible?: boolean;
      autoHide?: boolean;
      icon?: string;
    } = {},
  ): void {
    this.clearTimeout();
    this.currentBanner.set({
      type,
      title,
      message,
      icon: options.icon ?? this.getIcon(type),
      visible: true,
      dismissible: options.dismissible ?? true,
    });

    if (options.autoHide) {
      this.bannerTimeout = setTimeout(() => {
        this.dismiss();
      }, 5000);
    }
  }

  showSuccess(title: string, message: string): void {
    this.show('success', title, message, { autoHide: true });
  }

  showError(title: string, message: string): void {
    this.show('error', title, message);
  }

  showWarning(title: string, message: string): void {
    this.show('warning', title, message);
  }

  showInfo(title: string, message: string, icon?: string): void {
    this.show('info', title, message, { icon });
  }

  dismiss(): void {
    this.clearTimeout();
    this.currentBanner.set(null);
  }

  destroy(): void {
    this.clearTimeout();
  }

  private clearTimeout(): void {
    if (!this.bannerTimeout) {
      return;
    }

    clearTimeout(this.bannerTimeout);
    this.bannerTimeout = undefined;
  }

  private getIcon(type: TransientBannerType): string {
    switch (type) {
      case 'success':
        return 'check_circle';
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
        return 'info';
    }
  }
}
