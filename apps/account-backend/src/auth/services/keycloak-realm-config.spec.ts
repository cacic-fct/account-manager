import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RealmEntry = {
  clientId?: string;
  name?: string;
  protocolMappers?: {
    protocolMapper: string;
    config: Record<string, string>;
  }[];
};

const realm = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../docker/keycloak/cacic-sso-realm.json'), 'utf8'),
) as { clients: RealmEntry[]; clientScopes: RealmEntry[] };

describe('Keycloak realm introspection audience', () => {
  it.each([
    {
      name: 'cacic-event-manager login',
      audience: 'cacic-event-manager',
      entry: realm.clients.find((client) => client.clientId === 'cacic-event-manager'),
    },
    {
      name: 'cacic-event-manager M2M',
      audience: 'cacic-event-manager',
      entry: realm.clientScopes.find((scope) => scope.name === 'cacic-event-manager-audience'),
    },
    {
      name: 'cacic-account-manager login',
      audience: 'cacic-account-manager',
      entry: realm.clients.find((client) => client.clientId === 'cacic-account-manager'),
    },
    {
      name: 'cacic-account-manager M2M',
      audience: 'cacic-account-manager',
      entry: realm.clientScopes.find((scope) => scope.name === 'cacic-account-manager-audience'),
    },
  ])('includes the receiving backend in tokens from $name', ({ audience, entry }) => {
    const includesAudienceMapper = entry?.protocolMappers?.some(
      ({ protocolMapper, config }) =>
        protocolMapper === 'oidc-audience-mapper' &&
        config['included.client.audience'] === audience &&
        config['access.token.claim'] === 'true' &&
        config['id.token.claim'] === 'false',
    );

    expect(includesAudienceMapper).toBe(true);
  });
});
