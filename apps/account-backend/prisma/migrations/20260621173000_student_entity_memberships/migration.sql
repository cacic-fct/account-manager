-- CreateTable
CREATE TABLE "student_entity_memberships" (
    "id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "keycloak_group_path" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_email" TEXT,
    "user_display_name" TEXT,
    "mandate_start" TIMESTAMP(3) NOT NULL,
    "mandate_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_sync_error" TEXT,

    CONSTRAINT "student_entity_memberships_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "keycloak_permission_grants"
ADD COLUMN "student_entity_membership_id" UUID;

-- CreateIndex
CREATE INDEX "student_entity_memberships_entity_idx" ON "student_entity_memberships"("entity");

-- CreateIndex
CREATE INDEX "student_entity_memberships_user_id_idx" ON "student_entity_memberships"("user_id");

-- CreateIndex
CREATE INDEX "student_entity_memberships_mandate_start_idx" ON "student_entity_memberships"("mandate_start");

-- CreateIndex
CREATE INDEX "student_entity_memberships_mandate_end_idx" ON "student_entity_memberships"("mandate_end");

-- CreateIndex
CREATE INDEX "student_entity_memberships_deleted_at_idx" ON "student_entity_memberships"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_entity_memberships_user_entity_active_key"
ON "student_entity_memberships"("user_id", "entity")
WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "keycloak_permission_grants_student_entity_membership_id_idx"
ON "keycloak_permission_grants"("student_entity_membership_id");

-- AddForeignKey
ALTER TABLE "keycloak_permission_grants"
ADD CONSTRAINT "keycloak_permission_grants_student_entity_membership_id_fkey"
FOREIGN KEY ("student_entity_membership_id") REFERENCES "student_entity_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
