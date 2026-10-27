import { test, expect } from "./browser-fixture";
import { passwordRecoveryCopy } from "../../apps/web/lib/password-recovery-copy";

test("anonymous recovery uses the existing email service, fragment-only proof and revokes the previous session", async ({
  page,
}) => {
  const api = "http://localhost:4302";
  const c = passwordRecoveryCopy("en");
  const login = await page.request.post(`${api}/v1/auth/login`, {
    data: {
      email: "recovery-en@import-v2.example",
      password: "import-v2-acceptance-password",
    },
  });
  expect(login.ok()).toBe(true);
  await page.goto("/en/staff/password-reset");
  await page
    .getByLabel(c.email, { exact: true })
    .fill("recovery-en@import-v2.example");
  await page.getByRole("button", { name: c.request, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(c.sent);
  const email = await (
    await page.request.get(`${api}/fixture/recovery-email`)
  ).json();
  expect(email.recipient).toBe("recovery-en@import-v2.example");
  const navigated: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest()) navigated.push(r.url());
  });
  await page.goto(`/en/staff/password-reset#${email.resetToken}`);
  await expect(page.getByRole("heading", { name: c.reset })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(navigated.join(" ")).not.toContain(email.resetToken);
  await page
    .getByLabel(c.password, { exact: true })
    .fill("replacement-browser-password");
  await page
    .getByLabel(c.confirm, { exact: true })
    .fill("replacement-browser-password");
  await page.getByRole("button", { name: c.save, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(c.done);
  expect((await page.request.get(`${api}/v1/staff/me`)).status()).toBe(401);
  expect(
    (
      await page.request.post(`${api}/v1/auth/password-reset/complete`, {
        data: {
          token: email.resetToken,
          newPassword: "another-browser-password",
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post(`${api}/v1/auth/login`, {
        data: {
          email: email.recipient,
          password: "replacement-browser-password",
        },
      })
    ).ok(),
  ).toBe(true);
});

for (const locale of ["sq", "de", "en", "it"] as const)
  test(`recovery and legal entry are accessible without staff login in ${locale}`, async ({
    page,
  }) => {
    const c = passwordRecoveryCopy(locale);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/${locale}/staff/login`);
    await page.getByRole("link", { name: c.forgot, exact: true }).click();
    await expect(page.getByRole("heading", { name: c.title })).toBeVisible();
    await expect(page.getByLabel(c.email, { exact: true })).toBeVisible();
    await page.goto(`/${locale}/signup`);
    await page.getByRole("link", { name: "Impressum", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Impressum", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
