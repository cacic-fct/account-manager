import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { AccountEventsService } from './account-events.service';

class MockChannel {
  static instance: MockChannel;
  onmessage?: (event: MessageEvent<unknown>) => void;
  postMessage = vi.fn();
  close = vi.fn();
  constructor() {
    MockChannel.instance = this;
  }
}

describe('AccountEventsService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('broadcasts invalidations without account data and does not echo remote events', () => {
    vi.stubGlobal('BroadcastChannel', MockChannel);
    const service = TestBed.inject(AccountEventsService);
    const listener = vi.fn();
    service.discordChanged$.subscribe(listener);
    service.notifyDiscordChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(MockChannel.instance.postMessage).toHaveBeenCalledWith('discord-changed');
    MockChannel.instance.onmessage?.(new MessageEvent('message', { data: 'discord-changed' }));
    MockChannel.instance.onmessage?.(new MessageEvent('message', { data: 'unrelated' }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(MockChannel.instance.postMessage).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();
    expect(MockChannel.instance.close).toHaveBeenCalledOnce();
  });

  it('supports SSR without browser globals', () => {
    const Channel = vi.fn();
    vi.stubGlobal('BroadcastChannel', Channel);
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    TestBed.inject(AccountEventsService).notifyDiscordChanged();
    expect(Channel).not.toHaveBeenCalled();
  });
});
