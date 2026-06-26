import { createHash } from 'crypto';
import { createPkceChallenge } from './pkce.utils';

describe('createPkceChallenge', () => {
  it('creates an S256-compatible verifier and challenge pair', () => {
    const pkce = createPkceChallenge();
    const expectedChallenge = createHash('sha256')
      .update(pkce.verifier)
      .digest('base64url');

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge).toBe(expectedChallenge);
  });
});
