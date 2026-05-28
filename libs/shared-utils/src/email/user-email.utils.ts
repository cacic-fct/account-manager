const UNESP_EMAIL_DOMAIN = '@unesp.br';

export function isUnespEmail(email?: string | null): boolean {
  if (!email) {
    return false;
  }

  return email.toLowerCase().endsWith(UNESP_EMAIL_DOMAIN);
}
