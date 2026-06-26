import { createHash, randomBytes } from 'crypto';

export interface PkceChallenge {
  verifier: string;
  challenge: string;
}

export function createPkceChallenge(): PkceChallenge {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  return { verifier, challenge };
}
