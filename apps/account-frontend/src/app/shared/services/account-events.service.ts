import { DestroyRef, Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';

/** Invalidation only: account data never leaves the tab through this channel. */
@Injectable({ providedIn: 'root' })
export class AccountEventsService {
  private readonly changes = new Subject<void>();
  readonly discordChanged$ = this.changes.asObservable();
  private channel?: BroadcastChannel;

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID)) && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('cacic-account-changes');
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === 'discord-changed') this.changes.next();
      };
    }
    inject(DestroyRef).onDestroy(() => {
      this.channel?.close();
      this.changes.complete();
    });
  }

  notifyDiscordChanged(): void {
    this.changes.next();
    this.channel?.postMessage('discord-changed');
  }
}
