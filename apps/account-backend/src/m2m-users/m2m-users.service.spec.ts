import { KeycloakService, KeycloakUserData } from '../auth/services/keycloak.service';
import { M2MUsersService } from './m2m-users.service';

type KeycloakMock = jest.Mocked<Pick<KeycloakService, 'findUserByEmail' | 'searchUsersByAttribute'>>;

function keycloakUser(overrides: Partial<KeycloakUserData> = {}): KeycloakUserData {
  return {
    id: 'user-1',
    email: 'ana.souza@unesp.br',
    username: 'ana.souza',
    firstName: 'Ana',
    lastName: 'Souza',
    enabled: true,
    attributes: {
      fullName: ['Ana Souza'],
      enrollmentNumber: ['24123456'],
      phone: ['+5514999998888'],
      'identity-document': ['12345678901'],
    },
    ...overrides,
  };
}

describe('M2MUsersService', () => {
  let keycloak: KeycloakMock;
  let service: M2MUsersService;

  beforeEach(() => {
    keycloak = {
      findUserByEmail: jest.fn().mockResolvedValue(null),
      searchUsersByAttribute: jest.fn().mockResolvedValue([]),
    };
    service = new M2MUsersService(keycloak as unknown as KeycloakService);
  });

  it('looks up enrollment numbers exactly and omits unmatched input', async () => {
    keycloak.searchUsersByAttribute
      .mockResolvedValueOnce([
        keycloakUser(),
        keycloakUser({
          id: 'overmatch',
          email: 'other@unesp.br',
          attributes: { enrollmentNumber: ['241234567'] },
        }),
      ])
      .mockResolvedValueOnce([]);

    await expect(service.lookupByEnrollmentNumbers([' 24123456 ', '24123456', '99999999'])).resolves.toEqual([
      {
        userId: 'user-1',
        enrollmentNumber: '24123456',
        name: 'Ana Souza',
        email: 'ana.souza@unesp.br',
      },
    ]);

    expect(keycloak.searchUsersByAttribute).toHaveBeenCalledTimes(2);
    expect(keycloak.searchUsersByAttribute).toHaveBeenNthCalledWith(1, 'enrollmentNumber', '24123456', { max: 10 });
    expect(keycloak.searchUsersByAttribute).toHaveBeenNthCalledWith(2, 'enrollmentNumber', '99999999', { max: 10 });
  });

  it('matches private identifiers without echoing unmatched values', async () => {
    keycloak.findUserByEmail.mockResolvedValueOnce(keycloakUser());
    keycloak.searchUsersByAttribute.mockResolvedValueOnce([
      keycloakUser({
        id: 'cpf-match',
        email: 'cpf@unesp.br',
        attributes: {
          fullName: ['CPF Match'],
          enrollmentNumber: ['24111111'],
          'identity-document': ['12345678901'],
        },
      }),
      keycloakUser({
        id: 'cpf-overmatch',
        email: 'overmatch@unesp.br',
        attributes: {
          fullName: ['Overmatch'],
          enrollmentNumber: ['24222222'],
          'identity-document': ['12345678900'],
        },
      }),
    ]);

    await expect(
      service.lookupByIdentifiers([
        {
          requestId: ' email-member ',
          identifierType: 'email',
          identifierValue: ' ANA.SOUZA@UNESP.BR ',
        },
        {
          requestId: 'cpf-member',
          identifierType: 'cpf',
          identifierValue: '123.456.789-01',
        },
        {
          requestId: 'missing-member',
          identifierType: 'cpf',
          identifierValue: '000.000.000-00',
        },
      ]),
    ).resolves.toEqual([
      {
        requestId: 'email-member',
        userId: 'user-1',
        enrollmentNumber: '24123456',
        name: 'Ana Souza',
        email: 'ana.souza@unesp.br',
      },
      {
        requestId: 'cpf-member',
        userId: 'cpf-match',
        enrollmentNumber: '24111111',
        name: 'CPF Match',
        email: 'cpf@unesp.br',
      },
    ]);

    expect(keycloak.findUserByEmail).toHaveBeenCalledWith('ana.souza@unesp.br');
    expect(keycloak.searchUsersByAttribute).toHaveBeenCalledWith('identity-document', '12345678901', { max: 10 });
    expect(keycloak.searchUsersByAttribute).toHaveBeenCalledWith('identityDocument', '12345678901', { max: 10 });
    expect(keycloak.searchUsersByAttribute).toHaveBeenCalledWith('identity-document', '00000000000', { max: 10 });
  });

  it('maps normalized optional profile claims from camelCase and snake_case attributes', async () => {
    const camelCaseUser = keycloakUser({
      id: 'camel-case-user',
      email: 'Camel.Case@UNESP.BR',
      attributes: {
        ...keycloakUser().attributes,
        unespRole: [' aluno-graduacao '],
        unespRoleVerified: [' TRUE '],
        secondaryEmails: ['Personal@Example.com, second@example.com', '["THIRD@example.com", "personal@example.com"]'],
      },
    });
    const snakeCaseUser = keycloakUser({
      id: 'snake-case-user',
      email: 'snake.case@unesp.br',
      attributes: {
        ...keycloakUser().attributes,
        unesp_role: ['servidor'],
        unesp_role_verified: ['false'],
        secondary_emails: ['secondary@Example.com'],
      },
    });
    keycloak.findUserByEmail.mockResolvedValueOnce(camelCaseUser).mockResolvedValueOnce(snakeCaseUser);

    await expect(
      service.lookupByIdentifiers([
        {
          requestId: 'camel-case',
          identifierType: 'email',
          identifierValue: 'camel.case@unesp.br',
        },
        {
          requestId: 'snake-case',
          identifierType: 'email',
          identifierValue: 'snake.case@unesp.br',
        },
      ]),
    ).resolves.toEqual([
      {
        requestId: 'camel-case',
        userId: 'camel-case-user',
        enrollmentNumber: '24123456',
        name: 'Ana Souza',
        email: 'Camel.Case@UNESP.BR',
        unespRole: 'aluno-graduacao',
        unespRoleVerified: true,
        secondaryEmails: ['personal@example.com', 'second@example.com', 'third@example.com'],
      },
      {
        requestId: 'snake-case',
        userId: 'snake-case-user',
        enrollmentNumber: '24123456',
        name: 'Ana Souza',
        email: 'snake.case@unesp.br',
        unespRole: 'servidor',
        unespRoleVerified: false,
        secondaryEmails: ['secondary@example.com'],
      },
    ]);
  });

  it('omits malformed UNESP verification values instead of treating them as true', async () => {
    keycloak.findUserByEmail.mockResolvedValueOnce(
      keycloakUser({
        attributes: {
          ...keycloakUser().attributes,
          unespRole: ['aluno-pos-graduacao'],
          unespRoleVerified: ['yes'],
        },
      }),
    );

    await expect(
      service.lookupByIdentifiers([
        {
          requestId: 'malformed-verification',
          identifierType: 'email',
          identifierValue: 'ana.souza@unesp.br',
        },
      ]),
    ).resolves.toEqual([
      {
        requestId: 'malformed-verification',
        userId: 'user-1',
        enrollmentNumber: '24123456',
        name: 'Ana Souza',
        email: 'ana.souza@unesp.br',
        unespRole: 'aluno-pos-graduacao',
      },
    ]);
  });
});
