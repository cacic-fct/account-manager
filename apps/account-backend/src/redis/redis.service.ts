import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { Observable, Subject } from 'rxjs';
import { createAppConfig } from '../config/app.config';

interface ChannelSubscription {
  channel: string;
  client: RedisClientType;
  messages: Subject<string>;
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

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  subscribe(channel: string): Observable<string> {
    return new Observable((subscriber) => {
      const channelSubscription = this.getOrCreateChannelSubscription(channel);
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

  private getOrCreateChannelSubscription(channel: string): ChannelSubscription {
    const existingSubscription = this.channelSubscriptions.get(channel);
    if (existingSubscription) {
      return existingSubscription;
    }

    const subscription: ChannelSubscription = {
      channel,
      client: this.client.duplicate(),
      messages: new Subject<string>(),
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
    void this.connectChannelSubscription(subscription);

    return subscription;
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
}
