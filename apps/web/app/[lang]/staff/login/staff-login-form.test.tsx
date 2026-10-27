import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { StaffLoginForm } from "./staff-login-form";
import type { Dictionary } from "../../../../lib/dictionaries";
it("never submits credentials as a GET before hydration", () => {
  const html = renderToStaticMarkup(
    createElement(StaffLoginForm, {
      locale: "en",
      labels: {} as Dictionary["staff"],
    }),
  );
  expect(html).toMatch(/<form[^>]*method="post"/);
  expect(html).toMatch(/<button[^>]*disabled=""/);
});
