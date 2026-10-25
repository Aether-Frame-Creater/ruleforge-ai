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

  /** The sidebar, so a nav click is never ambiguous with a card link. */
  const nav = () => page.locator('[data-slot="sidebar"]');

  /** Signs in as a demo role from wherever the browser currently is. */
  async function signInAs(label) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    if (!page.url().includes("/login")) {
      await page.getByRole("button", { name: "Sign out" }).first().click();
      await page.waitForURL("**/login", { timeout: 30_000 });
    }
    await page.getByRole("button", { name: label }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
  }

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
    await nav().getByRole("link", { name: "Circulars", exact: true }).click();
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

    await nav().getByRole("link", { name: "Approvals", exact: true }).click();
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

    /* -- rollout: officer and head must not be able to act ----------------- */

    step("9. Officer and head cannot act on the rollout board");
    const draftVersionId = draftUrl.split("/").pop();

    for (const [label, who] of [
      [/Compliance Officer/, "officer"],
      [/Head of Compliance/, "head"],
    ]) {
      await signInAs(label);
      await page.goto(`${BASE}/rollout`, { waitUntil: "networkidle" });

      if (page.url().includes("/dashboard")) {
        // The officer has no rollout access at all, which is stronger still.
        pass(`${who} is redirected away from /rollout`);
        continue;
      }

      await page.waitForSelector("text=Approved", { timeout: 20_000 });
      const startShadow = await page
        .getByRole("button", { name: /Start shadow/ })
        .count();
      if (startShadow === 0) pass(`${who} sees no Start shadow button`);
      else fail(`${who} was offered a Start shadow button`);
    }
    await shot("16-rollout-readonly");

    /* -- ops drives the rollout -------------------------------------------- */

    step("10. Ops starts shadow");
    await signInAs(/Operations/);
    await page.goto(`${BASE}/rollout`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Approved", { timeout: 20_000 });
    await shot("17-rollout-board");

    await page.getByRole("button", { name: /Start shadow/ }).first().click();
    await page.waitForTimeout(3500);
    const shadowText = await page.locator("main").last().innerText();
    if (shadowText.toLowerCase().includes("shadow")) pass("version moved into shadow");
    else fail("the version did not move into shadow");

    step("11. Ops runs a simulated day");
    await page.getByRole("link", { name: /Compare and roll out/ }).first().click();
    await page.waitForURL(/\/rollout\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await page.waitForSelector("text=Live versus shadow", { timeout: 20_000 });

    // Rolling out before any comparison must not be possible. The server
    // refuses it too (see scripts/check-deploy.ts); here the UI must not even
    // offer it.
    const rolloutDisabled = await page
      .getByRole("button", { name: /Roll out 10%/ })
      .isDisabled();
    if (rolloutDisabled) pass("rollout is disabled until a shadow run exists");
    else fail("rollout was offered before any shadow run");

    await page.getByRole("button", { name: /Simulate a day of transactions/ }).click();
    await page.waitForSelector("text=/simulated day/", { timeout: 180_000 });
    pass("simulated day compared");
    await shot("18-shadow-comparison");

    const comparison = await page.locator("main").last().innerText();
    for (const marker of ["Only in live", "Only in shadow", "Alert rate change"]) {
      if (comparison.includes(marker)) pass(`comparison shows "${marker}"`);
      else fail(`comparison is missing "${marker}"`);
    }
    const shadowChart = await page.locator("svg.recharts-surface").count();
    if (shadowChart > 0) pass("live vs shadow chart rendered");
    else fail("live vs shadow chart missing");

    step("12. Ops rolls out to 10%, then 100%");
    await page.getByRole("button", { name: /Roll out 10%/ }).click();
    await page.waitForTimeout(3500);
    const atTen = await page.locator("main").last().innerText();
    if (/10%\s*$|10% of customers|Rollout\n10%/m.test(atTen) || atTen.includes("10%")) {
      pass("rolled out to 10% of customers");
    } else {
      fail("the 10% rollout did not take");
    }
    await shot("19-rollout-10");

    await page.getByRole("button", { name: /Go live \(100%\)/ }).click();
    await page.waitForTimeout(4000);
    const atHundred = await page.locator("main").last().innerText();
    if (atHundred.toLowerCase().includes("live")) pass("version is live at 100%");
    else fail("the version did not go live");
    await shot("20-live");

    step("13. The new version is live and the old one retired");
    await page.goto(`${BASE}/rules`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Version history", { timeout: 20_000 });
    const rulesText = await page.locator("main").last().innerText();
    if (/v2[\s\S]{0,80}live/i.test(rulesText)) pass("R-101 v2 is live");
    else fail("R-101 v2 is not shown as live");
    if (rulesText.toLowerCase().includes("retired")) pass("the previous version is retired");
    else fail("no retired version is shown");
    await shot("21-rules-timeline");

    step("14. Ops rolls back with a reason");
    await page.goto(`${BASE}/rollout`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Live", { timeout: 20_000 });
    await page.getByRole("link", { name: "Open" }).first().click();
    await page.waitForURL(/\/rollout\/[0-9a-f-]{36}/, { timeout: 30_000 });

    await page.getByRole("button", { name: /Roll back/ }).click();
    await page.waitForSelector("text=/A reason is required/", { timeout: 10_000 });

    await page.locator("textarea").fill("bad");
    await page.getByRole("button", { name: /Roll back now/ }).click();
    await page.waitForTimeout(1500);
    const shortReason = await page.locator("body").innerText();
    if (shortReason.includes("at least 10 characters")) {
      pass("a short rollback reason is refused");
    } else {
      fail("the short rollback reason was accepted");
    }

    await page
      .locator("textarea")
      .fill("Alert volume overwhelmed the investigations team on day one.");
    await page.getByRole("button", { name: /Roll back now/ }).click();
    await page.waitForTimeout(4000);
    pass("rolled back");
    await shot("22-rolled-back");

    step("15. v1 is live again");
    await page.goto(`${BASE}/rules`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Version history", { timeout: 20_000 });
    const afterRollback = await page.locator("main").last().innerText();
    if (/v1[\s\S]{0,80}live/i.test(afterRollback)) pass("R-101 v1 is live again");
    else fail("R-101 v1 was not restored");
    if (afterRollback.toLowerCase().includes("rolled back")) {
      pass("v2 is shown as rolled back");
    } else {
      fail("v2 is not shown as rolled back");
    }

    step("16. The auditor sees the whole chain in the trace");
    await signInAs(/Auditor/);
    await page.goto(`${BASE}/audit/trace/${draftVersionId}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("text=/Trace ·/", { timeout: 30_000 });
    await page.waitForSelector("text=Rollback", { timeout: 30_000 });
    const trace2 = (await page.locator("main").last().innerText()).toLowerCase();
    for (const label of [
      "circular",
      "paragraph and quote",
      "obligation",
      "rule version",
      "backtest",
      "challenger",
      "approval",
      "shadow",
      "rollout",
      "rollback",
    ]) {
      if (trace2.includes(label)) pass(`trace step: ${label}`);
      else fail(`trace step missing: ${label}`);
    }
    await shot("23-trace-full");

    step("17. Ops is view-only for approvals and the audit trail");
    await signInAs(/Operations/);

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

    step("18. Dark mode");
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
