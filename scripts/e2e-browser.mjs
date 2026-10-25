/**
 * Browser test of the full demo flow.
 *
 * Drives the system Chromium through Playwright against `npm run dev`, so the
 * server actions, client components, role gating and audit trail are exercised
 * exactly as a person would exercise them.
 *
 *   npm run dev
 *   node scripts/e2e-browser.mjs [--headed]
 *
 * Screenshots land in storage/e2e/.
 */
import { mkdir } from "node:fs/promises";

import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "storage/e2e";
const HEADED = process.argv.includes("--headed");

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
};
const step = (m) => console.log(`\n${m}\n${"-".repeat(m.length)}`);

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: !HEADED,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  page.on("pageerror", (error) => fail(`client error: ${error.message}`));

  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

  try {
    /* -- officer --------------------------------------------------------- */

    step("1. Sign in as the compliance officer (demo button)");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await shot("01-login");
    await page.getByRole("button", { name: /Compliance Officer/ }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    pass("landed on the dashboard");
    await shot("02-dashboard");

    const badge = await page.locator("header").getByText("Compliance Officer").first();
    if ((await badge.isVisible())) pass("role badge shows Compliance Officer");
    else fail("role badge missing");

    /* -- upload ---------------------------------------------------------- */

    step("2. Upload the demo circular");
    await page.getByRole("link", { name: "Circulars" }).click();
    await page.waitForURL("**/circulars");
    await page
      .locator('input[type="file"]')
      .setInputFiles("samples/circulars/demo-aml-cash-threshold.pdf");
    await shot("03-upload");
    await page.getByRole("button", { name: /Upload and analyse/ }).click();

    await page.waitForURL(/\/circulars\/[0-9a-f-]{36}/, { timeout: 60_000 });
    const circularUrl = page.url();
    pass(`redirected to ${circularUrl.replace(BASE, "")}`);

    /* -- live timeline --------------------------------------------------- */

    step("3. Watch the agent timeline");
    await page.waitForSelector("text=Agent pipeline", { timeout: 30_000 });
    await shot("04-timeline-running");

    await page.waitForFunction(
      () => !document.body.innerText.includes("Refreshing every 2 seconds") &&
            !document.body.innerText.includes("refreshing every 2 seconds"),
      undefined,
      { timeout: 300_000 },
    );
    await page.waitForSelector("text=Obligations", { timeout: 120_000 });
    pass("pipeline finished and the page updated itself");
    await shot("05-circular-complete");

    const hasApplicability = await page
      .getByText("Applicability", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (hasApplicability) pass("applicability result is shown");
    else fail("applicability result missing");

    /* -- obligations ----------------------------------------------------- */

    step("4. Confirm an obligation and see its source paragraph");
    const firstObligation = page.locator("button", { hasText: /Para \d/ }).first();
    await firstObligation.click();
    await page.waitForTimeout(400);
    const marks = await page.locator("mark").count();
    if (marks > 0) pass(`source quote highlighted (${marks} mark element)`);
    else fail("clicking an obligation did not highlight its quote");
    await shot("06-obligation-highlight");

    const confirm = page.getByRole("button", { name: "Confirm" }).first();
    if (await confirm.isVisible()) {
      await confirm.click();
      await page.waitForTimeout(2500);
      pass("obligation confirmed");
    } else {
      fail("no Confirm button for the officer");
    }
    await shot("07-obligation-confirmed");

    /* -- draft ----------------------------------------------------------- */

    step("5. Open the draft and submit it for approval");
    const reviewLink = page.getByRole("link", { name: "Review" }).first();
    if (!(await reviewLink.isVisible())) {
      fail("no draft produced for this circular");
      throw new Error("stop");
    }
    await reviewLink.click();
    await page.waitForURL(/\/drafts\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const draftUrl = page.url();
    pass(`opened ${draftUrl.replace(BASE, "")}`);

    await page.waitForSelector("text=What changes", { timeout: 20_000 });
    for (const marker of ["Backtest", "Impact", "Independent review"]) {
      if ((await page.getByText(marker, { exact: false }).first().isVisible())) pass(`${marker} section rendered`);
      else fail(`${marker} section missing`);
    }
    const chart = await page.locator("svg.recharts-surface").count();
    if (chart > 0) pass("backtest bar chart rendered");
    else fail("bar chart missing");
    await shot("08-draft-review");

    await page.getByRole("button", { name: /Submit for approval/ }).click();
    await page.waitForTimeout(3000);
    const submitted = await page.getByText("submitted", { exact: false }).first().isVisible();
    if (submitted) pass("draft is now submitted");
    else fail("draft did not move to submitted");
    await shot("09-draft-submitted");

    step("6. The officer must not be able to approve their own draft");
    const approveVisible = await page
      .getByRole("button", { name: "Approve" })
      .isVisible()
      .catch(() => false);
    if (approveVisible) fail("an Approve button was offered to the submitter");
    else pass("no Approve button for the officer");

    /* -- head ------------------------------------------------------------ */

    step("7. Sign in as the head of compliance and approve");
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.waitForURL("**/login", { timeout: 30_000 });
    await page.getByRole("button", { name: /Head of Compliance/ }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    pass("signed in as head");

    await page.getByRole("link", { name: "Approvals" }).click();
    await page.waitForURL("**/approvals");
    await page.waitForSelector("text=R-101", { timeout: 20_000 });
    pass("the submitted draft appears in the approvals inbox");
    await shot("10-approvals-inbox");

    await page.getByRole("link", { name: "Open" }).first().click();
    await page.waitForURL(/\/drafts\//, { timeout: 30_000 });
    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForSelector("text=A comment is required", { timeout: 10_000 });
    await shot("11-approve-dialog");

    // A short comment must be refused by the server's Zod schema.
    await page.locator("textarea").fill("no");
    await page.getByRole("button", { name: /Confirm approval/ }).click();
    await page.waitForTimeout(1500);
    const refused = await page
      .getByText("at least 10 characters", { exact: false })
      .isVisible()
      .catch(() => false);
    if (refused) pass("a two-character comment is refused");
    else fail("the short comment was not refused");

    await page.locator("textarea").fill(
      "Threshold matches paragraph 3 and the alert volume is manageable.",
    );
    await page.getByRole("button", { name: /Confirm approval/ }).click();
    await page.waitForTimeout(4000);
    pass("approval submitted");
    await shot("12-approved");

    /* -- audit ----------------------------------------------------------- */

    step("8. Check the audit trail and the trace view");
    await page.goto(`${BASE}/audit`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Append-only", { timeout: 30_000 });
    const auditText = await page.locator("main").last().innerText();
    for (const action of [
      "circular.uploaded",
      "rule_version.submitted",
      "rule_version.approved",
    ]) {
      if (auditText.includes(action)) pass(`audit trail shows ${action}`);
      else fail(`audit trail is missing ${action}`);
    }
    await shot("13-audit");

    await page.goto(`${BASE}/rules`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Trace" }).first().click();
    await page.waitForURL(/\/audit\/trace\//, { timeout: 30_000 });
    // These routes are partially prerendered: the shell arrives first and the
    // dynamic content streams in after, so wait for real content before
    // reading the page text.
    await page.waitForSelector("text=/Trace ·/", { timeout: 30_000 });
    await page.waitForSelector("text=Paragraph and quote", { timeout: 30_000 });
    // `innerText` returns rendered text, and the step labels are styled
    // uppercase, so compare case-insensitively.
    const traceText = (await page.locator("main").last().innerText()).toLowerCase();
    for (const label of [
      "Circular",
      "Paragraph and quote",
      "Obligation",
      "Rule version",
      "Backtest",
      "Challenger",
      "Approval",
    ]) {
      if (traceText.includes(label.toLowerCase())) pass(`trace step: ${label}`);
      else fail(`trace step missing: ${label}`);
    }
    await shot("14-trace");

    /* -- ops role -------------------------------------------------------- */

    step("9. Ops is view-only and cannot reach approvals or the audit trail");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    if (page.url().includes("/login")) {
      await page.getByRole("button", { name: /Operations/ }).click();
    } else {
      await page.getByRole("button", { name: "Sign out" }).first().click();
      await page.waitForURL("**/login");
      await page.getByRole("button", { name: /Operations/ }).click();
    }
    await page.waitForURL("**/dashboard", { timeout: 30_000 });

    await page.waitForSelector('[data-slot="sidebar"]', { timeout: 30_000 });
    const navText = await page
      .locator('[data-slot="sidebar"]')
      .first()
      .innerText();
    if (!navText.includes("Approvals") && !navText.includes("Audit trail")) pass("ops does not see Approvals or Audit trail in the sidebar");
    else fail("ops can see restricted navigation");

    await page.goto(`${BASE}/audit`);
    await page.waitForURL(/dashboard/, { timeout: 20_000 });
    pass("ops is redirected away from /audit");
    await shot("15-ops-denied");

    /* -- dark mode ------------------------------------------------------- */

    step("10. Dark mode");
    await page.getByRole("button", { name: "Change theme" }).first().click();
    await page.getByRole("menuitem", { name: "Dark" }).click();
    await page.waitForTimeout(600);
    const dark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    if (dark) pass("dark mode applied");
    else fail("dark mode did not apply");
    await shot("16-dark-mode");
  } finally {
    await browser.close();
  }

  console.log(
    failures === 0
      ? "\nAll browser checks passed."
      : `\n${failures} browser check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nbrowser flow failed:");
  console.error(error);
  process.exit(1);
});
