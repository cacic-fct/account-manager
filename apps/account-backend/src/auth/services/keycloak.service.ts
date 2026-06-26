import { Injectable } from '@nestjs/common';
import { KeycloakUnespRoleVerificationOperations } from './keycloak/keycloak-unesp-role-verification.operations';

export {
  KeycloakFederatedIdentity,
  KeycloakUserData,
} from './keycloak/keycloak.types';

@Injectable()
export class KeycloakService extends KeycloakUnespRoleVerificationOperations {}
