import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
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
            externalUniversityVerification: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                state: {
                  type: 'string',
                  enum: ['disabled', 'open', 'half_open', 'overloaded', 'available'],
                },
                inFlightRequests: { type: 'number' },
                retryAfterMs: { type: 'number' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'A required dependency is unavailable',
  })
  @Get('health')
  async getHealth(@Res({ passthrough: true }) response?: Response) {
    const health = await this.appService.getHealth();
    if (health.status !== 'ok') {
      response?.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return health;
  }

  @ApiOperation({ summary: 'Process liveness check' })
  @ApiResponse({ status: 200, description: 'The backend process is alive' })
  @Get('health/live')
  getLiveness() {
    return this.appService.getLiveness();
  }

  @ApiOperation({ summary: 'Required dependency readiness check' })
  @ApiResponse({ status: 200, description: 'The backend is ready to receive traffic' })
  @ApiResponse({ status: 503, description: 'A required dependency is unavailable' })
  @Get('health/ready')
  getReadiness(@Res({ passthrough: true }) response?: Response) {
    return this.getHealth(response);
  }
}
