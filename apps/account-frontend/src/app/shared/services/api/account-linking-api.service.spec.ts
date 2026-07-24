import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthApiService } from './auth-api.service';
import { CacheService } from '../cache.service';
import { AccountLinkingApiService } from './account-linking-api.service';

class MockEventSource {
  static instance: MockEventSource | undefined;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();

  constructor(...args: [string, EventSourceInit]) {
    void args;
    MockEventSource.instance = this;
  }
}

describe('AccountLinkingApiService', () => {
  function getEventSource(): MockEventSource {
    if (!MockEventSource.instance) {
      throw new Error('EventSource was not created');
    }

    return MockEventSource.instance;
  }

  beforeEach(() => {
    MockEventSource.instance = undefined;
    vi.stubGlobal('EventSource', MockEventSource);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        { provide: CacheService, useValue: { invalidate: vi.fn() } },
        { provide: AuthApiService, useValue: { clearAuthCache: vi.fn() } },
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('stops reconnecting after five consecutive stream failures and resets after an update', () => {
    const service = TestBed.inject(AccountLinkingApiService);
    const errors: Error[] = [];
    const stream = (service as unknown as { createMergeRequestEventStream(url: string): import('rxjs').Observable<unknown> })
      .createMergeRequestEventStream('/events')
      .subscribe({ error: (error: Error) => errors.push(error) });
    const eventSource = getEventSource();

    for (let index = 0; index < 4; index += 1) {
      eventSource.onerror?.(new Event('error'));
    }
    eventSource.onmessage?.({ data: JSON.stringify({ id: 'merge-request' }) } as MessageEvent<string>);
    for (let index = 0; index < 4; index += 1) {
      eventSource.onerror?.(new Event('error'));
    }

    expect(errors).toEqual([]);

    eventSource.onerror?.(new Event('error'));

    expect(errors[0]?.message).toContain('repeatedly failed');
    expect(eventSource.close).toHaveBeenCalled();
    stream.unsubscribe();
  });
});
