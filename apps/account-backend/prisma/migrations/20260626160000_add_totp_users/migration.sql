-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "keycloak_id" TEXT NOT NULL,
    "primary_email" TEXT NOT NULL,
    "primary_email_normalized" TEXT NOT NULL,
    "display_name" TEXT,
    "totp_secret_encrypted" TEXT,
    "totp_secret_iv" TEXT,
    "totp_secret_auth_tag" TEXT,
    "totp_secret_created_at" TIMESTAMP(3),
    "totp_secret_rotated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_keycloak_id_key" ON "users"("keycloak_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_primary_email_normalized_key" ON "users"("primary_email_normalized");

-- CreateIndex
CREATE INDEX "users_primary_email_normalized_idx" ON "users"("primary_email_normalized");
