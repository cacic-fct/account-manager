import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Health Check')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({
    summary: 'Health check',
    description: 'Simple health check endpoint that returns a greeting message.',
  })
  @ApiResponse({
    status: 200,
    description: 'Health check successful',
    schema: {
      type: 'string',
      example: 'Hello World!',
    },
  })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @ApiOperation({
    summary: 'Comprehensive health check',
    description: 'Comprehensive health check that includes Redis connection status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Health check successful',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2025-01-01T00:00:00Z' },
        services: {
          type: 'object',
          properties: {
            redis: { type: 'string', example: 'connected' },
          },
        },
      },
    },
  })
  @Get('health')
  async getHealth() {
    return await this.appService.getHealth();
  }
}
