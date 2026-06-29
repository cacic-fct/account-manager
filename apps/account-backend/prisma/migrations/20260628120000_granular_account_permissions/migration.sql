ALTER TABLE "keycloak_permission_grants"
  ADD COLUMN "client_id" TEXT,
  ADD COLUMN "role_name" TEXT;

ALTER TABLE "student_entity_memberships"
  ALTER COLUMN "mandate_end" DROP NOT NULL;

UPDATE "keycloak_permission_grants"
SET
  "client_id" = 'cacic-account-manager',
  "role_name" = "permission"
WHERE "client_id" IS NULL OR "role_name" IS NULL;

UPDATE "keycloak_permission_grants"
SET "permission" = "client_id" || ':' || "role_name"
WHERE position(':' in "permission") = 0;

ALTER TABLE "keycloak_permission_grants"
  ALTER COLUMN "client_id" SET NOT NULL,
  ALTER COLUMN "role_name" SET NOT NULL;

CREATE INDEX "keycloak_permission_grants_client_id_role_name_idx"
  ON "keycloak_permission_grants"("client_id", "role_name");

CREATE TABLE "keycloak_group_permission_grants" (
  "id" UUID NOT NULL,
  "group_key" TEXT NOT NULL,
  "keycloak_group_id" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "role_name" TEXT NOT NULL,
  "valid_from" TIMESTAMP(3),
  "valid_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "last_synced_at" TIMESTAMP(3),
  "last_sync_error" TEXT,
  CONSTRAINT "keycloak_group_permission_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "keycloak_group_permission_grants_group_key_idx"
  ON "keycloak_group_permission_grants"("group_key");
CREATE INDEX "keycloak_group_permission_grants_keycloak_group_id_idx"
  ON "keycloak_group_permission_grants"("keycloak_group_id");
CREATE INDEX "keycloak_group_permission_grants_permission_idx"
  ON "keycloak_group_permission_grants"("permission");
CREATE INDEX "keycloak_group_permission_grants_client_id_role_name_idx"
  ON "keycloak_group_permission_grants"("client_id", "role_name");
CREATE INDEX "keycloak_group_permission_grants_valid_from_idx"
  ON "keycloak_group_permission_grants"("valid_from");
CREATE INDEX "keycloak_group_permission_grants_valid_until_idx"
  ON "keycloak_group_permission_grants"("valid_until");
CREATE INDEX "keycloak_group_permission_grants_deleted_at_idx"
  ON "keycloak_group_permission_grants"("deleted_at");

CREATE UNIQUE INDEX "keycloak_group_permission_grants_group_permission_active_key"
  ON "keycloak_group_permission_grants"("group_key", "permission")
  WHERE "deleted_at" IS NULL;
