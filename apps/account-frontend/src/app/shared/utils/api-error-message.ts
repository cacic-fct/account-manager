import { HttpErrorResponse } from '@angular/common/http';

const defaultHttpMessages = new Set([
  'bad request',
  'unauthorized',
  'forbidden',
  'not found',
  'conflict',
  'unprocessable entity',
  'too many requests',
  'throttlerexception: too many requests',
  'internal server error',
]);

function responseMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !Object.hasOwn(body, 'message')) return undefined;

  const message: unknown = (body as Record<string, unknown>)['message'];
  const messages = typeof message === 'string' ? [message] : message;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 5) return undefined;
  if (!messages.every((item): item is string => typeof item === 'string' && item.trim().length > 0)) {
    return undefined;
  }

  const text = [...new Set(messages.map((item) => item.trim()))].join(' ');
  if (text.length > 800 || defaultHttpMessages.has(text.toLowerCase())) return undefined;

  return text;
}

/**
 * The API's intentional client errors contain user-facing validation and conflict
 * guidance. Unexpected failures, HTML/proxy bodies and Error.message do not share
 * that contract and must never be displayed as diagnostic text.
 *
 * Fallbacks should name the operation and a recovery step. For mutations whose
 * outcome is uncertain, ask users to check the current state before retrying.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;

  switch (error.status) {
    case 0:
      return `${fallback} Verifique também sua conexão com a internet.`;
    case 401:
      return 'Entre novamente na sua conta para continuar.';
    case 403:
      return (
        responseMessage(error.error) ??
        'Esta ação não foi autorizada. Atualize a página. Se o problema continuar, peça a um administrador para verificar suas permissões.'
      );
    case 413:
      return 'O arquivo excede o tamanho permitido. Escolha um arquivo menor e envie novamente.';
    case 429:
      return (
        responseMessage(error.error) ??
        'Foram feitas muitas solicitações em pouco tempo. Aguarde alguns instantes antes de tentar novamente.'
      );
    case 400:
    case 404:
    case 409:
    case 410:
    case 422:
      return responseMessage(error.error) ?? fallback;
    default:
      return fallback;
  }
}
