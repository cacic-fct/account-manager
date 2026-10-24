import { HttpErrorResponse } from '@angular/common/http';
import { getApiErrorMessage } from './api-error-message';

describe('getApiErrorMessage', () => {
  const fallback = 'Não foi possível confirmar a alteração. Atualize os dados antes de tentar novamente.';

  it('preserves actionable client errors and validation arrays', () => {
    expect(
      getApiErrorMessage(
        new HttpErrorResponse({
          status: 409,
          error: { message: 'Já existe uma solicitação em andamento. Acompanhe o status nesta página.' },
        }),
        fallback,
      ),
    ).toContain('Já existe uma solicitação em andamento.');
    expect(
      getApiErrorMessage(
        new HttpErrorResponse({
          status: 400,
          error: { message: ['Informe uma justificativa.', 'Selecione uma pessoa.', 'Informe uma justificativa.'] },
        }),
        fallback,
      ),
    ).toBe('Informe uma justificativa. Selecione uma pessoa.');
  });

  it.each([500, 502, 503, 504])('keeps diagnostics out of server error %s', (status) => {
    const error = new HttpErrorResponse({
      status,
      error: { message: 'Database password=secret, CPF 12345678901', stack: '/srv/private.ts:42' },
    });
    expect(getApiErrorMessage(error, fallback)).toBe(fallback);
  });

  it.each([
    null,
    '<html>Private proxy diagnostics</html>',
    { message: null },
    { message: ['Useful text', { private: 'details' }] },
    { message: 'x'.repeat(801) },
    { message: 'Bad Request' },
    { message: [] },
  ])('uses context for malformed or generic API errors: %s', (error) => {
    expect(getApiErrorMessage(new HttpErrorResponse({ status: 400, error }), fallback)).toBe(fallback);
  });

  it('does not expose Error.message or a non-HTTP error object', () => {
    expect(getApiErrorMessage(new Error('secret'), fallback)).toBe(fallback);
    expect(getApiErrorMessage({ status: 400, error: { message: 'secret' } }, fallback)).toBe(fallback);
  });

  it('does not imply a network failure rolled back the operation', () => {
    const message = getApiErrorMessage(new HttpErrorResponse({ status: 0 }), fallback);
    expect(message).toContain(fallback);
    expect(message).toContain('Verifique também sua conexão com a internet.');
  });

  it('explains authentication, authorization, upload limits and throttling', () => {
    expect(
      getApiErrorMessage(new HttpErrorResponse({ status: 401, error: { message: 'private' } }), fallback),
    ).toContain('Entre novamente');
    expect(getApiErrorMessage(new HttpErrorResponse({ status: 403 }), fallback)).toContain('permissões');
    expect(getApiErrorMessage(new HttpErrorResponse({ status: 413 }), fallback)).toContain('arquivo menor');
    expect(
      getApiErrorMessage(
        new HttpErrorResponse({
          status: 429,
          error: { message: 'ThrottlerException: Too Many Requests' },
        }),
        fallback,
      ),
    ).toContain('Aguarde');
  });
});
