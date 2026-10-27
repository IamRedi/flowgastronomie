-- Existing Restaurant Pro subscriptions receive the new modular capability.
INSERT INTO "Entitlement" (
  "id", "tenantId", "subscriptionId", "featureKey", "enabled", "createdAt", "updatedAt"
)
SELECT
  'ent_online_' || md5(random()::text || clock_timestamp()::text),
  "tenantId",
  "id",
  'ONLINE_ORDERING',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Subscription"
WHERE "plan" = 'RESTAURANT_PRO'
ON CONFLICT ("subscriptionId", "featureKey") DO NOTHING;
