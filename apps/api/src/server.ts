import { buildApp } from "./app.js";
import { createTransactionalNotificationServiceFromEnvironment } from "./brevo-transactional-notifications.js";
import { trustedProxyFromEnvironment } from "./guest-rate-limit.js";
import { readinessTimeoutFromEnvironment } from "./readiness.js";

const port = Number(process.env.API_PORT ?? 4000);
const app = buildApp(
  {
    transactionalNotificationService:
      createTransactionalNotificationServiceFromEnvironment(),
  },
  {
    trustProxy: trustedProxyFromEnvironment(),
    readinessTimeoutMs: readinessTimeoutFromEnvironment(),
  },
);

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
