-- Materialize every new Commercial V1 module for existing subscriptions.
-- Restaurant Pro receives them; lower plans retain explicit disabled rows so a
-- later upgrade/downgrade never needs to infer missing capability state.
INSERT INTO "Entitlement" (
  "id", "tenantId", "subscriptionId", "featureKey", "enabled", "createdAt", "updatedAt"
)
SELECT
  'ent_v1_' || md5(random()::text || clock_timestamp()::text || feature."featureKey"),
  subscription."tenantId",
  subscription."id",
  feature."featureKey",
  subscription."plan" = 'RESTAURANT_PRO',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Subscription" subscription
CROSS JOIN (VALUES
  ('RESERVATIONS'),
  ('RECIPE_COSTING'),
  ('CUSTOMER_TIMELINE'),
  ('OPERATIONAL_RETENTION')
) AS feature("featureKey")
ON CONFLICT ("subscriptionId", "featureKey") DO NOTHING;
