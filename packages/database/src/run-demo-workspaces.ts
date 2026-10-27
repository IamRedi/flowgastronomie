import { bootstrapDemo, demoProfiles } from "./demo-workspaces.js";
import { prisma } from "./client.js";
try {
  const command = process.argv[2];
  const profile = process.argv[3] as (typeof demoProfiles)[number];
  if (
    !["bootstrap", "reset"].includes(command ?? "") ||
    !demoProfiles.includes(profile) ||
    process.argv.length !== 4
  )
    throw new Error(
      `Usage: demo-workspaces bootstrap|reset ${demoProfiles.join("|")}`,
    );
  const password = process.env.FOUNDATION_OWNER_PASSWORD;
  if (!password || password.length < 12)
    throw new Error(
      "Set FOUNDATION_OWNER_PASSWORD (12+ characters) in the server environment.",
    );
  console.log(
    JSON.stringify(await bootstrapDemo(profile, password, command === "reset")),
  );
} finally {
  await prisma.$disconnect();
}
