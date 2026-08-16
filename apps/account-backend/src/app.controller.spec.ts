import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import type { Response } from 'express';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHello: jest.fn().mockReturnValue('Hello World!'),
            getHealth: jest.fn().mockResolvedValue({
              status: 'ok',
              services: { redis: 'connected' },
            }),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });

    it('should return health details', async () => {
      await expect(appController.getHealth()).resolves.toEqual({
        status: 'ok',
        services: { redis: 'connected' },
      });
    });

    it('returns HTTP 503 when a required dependency is degraded', async () => {
      const degradedHealth = {
        status: 'degraded',
        timestamp: '2026-08-16T00:00:00.000Z',
        services: {
          redis: 'disconnected',
          externalUniversityVerification: {
            enabled: true,
            state: 'available' as const,
            inFlightRequests: 0,
            retryAfterMs: 0,
          },
        },
        error: 'Redis unavailable',
      };
      jest.spyOn(appService, 'getHealth').mockResolvedValueOnce(degradedHealth);
      const status = jest.fn();
      const response = {
        status,
      } as unknown as Response;

      await expect(appController.getHealth(response)).resolves.toEqual(degradedHealth);
      expect(status).toHaveBeenCalledWith(503);
    });
  });
});
