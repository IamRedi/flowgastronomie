# Subscription lifecycle behavior

RestaurantFlow keeps feature entitlement state server-owned. A disabled,
expired, cancelled or past-due subscription never deletes venue data.

| State                                       | Protected API/module behavior                                                  | Public behavior                                                               | Historical data                              |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------- |
| `ACTIVE`                                    | Enabled entitlements are available.                                            | Published public surfaces remain available when their entitlement is enabled. | Read/write under normal role rules.          |
| `TRIALING` before expiry                    | Same as `ACTIVE`.                                                              | Same as `ACTIVE`.                                                             | Read/write under normal role rules.          |
| Expired `TRIALING`, `PAST_DUE`, `CANCELLED` | Protected feature reads/writes return `403 SUBSCRIPTION_UPGRADE_REQUIRED`.     | Public routes do not expose disabled website/menu/order modules.              | Preserved; no destructive downgrade.         |
| Enabled subscription, disabled module       | The affected protected API/module returns `403 SUBSCRIPTION_UPGRADE_REQUIRED`. | The affected public module is unavailable without revealing tenant data.      | Preserved and available again if re-enabled. |

The API verifies entitlement and subscription state at the persistence boundary;
the web app may hide unavailable navigation but is never the authorization
authority. Scheduled retention remains an operational safety job: it may redact
expired personal data according to [RETENTION.md](RETENTION.md), independent of
plan downgrade, while preserving immutable operational totals and audit actor
attribution.
