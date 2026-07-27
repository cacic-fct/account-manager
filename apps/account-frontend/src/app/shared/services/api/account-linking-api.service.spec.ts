import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthApiService } from './auth-api.service';
import { CacheService } from '../cache.service';
import { AccountLinkingApiService } from './account-linking-api.service';

class MockEventSource {
  static readonly CLOSED = 2;
  static instance: MockEventSource | undefined;
  static urls: string[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  readonly close = vi.fn();

  constructor(...args: [string, EventSourceInit]) {
    MockEventSource.urls.push(args[0]);
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
    MockEventSource.urls = [];
    vi.stubGlobal('EventSource', MockEventSource);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CacheService, useValue: { invalidate: vi.fn() } },
        { provide: AuthApiService, useValue: { clearAuthCache: vi.fn() } },
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses credentialed administrator endpoints for the merge workflow', () => {
    const service = TestBed.inject(AccountLinkingApiService);
    const httpTesting = TestBed.inject(HttpTestingController);
    const dto = { requesterUserId: 'first-user', candidateUserId: 'second-user' };
    const confirmation = { primaryEmail: 'first@example.com' };

    service.createAdminAccountMerge(dto).subscribe();
    const createRequest = httpTesting.expectOne((request) => request.url.endsWith('/admin/account-merges'));
    expect(createRequest).toMatchObject({
      request: expect.objectContaining({ method: 'POST', body: dto, withCredentials: true }),
    });
    createRequest.flush({ id: 'merge-request' });

    service.getAdminAccountMergeRequest('merge-request').subscribe();
    httpTesting.expectOne((request) => request.url.endsWith('/admin/account-merges/merge-request')).flush({ id: 'merge-request' });

    service.confirmAdminAccountMerge('merge-request', confirmation).subscribe();
    httpTesting
      .expectOne((request) => request.url.endsWith('/admin/account-merges/merge-request/confirm'))
      .flush({ request: { id: 'merge-request' } });

    service.cancelAdminAccountMerge('merge-request').subscribe();
    httpTesting.expectOne((request) => request.url.endsWith('/admin/account-merges/merge-request/cancel')).flush({ success: true });
    httpTesting.verify();
  });

  it('opens the correct user and administrator EventSource URLs', () => {
    const service = TestBed.inject(AccountLinkingApiService);
    const userSubscription = service.watchAccountMergeRequest('user-request').subscribe();
    userSubscription.unsubscribe();

    const adminSubscription = service.watchAdminAccountMergeRequest('admin-request').subscribe();
    adminSubscription.unsubscribe();

    expect(MockEventSource.urls).toEqual([
      expect.stringContaining('/auth/account-linking/merge-requests/user-request/events'),
      expect.stringContaining('/admin/account-merges/admin-request/events'),
    ]);
  });

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

  it('resets transient stream failures as soon as EventSource reconnects', () => {
    const service = TestBed.inject(AccountLinkingApiService);
    const errors: Error[] = [];
    const stream = (service as unknown as { createMergeRequestEventStream(url: string): import('rxjs').Observable<unknown> })
      .createMergeRequestEventStream('/events')
      .subscribe({ error: (error: Error) => errors.push(error) });
    const eventSource = getEventSource();

    for (let index = 0; index < 4; index += 1) eventSource.onerror?.(new Event('error'));
    eventSource.onopen?.();
    for (let index = 0; index < 4; index += 1) eventSource.onerror?.(new Event('error'));

    expect(errors).toEqual([]);
    stream.unsubscribe();
  });

  it('immediately fails when the EventSource has closed permanently', () => {
    const service = TestBed.inject(AccountLinkingApiService);
    const errors: Event[] = [];
    const stream = (service as unknown as { createMergeRequestEventStream(url: string): import('rxjs').Observable<unknown> })
      .createMergeRequestEventStream('/events')
      .subscribe({ error: (error: Event) => errors.push(error) });
    const eventSource = getEventSource();
    const terminalError = new Event('error');
    eventSource.readyState = MockEventSource.CLOSED;

    eventSource.onerror?.(terminalError);

    expect(errors).toEqual([terminalError]);
    expect(eventSource.close).toHaveBeenCalledTimes(1);
    expect(stream.closed).toBe(true);
  });
});
