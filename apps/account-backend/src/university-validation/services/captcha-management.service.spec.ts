jest.mock('./document-validation.service', () => ({
  DocumentValidationService: class DocumentValidationService {},
}));

import type { AxiosInstance } from 'axios';
import type { CookieJar } from 'tough-cookie';
import type { ConfigService } from '@nestjs/config';
import type { RedisService } from '../../redis/redis.service';
import { CaptchaManagementService } from './captcha-management.service';
import type { DocumentValidationService } from './document-validation.service';
import type { ExternalVerificationResilienceService } from './external-verification-resilience.service';
import type { HtmlResponseService } from './html-response.service';
import type { SessionManagementService } from './session-management.service';

const createSharedLockRedis = () => {
  const values = new Map<string, { value: string; expiresAt: number }>();
  const expireStale = (key: string) => {
    const entry = values.get(key);
    if (entry && entry.expiresAt <= Date.now()) {
      values.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    setIfAbsent: jest.fn((key: string, value: string, ttlSeconds: number) => {
      if (expireStale(key)) return Promise.resolve(false);
      values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return Promise.resolve(true);
    }),
    releaseIfOwned: jest.fn((key: string, value: string) => {
      const entry = expireStale(key);
      if (!entry || entry.value !== value) return Promise.resolve(false);
      values.delete(key);
      return Promise.resolve(true);
    }),
  } as unknown as RedisService;
};

describe('CaptchaManagementService', () => {
  const createContext = (sharedRedis = createSharedLockRedis()) => {
    const sessions = {
      getOwnedSession: jest.fn(),
      getSession: jest.fn(),
      storeSession: jest.fn(),
      deleteSession: jest.fn(),
    };
    const html = { handleHtmlResponse: jest.fn() };
    const documentValidation = {
      validatePdfDocument: jest.fn<
        Promise<{ success: boolean; isValid: boolean }>,
        [unknown, Buffer, string, string, string, string]
      >(),
    };
    const resilience = {
      timeoutMs: 10_000,
      maxResponseBytes: 12 * 1024 * 1024,
      execute: jest.fn((_operation: string, task: () => Promise<unknown>) => task()),
    };
    const service = new CaptchaManagementService(
      sessions as unknown as SessionManagementService,
      html as unknown as HtmlResponseService,
      documentValidation as unknown as DocumentValidationService,
      resilience as unknown as ExternalVerificationResilienceService,
      sharedRedis,
      {
        get: jest.fn((name: string) => (name === 'UNIVERSITY_EXTERNAL_OPERATION_LOCK_TTL_MS' ? '1000' : undefined)),
      } as unknown as ConfigService,
    );
    return { service, sessions, documentValidation, redis: sharedRedis };
  };

  it('rejects refresh for a session not owned by the authenticated user before upstream I/O', async () => {
    const { service, sessions } = createContext();
    sessions.getOwnedSession.mockReturnValue(undefined);

    await expect(service.refreshCaptcha('session-1', 'user-2')).rejects.toThrow('Sessão de validação');
  });

  it('preserves exact provider PDF bytes and deletes a successful one-time session', async () => {
    const { service, sessions, documentValidation } = createContext();
    const providerPdf = Buffer.from('%PDF-\x00\xffprovider', 'latin1');
    const setCookie = jest.fn().mockResolvedValue(undefined);
    const axiosInstance = {
      post: jest.fn().mockResolvedValue({
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'set-cookie': ['JSESSIONID=rotated; Path=/academico; Secure; HttpOnly'],
        },
        data: providerPdf,
      }),
    };
    sessions.getOwnedSession.mockReturnValue({
      sessionId: 'session-1',
      userId: 'user-1',
      authCode: 'AAAA-BBBB-CCCC-DDDD-1111-2222-3333-4444',
      hiddenInputs: { token: 'opaque' },
      pageUrl: 'https://sistemas.unesp.br/academico/publico/documento.action',
      formActionUrl: 'https://sistemas.unesp.br/academico/publico/documento.emitir.action',
      axiosInstance: axiosInstance as unknown as AxiosInstance,
      cookieJar: {
        getCookieString: jest.fn().mockResolvedValue('JSESSIONID=opaque'),
        setCookie,
      } as unknown as CookieJar,
      createdAt: new Date(),
    });
    documentValidation.validatePdfDocument.mockResolvedValue({ success: true, isValid: true });

    await expect(service.validateDocument('session-1', '12345678', 'A1B2', 'user-1')).resolves.toMatchObject({
      success: true,
    });
    const receivedPdf = documentValidation.validatePdfDocument.mock.calls[0][1];
    expect(receivedPdf.equals(providerPdf)).toBe(true);
    expect(axiosInstance.post).toHaveBeenCalledWith(
      'https://sistemas.unesp.br/academico/publico/documento.emitir.action',
      expect.stringContaining('txt_codigo_captcha=A1B2'),
      expect.objectContaining({
        maxRedirects: 0,
        responseType: 'arraybuffer',
      }),
    );
    expect(setCookie).toHaveBeenCalledWith(
      'JSESSIONID=rotated; Path=/academico; Secure; HttpOnly',
      'https://sistemas.unesp.br/academico/publico/documento.emitir.action',
    );
    expect(sessions.deleteSession).toHaveBeenCalledWith('session-1');
  });

  it('serializes refresh and validation transitions for the same provider session', async () => {
    const { service, sessions, documentValidation } = createContext();
    const providerPdf = Buffer.from('%PDF-provider');
    let resolveSubmission: (value: { status: number; headers: Record<string, string>; data: Buffer }) => void;
    const submission = new Promise<{ status: number; headers: Record<string, string>; data: Buffer }>((resolve) => {
      resolveSubmission = resolve;
    });
    const axiosInstance = {
      post: jest.fn().mockReturnValue(submission),
    };
    sessions.getOwnedSession.mockReturnValue({
      sessionId: 'session-1',
      userId: 'user-1',
      authCode: 'AAAA-BBBB-CCCC-DDDD-1111-2222-3333-4444',
      hiddenInputs: {},
      pageUrl: 'https://sistemas.unesp.br/academico/publico/documento.action',
      formActionUrl: 'https://sistemas.unesp.br/academico/publico/documento.emitir.action',
      axiosInstance: axiosInstance as unknown as AxiosInstance,
      cookieJar: {
        getCookieString: jest.fn().mockResolvedValue('JSESSIONID=opaque'),
        setCookie: jest.fn().mockResolvedValue(undefined),
      } as unknown as CookieJar,
      createdAt: new Date(),
    });
    documentValidation.validatePdfDocument.mockResolvedValue({ success: true, isValid: true });

    const firstValidation = service.validateDocument('session-1', '12345678', 'A1B2', 'user-1');
    await new Promise<void>((resolve) => setImmediate(resolve));

    await expect(service.validateDocument('session-1', '12345678', 'C3D4', 'user-1')).resolves.toEqual({
      success: false,
      error: 'Já existe uma operação em andamento para esta sessão.',
    });
    await expect(service.refreshCaptcha('session-1', 'user-1')).rejects.toThrow('operação em andamento');
    expect(axiosInstance.post).toHaveBeenCalledTimes(1);

    resolveSubmission!({
      status: 200,
      headers: { 'content-type': 'application/pdf' },
      data: providerPdf,
    });
    await expect(firstValidation).resolves.toMatchObject({ success: true });
  });

  it('shares the active-operation lock across replicas and releases it after TTL/restart', async () => {
    jest.useFakeTimers();
    try {
      const redis = createSharedLockRedis();
      const firstReplica = createContext(redis).service;
      const restartedReplica = createContext(redis).service;
      const firstLock = (
        firstReplica as unknown as { tryStartSessionOperation: (sessionId: string) => Promise<boolean> }
      ).tryStartSessionOperation;
      const secondLock = (
        restartedReplica as unknown as { tryStartSessionOperation: (sessionId: string) => Promise<boolean> }
      ).tryStartSessionOperation;

      await expect(firstLock.call(firstReplica, 'session-1')).resolves.toBe(true);
      await expect(secondLock.call(restartedReplica, 'session-1')).resolves.toBe(false);
      jest.advanceTimersByTime(1001);
      await expect(secondLock.call(restartedReplica, 'session-1')).resolves.toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
