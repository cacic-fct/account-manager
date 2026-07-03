export class KeycloakClientRoleNotFoundException extends Error {
  readonly code = 'KEYCLOAK_CLIENT_ROLE_NOT_FOUND';

  constructor(
    readonly clientId: string,
    readonly roleName: string,
  ) {
    super(`Keycloak client role ${clientId}:${roleName} was not found`);
    this.name = 'KeycloakClientRoleNotFoundException';
  }
}
