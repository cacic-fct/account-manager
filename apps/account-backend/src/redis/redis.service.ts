import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { Observable } from 'rxjs';
import { createAppConfig } from '../config/app.config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

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
      const subscriberClient = this.client.duplicate();
      let closed = false;

      const close = async () => {
        if (subscriberClient.isOpen) {
          await subscriberClient.unsubscribe(channel);
          await subscriberClient.quit();
        }
      };

      void (async () => {
        try {
          await subscriberClient.connect();

          if (closed) {
            await close();
            return;
          }

          await subscriberClient.subscribe(channel, (message) => subscriber.next(message));
        } catch (error) {
          if (!closed) {
            subscriber.error(error);
          }
          await close();
        }
      })();

      return () => {
        closed = true;
        void close();
      };
    });
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    return this.client.expire(key, ttl);
  }
}
