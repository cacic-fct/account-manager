import { environment } from '../../../environments/environment';
import { isConfiguredApiRequest, isConfiguredApiRoute } from './request-url.util';

describe('request URL classification', () => {
  const originalApiUrl = environment.apiUrl;

  beforeEach(() => {
    environment.apiUrl = 'https://api.example.com/api';
  });

  afterEach(() => {
    environment.apiUrl = originalApiUrl;
  });

  it('matches only the configured API origin and path', () => {
    expect(isConfiguredApiRequest(`${environment.apiUrl}/auth/me`)).toBe(true);
    expect(isConfiguredApiRequest('https://api.example.com.attacker.test/api/auth/me')).toBe(false);
    expect(isConfiguredApiRequest('http://localhost:3000/api-v2/auth/me')).toBe(false);
    expect(isConfiguredApiRequest('https://localhost:3000/api/auth/me')).toBe(false);
  });

  it('matches exact API routes instead of substrings', () => {
    expect(isConfiguredApiRoute(`${environment.apiUrl}/auth/logout`, '/auth/logout')).toBe(true);
    expect(isConfiguredApiRoute(`${environment.apiUrl}/auth/logout-audit`, '/auth/logout')).toBe(false);
    expect(isConfiguredApiRoute(`${environment.apiUrl}/auth/me?next=/auth/logout`, '/auth/logout')).toBe(false);
  });
});
