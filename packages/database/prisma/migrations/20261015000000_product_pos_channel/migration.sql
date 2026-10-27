-- Additive channel override. NULL preserves existing published-menu POS behavior.
ALTER TABLE "Product" ADD COLUMN "posEnabled" BOOLEAN;
