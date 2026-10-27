import { prisma } from "@flowgastronomie/database";
import { continuitySchema, renewLabTests } from "./test-entitlements.js";
try {
  if (process.argv[2] === "init") await continuitySchema(process.argv[3]!);
  else if (process.argv[2] === "enable")
    console.log(JSON.stringify(await renewLabTests(process.argv[3])));
  else if (process.argv[2] === "renew")
    console.log(JSON.stringify(await renewLabTests()));
  else throw new Error("Unknown continuity command");
} finally {
  await prisma.$disconnect();
}
