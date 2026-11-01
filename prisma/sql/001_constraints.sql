-- Constraints Prisma cannot express in schema.prisma.
-- STATUS: written, not verified against a live PostgreSQL instance.
--
-- HOW TO APPLY (once, for the initial migration):
--   npx prisma migrate dev --name init --create-only
--   cat prisma/sql/001_constraints.sql >> prisma/migrations/<timestamp>_init/migration.sql
--   npx prisma migrate dev
--
-- Table and column names match schema.prisma (@@map table names, camelCase columns).

-- ---------------------------------------------------------------------------
-- Money sanity checks (amounts are integer paise)
-- ---------------------------------------------------------------------------
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_amount_positive" CHECK ("amountPaise" > 0);

ALTER TABLE "financing_applications"
  ADD CONSTRAINT "financing_applications_amounts_valid"
  CHECK ("requestedAmountPaise" > 0 AND "downPaymentPaise" >= 0);

ALTER TABLE "financing_offers"
  ADD CONSTRAINT "financing_offers_terms_valid"
  CHECK ("principalPaise" > 0 AND "emiPaise" > 0 AND "tenureMonths" > 0);

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_positive" CHECK ("amountPaise" > 0);

ALTER TABLE "commission_entries"
  ADD CONSTRAINT "commission_entries_amount_positive" CHECK ("amountPaise" > 0);

ALTER TABLE "disbursement_statuses"
  ADD CONSTRAINT "disbursement_statuses_amount_positive"
  CHECK ("amountPaise" IS NULL OR "amountPaise" > 0);

ALTER TABLE "financing_offers"
  ADD CONSTRAINT "financing_offers_fees_valid"
  CHECK (
    ("downPaymentPaise" IS NULL OR "downPaymentPaise" >= 0) AND
    ("processingFeePaise" IS NULL OR "processingFeePaise" >= 0) AND
    ("taxesPaise" IS NULL OR "taxesPaise" >= 0) AND
    ("otherChargesPaise" IS NULL OR "otherChargesPaise" >= 0) AND
    ("totalRepayablePaise" IS NULL OR "totalRepayablePaise" >= "principalPaise")
  );

ALTER TABLE "lender_configurations"
  ADD CONSTRAINT "lender_configurations_amount_range_valid"
  CHECK ("minAmountPaise" IS NULL OR "maxAmountPaise" IS NULL OR "minAmountPaise" <= "maxAmountPaise");

-- ---------------------------------------------------------------------------
-- Commission entry unique constraints: one accrual per transaction, unique reversal
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "commission_entries_one_accrual_per_transaction"
  ON "commission_entries" ("transactionId")
  WHERE "entryType" = 'ACCRUAL';

CREATE UNIQUE INDEX "commission_entries_unique_reversal"
  ON "commission_entries" ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL AND "entryType" = 'REVERSAL';

-- ---------------------------------------------------------------------------
-- At most one active (non-terminal) application per purchase
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "financing_applications_one_active_per_purchase"
  ON "financing_applications" ("purchaseId")
  WHERE "status" NOT IN ('DECLINED', 'DISBURSED', 'CANCELLED', 'EXPIRED');

-- ---------------------------------------------------------------------------
-- Append-only tables: block UPDATE and DELETE at the database level.
-- (TRUNCATE is not blocked, so test suites can reset data.)
-- Retention purges of audit data must use a separate, explicitly privileged procedure.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION udhyam_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "application_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "application_status_history"
  FOR EACH ROW EXECUTE FUNCTION udhyam_forbid_mutation();

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION udhyam_forbid_mutation();

CREATE TRIGGER "commission_entries_append_only"
  BEFORE UPDATE OR DELETE ON "commission_entries"
  FOR EACH ROW EXECUTE FUNCTION udhyam_forbid_mutation();

CREATE TRIGGER "disbursement_statuses_append_only"
  BEFORE UPDATE OR DELETE ON "disbursement_statuses"
  FOR EACH ROW EXECUTE FUNCTION udhyam_forbid_mutation();
