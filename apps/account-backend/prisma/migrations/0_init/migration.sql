-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "delete_account_requests_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "lgpd_requests_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "student_verification_documents_status_enum" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "student_verification_logs_action_enum" AS ENUM ('upload', 'approved', 'rejected', 'automated_approved', 'automated_rejected');

-- CreateTable
CREATE TABLE "delete_account_requests" (
    "id" UUID NOT NULL,
    "userId" VARCHAR NOT NULL,
    "email" VARCHAR NOT NULL,
    "status" "delete_account_requests_status_enum" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "servicesNotified" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(6),

    CONSTRAINT "PK_2cb485a8c43ab1e9e8dc6dc8a63" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_links" (
    "id" UUID NOT NULL,
    "userId" VARCHAR NOT NULL,
    "discordId" VARCHAR NOT NULL,
    "discordUsername" VARCHAR NOT NULL,
    "discordGlobalName" VARCHAR NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "serverInviteUsed" VARCHAR,
    "assignedRole" VARCHAR,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discordAvatarHash" VARCHAR,
    "deleted" BOOLEAN DEFAULT false,
    "deletedAt" TIMESTAMP(6),

    CONSTRAINT "PK_55be1809ef7f84527b5ec444a75" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_role_settings" (
    "id" UUID NOT NULL,
    "role_id" VARCHAR NOT NULL,
    "role_name" VARCHAR NOT NULL,
    "is_enabled_for_selection" BOOLEAN NOT NULL DEFAULT false,
    "is_blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "has_permissions" BOOLEAN NOT NULL DEFAULT false,
    "role_color" VARCHAR,
    "role_position" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discord_role_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_server_settings" (
    "id" UUID NOT NULL,
    "settingKey" VARCHAR NOT NULL,
    "settingValue" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_39d187113f3f39b5a008871281e" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lgpd_requests" (
    "id" UUID NOT NULL,
    "userId" VARCHAR NOT NULL,
    "email" VARCHAR NOT NULL,
    "status" "lgpd_requests_status_enum" NOT NULL DEFAULT 'pending',
    "fileName" VARCHAR,
    "filePath" VARCHAR,
    "fileSize" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadedAt" TIMESTAMP(6),
    "expiresAt" TIMESTAMP(6),

    CONSTRAINT "PK_b85dd2e5846cb18bde7836e96e4" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_verification_documents" (
    "id" UUID NOT NULL,
    "userId" VARCHAR NOT NULL,
    "originalFileName" VARCHAR NOT NULL,
    "storedFileName" VARCHAR NOT NULL,
    "filePath" VARCHAR NOT NULL,
    "s3Key" VARCHAR,
    "mimeType" VARCHAR NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "student_verification_documents_status_enum" NOT NULL,
    "rejectionReason" VARCHAR,
    "verifiedBy" VARCHAR,
    "verificationDate" TIMESTAMP(6),
    "authenticationCode" VARCHAR,
    "extractedName" VARCHAR,
    "documentEmissionDate" TIMESTAMP(6),
    "documentExpirationDate" TIMESTAMP(6),
    "isDocumentValid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_verification_logs" (
    "id" UUID NOT NULL,
    "userId" VARCHAR NOT NULL,
    "documentId" UUID NOT NULL,
    "action" "student_verification_logs_action_enum" NOT NULL,
    "performedBy" VARCHAR,
    "reason" VARCHAR,
    "metadata" JSON NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_privacy_settings" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_privacy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IDX_d28de016c84dc977d150a5596c" ON "discord_links"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_b9e2bd6ad70b68142f2fe7c810" ON "discord_links"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_9d5eb2f221e3d76346c51eae86e" ON "discord_server_settings"("settingKey");

-- AddForeignKey
ALTER TABLE "student_verification_logs" ADD CONSTRAINT "fk_student_verification_logs_document" FOREIGN KEY ("documentId") REFERENCES "student_verification_documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

