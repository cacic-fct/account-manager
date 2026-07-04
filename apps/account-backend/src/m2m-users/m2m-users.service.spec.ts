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
});
