import { Response } from 'express';
import type { AuthSession } from './auth.controller';

export function saveSession(session: AuthSession): Promise<void> {
  const saveSessionCallback = session.save;
  if (!saveSessionCallback) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    saveSessionCallback.call(session, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function redirectAfterSessionSave(
  session: AuthSession,
  response: Response,
  redirectUrl: string,
): Promise<void> {
  await saveSession(session);
  response.redirect(redirectUrl);
}
