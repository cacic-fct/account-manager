-- CreateTable
CREATE TABLE "keycloak_permission_grants" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_email" TEXT,
    "user_display_name" TEXT,
    "permission" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_sync_error" TEXT,

    CONSTRAINT "keycloak_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "keycloak_permission_grants_user_id_idx" ON "keycloak_permission_grants"("user_id");

-- CreateIndex
CREATE INDEX "keycloak_permission_grants_permission_idx" ON "keycloak_permission_grants"("permission");

-- CreateIndex
CREATE INDEX "keycloak_permission_grants_valid_from_idx" ON "keycloak_permission_grants"("valid_from");

-- CreateIndex
CREATE INDEX "keycloak_permission_grants_valid_until_idx" ON "keycloak_permission_grants"("valid_until");

-- CreateIndex
CREATE INDEX "keycloak_permission_grants_deleted_at_idx" ON "keycloak_permission_grants"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "keycloak_permission_grants_user_permission_active_key"
ON "keycloak_permission_grants"("user_id", "permission")
WHERE "deleted_at" IS NULL;
