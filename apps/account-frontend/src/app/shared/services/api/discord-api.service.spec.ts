import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AccountEventsService } from '../account-events.service';
import { DiscordApiService } from './discord-api.service';

describe('Discord account change notifications', () => {
  const events = { notifyDiscordChanged: vi.fn() };
  beforeEach(() => {
    events.notifyDiscordChanged.mockReset();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AccountEventsService, useValue: events }],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('notifies open pages only after unlink succeeds', () => {
    TestBed.inject(DiscordApiService).unlinkDiscord('link-id').subscribe();
    expect(events.notifyDiscordChanged).not.toHaveBeenCalled();
    TestBed.inject(HttpTestingController)
      .expectOne((request) => request.url.endsWith('/discord/link/link-id'))
      .flush({ message: 'Desvinculado' });
    expect(events.notifyDiscordChanged).toHaveBeenCalledOnce();
  });

  it('does not announce a failed unlink', () => {
    TestBed.inject(DiscordApiService)
      .unlinkDiscord('link-id')
      .subscribe({ error: () => undefined });
    TestBed.inject(HttpTestingController)
      .expectOne((request) => request.url.endsWith('/discord/link/link-id'))
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(events.notifyDiscordChanged).not.toHaveBeenCalled();
  });
});
