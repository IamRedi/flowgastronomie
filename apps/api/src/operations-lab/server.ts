import { prisma } from "@flowgastronomie/database";
import { buildApp } from "../app.js";
import { HardwareService } from "../hardware-service.js";
import { disabledTransactionalNotificationService } from "../transactional-notifications.js";
import { assertLabInstance, installLabGuard, LAB_MARKER } from "./guard.js";
import { PdfSimulatorAdapter } from "./pdf-archive.js";
import { installOperator } from "./operator.js";
await assertLabInstance();
const app = buildApp(
  {
    transactionalNotificationService: disabledTransactionalNotificationService,
  },
  {
    logger: false,
    hardwareService: new HardwareService({
      simulatorEnabled: true,
      simulatorFactory: () => new PdfSimulatorAdapter(),
    }),
  },
);
installLabGuard(app);
await installOperator(app);
app.get("/lab/identity", async () => {
  await assertLabInstance();
  return { marker: LAB_MARKER };
});
// Explicit identity handshake; no state or secrets returned.
app.addHook("preHandler", async (request, reply) => {
  if (request.routeOptions.url === "/lab/identity")
    reply.header("Cache-Control", "no-store");
});
await app.listen({ host: "127.0.0.1", port: 4400 });
process.on("message", (m) => {
  if (m === "shutdown")
    void app
      .close()
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0));
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => prisma.$disconnect());
  });
