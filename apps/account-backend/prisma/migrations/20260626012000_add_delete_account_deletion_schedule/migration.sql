ALTER TABLE "delete_account_requests"
  ADD COLUMN IF NOT EXISTS "softDeletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduledHardDeleteAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "delete_account_requests_status_scheduledHardDeleteAt_idx"
  ON "delete_account_requests"("status", "scheduledHardDeleteAt");
