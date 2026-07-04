import { AccountManagerKeycloakRole } from '@cacic/shared-types';

export const ACCOUNT_MANAGER_SUPER_ADMIN_ROLE = AccountManagerKeycloakRole.SuperAdmin;

export const ACCOUNT_MANAGER_ADMIN_ROLES = [ACCOUNT_MANAGER_SUPER_ADMIN_ROLE] as const;
