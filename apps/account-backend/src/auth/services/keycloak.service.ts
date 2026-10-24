import { Injectable } from '@nestjs/common';
import { KeycloakOnboardingOperations } from './keycloak/keycloak-onboarding.operations';

export type { KeycloakFederatedIdentity, KeycloakUserData } from './keycloak/keycloak.types';

@Injectable()
export class KeycloakService extends KeycloakOnboardingOperations {}
