import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("smoke", () => {
  test("homepage renders hero + nav", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Invoicing for freelancers",
    );
    await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
  });

  test("health endpoint reports status without leaking secrets", async ({
    request,
  }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("env");
    expect(body).toHaveProperty("supabase");
    // never expose keys in the payload
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/eyJ/); // JWT-shaped values (Supabase keys)
    expect(raw).not.toContain("REPLACE_ME");
  });

  test("/app redirects anonymous users to /login", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    // redirect preserves where the user wanted to go
    await expect(page).toHaveURL(/next=%2Fapp/);
  });

  test("login page form is accessible (axe: no serious/critical)", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blockers = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blockers.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("unknown route shows 404 page", async ({ page }) => {
    const res = await page.goto("/definitely-not-a-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByText("404")).toBeVisible();
  });
});
