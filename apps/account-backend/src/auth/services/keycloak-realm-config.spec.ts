import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RealmEntry = {
  clientId?: string;
  name?: string;
  defaultClientScopes?: string[];
  protocolMappers?: {
    protocolMapper: string;
    config: Record<string, string>;
  }[];
};

const realm = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../docker/keycloak/cacic-sso-realm.json'), 'utf8'),
) as {
  clients: RealmEntry[];
  clientScopes: RealmEntry[];
  components: Record<string, { config: Record<string, string[]> }[]>;
};

describe('Keycloak custom attribute permissions', () => {
  it('defines the referenced basic scope with authentication time in ID tokens', () => {
    expect(realm.clientScopes.find((scope) => scope.name === 'basic')?.protocolMappers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocolMapper: 'oidc-usersessionmodel-note-mapper',
          config: expect.objectContaining({
            'user.session.note': 'AUTH_TIME',
            'claim.name': 'auth_time',
            'id.token.claim': 'true',
            'jsonType.label': 'long',
          }) as unknown,
        }),
      ]),
    );
  });

  it.each(['cacic-account-manager', 'cacic-event-manager'])(
    'includes basic identity and authentication-time claims for %s',
    (clientId) => {
      expect(realm.clients.find((client) => client.clientId === clientId)?.defaultClientScopes).toContain('basic');
    },
  );

  it('imports the reviewed admin-only User Profile configuration', () => {
    const component = realm.components['org.keycloak.userprofile.UserProfileProvider'][0];
    const importedProfile: unknown = JSON.parse(component.config['kc.user.profile.config'][0]);
    const sourceProfile: unknown = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../../keycloak/user-profile.json'), 'utf8'),
    );
    expect(importedProfile).toEqual(sourceProfile);
    expect(importedProfile).toMatchObject({ unmanagedAttributePolicy: 'ADMIN_EDIT' });
  });
});

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
