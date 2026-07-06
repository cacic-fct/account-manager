import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'discord.js';

@Injectable()
export class DiscordClientService {
  private readonly logger = new Logger(DiscordClientService.name);
  private client!: Client;

  setClient(client: Client): void {
    this.client = client;
    this.logger.debug('Discord client set');
  }

  getClient(): Client {
    if (!this.client) {
      throw new Error('Discord client not available');
    }
    return this.client;
  }
}
