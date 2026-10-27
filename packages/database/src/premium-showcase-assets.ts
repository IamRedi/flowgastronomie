import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export function premiumShowcaseAssetsDirectory() {
  // Bundled runtimes carry assets explicitly and have no workspace source package.
  if (process.env.PREMIUM_SHOWCASE_ASSETS_DIRECTORY)
    return process.env.PREMIUM_SHOWCASE_ASSETS_DIRECTORY;
  // Native ESM and Playwright's CJS loader both resolve the development package.
  return join(
    dirname(
      createRequire(resolve(process.cwd(), "package.json")).resolve(
        "@flowgastronomie/database",
      ),
    ),
    "../assets/showcases",
  );
}
