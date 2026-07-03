CREATE INDEX CONCURRENTLY "keycloak_permission_grants_client_id_role_name_idx"
  ON "keycloak_permission_grants"("client_id", "role_name");
