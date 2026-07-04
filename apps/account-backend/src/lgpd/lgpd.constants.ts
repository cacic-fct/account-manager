export type AccountDeletionFailure = {
  service: string;
  operation: string;
  message: string;
};

export const LGPD_ACTIVE_REQUEST_EXPIRATION_DAYS = 7;

export const LGPD_ACTIVE_REQUEST_EXPIRATION_MS = LGPD_ACTIVE_REQUEST_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;

export const LGPD_ACTIVE_REQUEST_EXPIRED_MESSAGE =
  'Solicitação expirada automaticamente após 7 dias sem conclusão. Faça uma nova solicitação para gerar seus dados.';
