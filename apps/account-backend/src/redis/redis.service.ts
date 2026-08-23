import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { Observable, Subject } from 'rxjs';
import { createAppConfig } from '../config/app.config';

interface ChannelSubscription {
  channel: string;
  client: RedisClientType;
  messages: Subject<string>;
  ready: Promise<void>;
  observerCount: number;
  closed: boolean;
  closePromise?: Promise<void>;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClientType;
  private readonly logger = new Logger(RedisService.name);
  private readonly channelSubscriptions = new Map<string, ChannelSubscription>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const appConfig = createAppConfig(this.configService);

    this.client = createClient({
      socket: {
        host: appConfig.redis.host,
        port: appConfig.redis.port,
      },
      ...(appConfig.redis.password && { password: appConfig.redis.password }),
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis connection error', err);
    });

    this.client.on('connect', () => {
      this.logger.log('Redis service connected');
    });

    this.client.on('reconnecting', () => {
      this.logger.warn('Redis service reconnecting...');
    });

    try {
      await this.client.connect();
    } catch (error) {
      this.logger.fatal('Failed to initialize Redis service client', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    const channelSubscriptions = [...this.channelSubscriptions.values()];
    channelSubscriptions.forEach((subscription) => subscription.messages.complete());
    await Promise.all(channelSubscriptions.map((subscription) => this.closeChannelSubscription(subscription)));

    if (this.client) {
      await this.client.quit();
    }
  }

  getClient(): RedisClientType {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl !== undefined) {
      await this.client.setEx(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, {
      NX: true,
      EX: ttlSeconds,
    });
    return result === 'OK';
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async eval(script: string, keys: string[], args: string[] = []): Promise<unknown> {
    return this.client.eval(script, {
      keys,
      arguments: args,
    });
  }

  async releaseIfOwned(key: string, value: string): Promise<boolean> {
    const result = await this.client.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`,
      {
        keys: [key],
        arguments: [value],
      },
    );

    return result === 1;
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  subscribe(channel: string): Observable<string> {
    return new Observable((subscriber) =>
      this.observeChannelSubscription(this.getOrCreateChannelSubscription(channel)).subscribe(subscriber),
    );
  }

  async subscribeWhenReady(channel: string): Promise<Observable<string>> {
    await this.getOrCreateChannelSubscription(channel).ready;
    return new Observable((subscriber) =>
      this.observeChannelSubscription(this.getOrCreateChannelSubscription(channel)).subscribe(subscriber),
    );
  }

  private getOrCreateChannelSubscription(channel: string): ChannelSubscription {
    const existingSubscription = this.channelSubscriptions.get(channel);
    if (existingSubscription) {
      return existingSubscription;
    }

    const subscription: ChannelSubscription = {
      channel,
      client: this.client.duplicate(),
      messages: new Subject<string>(),
      ready: Promise.resolve(),
      observerCount: 0,
      closed: false,
    };
    this.channelSubscriptions.set(channel, subscription);

    subscription.client.on('error', (error) => {
      if (!subscription.closed) {
        subscription.messages.error(error);
        void this.closeChannelSubscription(subscription);
      }
    });
    subscription.ready = this.connectChannelSubscription(subscription);
    void subscription.ready.catch(() => undefined);

    return subscription;
  }

  private observeChannelSubscription(channelSubscription: ChannelSubscription): Observable<string> {
    return new Observable((subscriber) => {
      channelSubscription.observerCount += 1;
      const messageSubscription = channelSubscription.messages.subscribe(subscriber);

      return () => {
        messageSubscription.unsubscribe();
        channelSubscription.observerCount -= 1;

        if (channelSubscription.observerCount === 0) {
          void this.closeChannelSubscription(channelSubscription);
        }
      };
    });
  }

  private async connectChannelSubscription(subscription: ChannelSubscription): Promise<void> {
    try {
      await subscription.client.connect();

      if (subscription.closed) {
        await this.closeChannelSubscription(subscription);
        return;
      }

      await subscription.client.subscribe(subscription.channel, (message) => subscription.messages.next(message));
    } catch (error) {
      if (!subscription.closed) {
        subscription.messages.error(error);
      }
      await this.closeChannelSubscription(subscription);
      throw error;
    }
  }

  private async closeChannelSubscription(subscription: ChannelSubscription): Promise<void> {
    if (!subscription.closed) {
      subscription.closed = true;
      if (this.channelSubscriptions.get(subscription.channel) === subscription) {
        this.channelSubscriptions.delete(subscription.channel);
      }
    }

    if (!subscription.client.isOpen) {
      return;
    }

    if (!subscription.closePromise) {
      subscription.closePromise = (async () => {
        try {
          await subscription.client.unsubscribe(subscription.channel);
        } catch (error) {
          this.logger.warn(`Failed to unsubscribe from Redis channel ${subscription.channel}`, error);
        }

        try {
          await subscription.client.quit();
        } catch (error) {
          this.logger.warn(`Failed to close Redis subscriber for channel ${subscription.channel}`, error);
        }
      })();
    }

    await subscription.closePromise;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    return this.client.expire(key, ttl);
  }

  async incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const result = await this.client.eval(
      `local value = redis.call('INCR', KEYS[1])
if value == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return value`,
      {
        keys: [key],
        arguments: [ttlSeconds.toString()],
      },
    );

    if (typeof result !== 'number') {
      throw new Error('Redis returned an invalid rate-limit counter');
    }

    return result;
  }
}
