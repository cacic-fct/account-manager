-- CreateTable
CREATE TABLE "discord_managed_role_overrides" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" TEXT NOT NULL,
    "user_email" TEXT,
    "user_display_name" TEXT,
    "role_category" TEXT NOT NULL,
    "data" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "discord_managed_role_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_managed_role_overrides_user_id_key" ON "discord_managed_role_overrides"("user_id");

-- CreateIndex
CREATE INDEX "discord_managed_role_overrides_role_category_idx" ON "discord_managed_role_overrides"("role_category");
