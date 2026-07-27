ALTER TABLE "account_merge_external_notifications"
ADD COLUMN "delivery_claim" TEXT,
ADD COLUMN "claim_expires_at" TIMESTAMP(3);

CREATE INDEX "account_merge_external_notifications_status_claim_expires_at_idx"
ON "account_merge_external_notifications"("status", "claim_expires_at");
