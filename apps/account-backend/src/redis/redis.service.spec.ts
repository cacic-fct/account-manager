import { RedisService } from './redis.service';

describe('RedisService', () => {
  async function waitForSubscription(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  function createService({
    unsubscribe,
    quit,
  }: {
    unsubscribe?: jest.Mock;
    quit?: jest.Mock;
  } = {}) {
    let messageHandler: ((message: string) => void) | undefined;
    const subscriberClient = {
      isOpen: false,
      on: jest.fn(),
      connect: jest.fn(async () => {
        subscriberClient.isOpen = true;
      }),
      subscribe: jest.fn(async (_channel: string, handler: (message: string) => void) => {
        messageHandler = handler;
      }),
      unsubscribe: unsubscribe ?? jest.fn().mockResolvedValue(undefined),
      quit: quit ?? jest.fn().mockResolvedValue(undefined),
    };
    const client = { duplicate: jest.fn(() => subscriberClient) };
    const service = new RedisService({} as never);
    (service as unknown as { client: typeof client }).client = client;

    return {
      service,
      client,
      subscriberClient,
      publishMessage(message: string) {
        messageHandler?.(message);
      },
    };
  }

  it('shares one Redis subscriber per channel and closes it after the final observer unsubscribes', async () => {
    const { service, client, subscriberClient, publishMessage } = createService();
    const firstMessages: string[] = [];
    const secondMessages: string[] = [];
    const firstSubscription = service.subscribe('account-merge-updates').subscribe((message) => firstMessages.push(message));
    const secondSubscription = service.subscribe('account-merge-updates').subscribe((message) => secondMessages.push(message));

    await waitForSubscription();
    publishMessage('merge-request');

    expect(client.duplicate).toHaveBeenCalledTimes(1);
    expect(firstMessages).toEqual(['merge-request']);
    expect(secondMessages).toEqual(['merge-request']);

    firstSubscription.unsubscribe();
    expect(subscriberClient.unsubscribe).not.toHaveBeenCalled();

    secondSubscription.unsubscribe();
    await waitForSubscription();

    expect(subscriberClient.unsubscribe).toHaveBeenCalledWith('account-merge-updates');
    expect(subscriberClient.quit).toHaveBeenCalledTimes(1);
  });

  it('contains subscriber shutdown failures during teardown', async () => {
    const unsubscribe = jest.fn().mockRejectedValue(new Error('unsubscribe failed'));
    const quit = jest.fn().mockRejectedValue(new Error('quit failed'));
    const { service } = createService({ unsubscribe, quit });
    const subscription = service.subscribe('account-merge-updates').subscribe();

    await waitForSubscription();
    subscription.unsubscribe();
    await waitForSubscription();

    expect(unsubscribe).toHaveBeenCalledWith('account-merge-updates');
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('forwards shared subscriber errors to active observers', async () => {
    const { service, subscriberClient } = createService();
    const errors: Error[] = [];
    service.subscribe('account-merge-updates').subscribe({ error: (error: Error) => errors.push(error) });

    await waitForSubscription();
    const errorHandler = subscriberClient.on.mock.calls.find(([event]) => event === 'error')?.[1] as (error: Error) => void;
    const connectionError = new Error('connection failed');
    errorHandler(connectionError);
    await waitForSubscription();

    expect(errors).toEqual([connectionError]);
    expect(subscriberClient.unsubscribe).toHaveBeenCalledWith('account-merge-updates');
    expect(subscriberClient.quit).toHaveBeenCalledTimes(1);
  });
});
