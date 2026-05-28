DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'lgpd_requests'
      AND column_name = 's3Key'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'lgpd_requests'
      AND column_name = 's3_key'
  ) THEN
    ALTER TABLE "lgpd_requests" RENAME COLUMN "s3Key" TO "s3_key";
  END IF;
END $$;

ALTER TABLE "lgpd_requests"
  ADD COLUMN IF NOT EXISTS "s3_key" TEXT;
