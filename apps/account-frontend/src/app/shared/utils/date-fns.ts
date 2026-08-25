import { format, isValid, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const DATE_FNS_LOCALE = ptBR;

export function formatLocalizedDate(
  value: Date | string | null | undefined,
  formatString: string,
  fallback = '',
): string {
  if (value === null || value === undefined) {
    return fallback;
  }

  const date = typeof value === 'string' ? parseISO(value) : value;
  return isValid(date) ? format(date, formatString, { locale: DATE_FNS_LOCALE }) : fallback;
}
