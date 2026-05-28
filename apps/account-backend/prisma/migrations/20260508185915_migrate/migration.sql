/*
  Fixed migration.

  Main fixes:
  - PostgreSQL RENAME CONSTRAINT must be its own ALTER TABLE statement.
  - Preserve existing enum column values by casting instead of DROP COLUMN / ADD COLUMN.
  - Fill nullable values before SET NOT NULL where Prisma warned it could fail.
*/

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "VerificationAction" AS ENUM ('upload', 'approved', 'rejected', 'automated_approved', 'automated_rejected');

-- CreateEnum
CREATE TYPE "AccountMergeStatus" AS ENUM ('pending', 'pending_score', 'pending_merge', 'completed', 'cancelled', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "ExternalNotificationStatus" AS ENUM ('pending', 'completed', 'failed');

-- DropForeignKey
ALTER TABLE "student_verification_logs"
  DROP CONSTRAINT "fk_student_verification_logs_document";

-- DropIndex
DROP INDEX "IDX_d28de016c84dc977d150a5596c";

-- Preflight checks for constraints Prisma is about to add
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "discord_role_settings"
    GROUP BY "role_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add unique constraint discord_role_settings(role_id): duplicate role_id values exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "user_privacy_settings"
    GROUP BY "user_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add unique constraint user_privacy_settings(user_id): duplicate user_id values exist';
  END IF;
END $$;

-- Data cleanup before NOT NULL changes
UPDATE "discord_links"
SET "deleted" = false
WHERE "deleted" IS NULL;

UPDATE "discord_role_settings"
SET "role_position" = 0
WHERE "role_position" IS NULL;

UPDATE "student_verification_logs"
SET "performedBy" = 'system'
WHERE "performedBy" IS NULL;

-- Rename constraints separately: PostgreSQL does not allow comma-chaining these
ALTER TABLE "delete_account_requests"
  RENAME CONSTRAINT "PK_2cb485a8c43ab1e9e8dc6dc8a63"
  TO "delete_account_requests_pkey";

ALTER TABLE "discord_links"
  RENAME CONSTRAINT "PK_55be1809ef7f84527b5ec444a75"
  TO "discord_links_pkey";

ALTER TABLE "discord_server_settings"
  RENAME CONSTRAINT "PK_39d187113f3f39b5a008871281e"
  TO "discord_server_settings_pkey";

ALTER TABLE "lgpd_requests"
  RENAME CONSTRAINT "PK_b85dd2e5846cb18bde7836e96e4"
  TO "lgpd_requests_pkey";

-- AlterTable: delete_account_requests
ALTER TABLE "delete_account_requests"
  ALTER COLUMN "userId" SET DATA TYPE TEXT,
  ALTER COLUMN "email" SET DATA TYPE TEXT,
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "RequestStatus" USING "status"::text::"RequestStatus",
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ALTER COLUMN "servicesNotified" TYPE TEXT[] USING
    CASE
      WHEN "servicesNotified" IS NULL THEN ARRAY[]::TEXT[]
      WHEN pg_typeof("servicesNotified")::text = 'text[]' THEN "servicesNotified"::TEXT[]
      ELSE string_to_array("servicesNotified"::text, ',')::TEXT[]
    END,
  ALTER COLUMN "servicesNotified" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "completedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable: discord_links
ALTER TABLE "discord_links"
  ALTER COLUMN "userId" SET DATA TYPE TEXT,
  ALTER COLUMN "discordId" SET DATA TYPE TEXT,
  ALTER COLUMN "discordUsername" SET DATA TYPE TEXT,
  ALTER COLUMN "discordGlobalName" SET DATA TYPE TEXT,
  ALTER COLUMN "serverInviteUsed" SET DATA TYPE TEXT,
  ALTER COLUMN "assignedRole" SET DATA TYPE TEXT,
  ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "discordAvatarHash" SET DATA TYPE TEXT,
  ALTER COLUMN "deleted" SET NOT NULL,
  ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable: discord_role_settings
ALTER TABLE "discord_role_settings"
  ALTER COLUMN "role_id" SET DATA TYPE TEXT,
  ALTER COLUMN "role_name" SET DATA TYPE TEXT,
  ALTER COLUMN "role_color" SET DATA TYPE TEXT,
  ALTER COLUMN "role_position" SET DEFAULT 0,
  ALTER COLUMN "role_position" SET NOT NULL,
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable: discord_server_settings
ALTER TABLE "discord_server_settings"
  ALTER COLUMN "settingKey" SET DATA TYPE TEXT,
  ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable: lgpd_requests
ALTER TABLE "lgpd_requests"
  ADD COLUMN "s3Key" TEXT,
  ALTER COLUMN "userId" SET DATA TYPE TEXT,
  ALTER COLUMN "email" SET DATA TYPE TEXT,
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "RequestStatus" USING "status"::text::"RequestStatus",
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ALTER COLUMN "fileName" SET DATA TYPE TEXT,
  ALTER COLUMN "filePath" SET DATA TYPE TEXT,
  ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "downloadedAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable: student_verification_documents
ALTER TABLE "student_verification_documents"
  ALTER COLUMN "userId" SET DATA TYPE TEXT,
  ALTER COLUMN "originalFileName" SET DATA TYPE TEXT,
  ALTER COLUMN "storedFileName" SET DATA TYPE TEXT,
  ALTER COLUMN "filePath" SET DATA TYPE TEXT,
  ALTER COLUMN "s3Key" SET DATA TYPE TEXT,
  ALTER COLUMN "mimeType" SET DATA TYPE TEXT,
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "VerificationStatus" USING "status"::text::"VerificationStatus",
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ALTER COLUMN "rejectionReason" SET DATA TYPE TEXT,
  ALTER COLUMN "verifiedBy" SET DATA TYPE TEXT,
  ALTER COLUMN "verificationDate" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "authenticationCode" SET DATA TYPE TEXT,
  ALTER COLUMN "extractedName" SET DATA TYPE TEXT,
  ALTER COLUMN "documentEmissionDate" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "documentExpirationDate" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "isDocumentValid" DROP NOT NULL,
  ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable: student_verification_logs
ALTER TABLE "student_verification_logs"
  ALTER COLUMN "userId" SET DATA TYPE TEXT,
  ALTER COLUMN "action" TYPE "VerificationAction" USING "action"::text::"VerificationAction",
  ALTER COLUMN "performedBy" SET DATA TYPE TEXT,
  ALTER COLUMN "performedBy" SET NOT NULL,
  ALTER COLUMN "reason" SET DATA TYPE TEXT,
  ALTER COLUMN "metadata" DROP NOT NULL,
  ALTER COLUMN "metadata" DROP DEFAULT,
  ALTER COLUMN "metadata" SET DATA TYPE JSONB,
  ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable: user_privacy_settings
ALTER TABLE "user_privacy_settings"
  ALTER COLUMN "user_id" SET DATA TYPE TEXT,
  ALTER COLUMN "settings" DROP DEFAULT,
  ALTER COLUMN "metadata" DROP NOT NULL,
  ALTER COLUMN "metadata" DROP DEFAULT,
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- Drop old TypeORM enums after columns are migrated
DROP TYPE "delete_account_requests_status_enum";
DROP TYPE "lgpd_requests_status_enum";
DROP TYPE "student_verification_documents_status_enum";
DROP TYPE "student_verification_logs_action_enum";

-- CreateTable
CREATE TABLE "account_merge_requests" (
    "id" UUID NOT NULL,
    "requester_user_id" TEXT NOT NULL,
    "candidate_user_id" TEXT NOT NULL,
    "primary_user_id" TEXT,
    "secondary_user_id" TEXT,
    "selected_primary_email" TEXT,
    "secondary_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AccountMergeStatus" NOT NULL DEFAULT 'pending',
    "score_breakdown" JSONB NOT NULL,
    "external_scores" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "account_merge_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_merge_external_notifications" (
    "id" UUID NOT NULL,
    "merge_request_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "backend_name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "audience" TEXT,
    "old_user_id" TEXT NOT NULL,
    "new_user_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ExternalNotificationStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "last_status_code" INTEGER,
    "last_response" JSONB,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "account_merge_external_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_merge_requests_requester_user_id_idx"
  ON "account_merge_requests"("requester_user_id");

CREATE INDEX "account_merge_requests_candidate_user_id_idx"
  ON "account_merge_requests"("candidate_user_id");

CREATE INDEX "account_merge_requests_primary_user_id_idx"
  ON "account_merge_requests"("primary_user_id");

CREATE INDEX "account_merge_requests_secondary_user_id_idx"
  ON "account_merge_requests"("secondary_user_id");

CREATE INDEX "account_merge_requests_status_expires_at_idx"
  ON "account_merge_requests"("status", "expires_at");

CREATE UNIQUE INDEX "account_merge_external_notifications_event_id_key"
  ON "account_merge_external_notifications"("event_id");

CREATE INDEX "account_merge_external_notifications_merge_request_id_idx"
  ON "account_merge_external_notifications"("merge_request_id");

CREATE INDEX "account_merge_external_notifications_status_next_attempt_at_idx"
  ON "account_merge_external_notifications"("status", "next_attempt_at");

CREATE INDEX "discord_links_userId_idx"
  ON "discord_links"("userId");

CREATE UNIQUE INDEX "discord_role_settings_role_id_key"
  ON "discord_role_settings"("role_id");

CREATE UNIQUE INDEX "user_privacy_settings_user_id_key"
  ON "user_privacy_settings"("user_id");

CREATE INDEX "user_privacy_settings_user_id_idx"
  ON "user_privacy_settings"("user_id");

-- AddForeignKey
ALTER TABLE "account_merge_external_notifications"
  ADD CONSTRAINT "account_merge_external_notifications_merge_request_id_fkey"
  FOREIGN KEY ("merge_request_id")
  REFERENCES "account_merge_requests"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "student_verification_logs"
  ADD CONSTRAINT "student_verification_logs_documentId_fkey"
  FOREIGN KEY ("documentId")
  REFERENCES "student_verification_documents"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "IDX_b9e2bd6ad70b68142f2fe7c810"
  RENAME TO "discord_links_discordId_key";

ALTER INDEX "UQ_9d5eb2f221e3d76346c51eae86e"
  RENAME TO "discord_server_settings_settingKey_key";