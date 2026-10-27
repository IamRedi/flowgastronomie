import { defineConfig } from "vitest/config";
import { transformSync } from "esbuild";
// Next keeps JSX for SWC; the test adapter must render it for Node SSR assertions.
export default defineConfig({
  plugins: [
    {
      name: "test-next-tsx",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".tsx"))
          return transformSync(code, {
            loader: "tsx",
            jsx: "automatic",
            format: "esm",
            sourcemap: "inline",
          });
        return undefined;
      },
    },
  ],
});
