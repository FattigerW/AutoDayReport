import { format, getDate, getMonth, getYear, parseISO } from "date-fns";
import * as fs from "fs";
import * as path from "path";
import { Frame, Page } from "puppeteer";
import { GeneratedReport } from "../llm";
import { formatReportContent } from "../report-formatter";
import { PuppeteerConfig, ReportConfig } from "../config";
import { jobLog } from "../job-logger";

type PageContext = Page | Frame;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFillDebugDir(): string {
  const dir = path.join(__dirname, "..", "..", "reports", "fill-debug");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function saveDebugScreenshot(page: Page, name: string): Promise<string> {
  const timestamp = format(new Date(), "yyyyMMdd-HHmmss");
  const filename = `${name}-${timestamp}.png`;
  const filepath = path.join(getFillDebugDir(), filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.warn(`Debug screenshot saved: ${filepath}`);
  return filepath;
}

async function hasCalendarTable(ctx: PageContext): Promise<boolean> {
  return ctx.evaluate(() => {
    const table = document.querySelector("table");
    if (!table) return false;
    return /\d+\s*日/.test(table.textContent ?? "");
  });
}

/**
 * SPA shell loads on main page; calendar lives in an iframe/micro-app.
 * Poll main frame + all iframes until the month calendar table appears.
 */
async function waitForCalendarContext(
  page: Page,
  timeoutMs = 45000
): Promise<PageContext> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await hasCalendarTable(page)) {
      return page;
    }

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        if (await hasCalendarTable(frame)) {
          console.log(`Calendar table found in iframe: ${frame.url() || "(embedded)"}`);
          return frame;
        }
      } catch {
        // Frame may be detached while loading
      }
    }

    await sleep(500);
  }

  throw new Error(
    "Calendar table not found. Page may still be on 首页 — navigation to 填报工时 did not load."
  );
}

async function navigateViaSidebar(page: Page): Promise<void> {
  console.log("Navigating via sidebar: 个人界面 → 填报工时");

  const opened = await page.evaluate(() => {
    const menuTitles = Array.from(
      document.querySelectorAll(".el-sub-menu__title, .el-menu-item, span")
    );
    const personal = menuTitles.find((el) =>
      (el.textContent ?? "").includes("个人界面")
    );
    if (!personal) return false;
    (personal as HTMLElement).click();
    return true;
  });

  if (!opened) {
    console.warn("Could not find sidebar menu 个人界面");
  }

  await sleep(800);

  const clicked = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll(".el-menu-item, .el-sub-menu .el-menu-item, a, span")
    );
    const report = items.find((el) => (el.textContent ?? "").trim() === "填报工时");
    if (!report) return false;
    (report as HTMLElement).click();
    return true;
  });

  if (!clicked) {
    throw new Error('Could not find sidebar menu item "填报工时"');
  }

  await sleep(1500);
}

/**
 * After login, avoid full page.goto reload (resets SPA to blank 首页).
 * Prefer hash routing + sidebar click, then wait for iframe calendar.
 */
async function navigateToReportPage(page: Page, pageUrl: string): Promise<PageContext> {
  const hashMatch = pageUrl.match(/#(.*)$/);
  const hash = hashMatch ? hashMatch[1] : "/psrsonPanel/reportWorkingHours";

  console.log(`Navigating to report page (hash: #${hash})`);

  // Client-side route change — keeps login session, avoids blank home reload
  await page.evaluate((targetHash) => {
    const normalized = targetHash.startsWith("/") ? targetHash : `/${targetHash}`;
    if (window.location.hash.replace(/^#/, "") !== normalized.replace(/^\//, "")) {
      window.location.hash = normalized;
    }
  }, hash);

  await sleep(2000);

  if (!(await hasCalendarTable(page))) {
    for (const frame of page.frames()) {
      if (frame !== page.mainFrame() && (await hasCalendarTable(frame))) {
        return frame;
      }
    }
  }

  // Hash alone often leaves shell on 首页 with empty iframe — use sidebar
  if (!(await hasCalendarTable(page))) {
    await navigateViaSidebar(page);
  }

  return waitForCalendarContext(page);
}

export async function selectDialogDropdown(
  ctx: PageContext,
  labelText: string,
  optionText: string
): Promise<void> {
  const clicked = await ctx.evaluate((label) => {
    const dialog = document.querySelector(".el-dialog");
    if (!dialog) return false;

    const labels = Array.from(dialog.querySelectorAll("label, .el-form-item__label"));
    const labelEl = labels.find((el) => el.textContent?.includes(label));
    if (!labelEl) return false;

    const formItem = labelEl.closest(".el-form-item");
    const wrapper = formItem?.querySelector(".el-input__wrapper") as HTMLElement | null;
    if (!wrapper) return false;

    wrapper.click();
    return true;
  }, labelText);

  if (!clicked) {
    throw new Error(`Could not find dropdown for label "${labelText}" in dialog`);
  }

  await sleep(500);

  const optionClicked = await ctx.evaluate((option) => {
    const items = Array.from(document.querySelectorAll(".el-select-dropdown__item"));
    const item = items.find((el) => (el.textContent?.trim() ?? "").includes(option));
    if (!item) return false;
    (item as HTMLElement).click();
    return true;
  }, optionText);

  if (!optionClicked) {
    throw new Error(`Could not find dropdown option matching: ${optionText}`);
  }

  await sleep(300);
}

async function fillDialogInput(
  ctx: PageContext,
  labelText: string,
  value: string
): Promise<void> {
  const filled = await ctx.evaluate((label, val) => {
    const dialog = document.querySelector(".el-dialog");
    if (!dialog) return false;

    const labels = Array.from(dialog.querySelectorAll("label, .el-form-item__label"));
    const labelEl = labels.find((el) => el.textContent?.includes(label));
    if (!labelEl) return false;

    const formItem = labelEl.closest(".el-form-item");
    const input = formItem?.querySelector(
      "input, textarea"
    ) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!input) return false;

    input.focus();
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, labelText, value);

  if (!filled) {
    throw new Error(`Could not find input for label "${labelText}" in dialog`);
  }

  await sleep(200);
}

async function clickDialogButton(ctx: PageContext, textMatch: string): Promise<boolean> {
  return ctx.evaluate((match) => {
    const dialog = document.querySelector(".el-dialog");
    if (!dialog) return false;

    const buttons = Array.from(dialog.querySelectorAll("button, .el-button"));
    const btn = buttons.find((b) => b.textContent?.includes(match));
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  }, textMatch);
}

async function clickPageButton(page: Page, textMatch: string): Promise<boolean> {
  return page.evaluate((match) => {
    const buttons = Array.from(document.querySelectorAll("button, .el-button"));
    const btn = buttons.find((b) => {
      if (b.closest(".el-dialog")) return false;
      return b.textContent?.includes(match);
    });
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  }, textMatch);
}

async function parseCalendarHeader(
  ctx: PageContext
): Promise<{ year: number; month: number } | null> {
  return ctx.evaluate(() => {
    const monthPattern = /(\d{4})\s*年\s*(\d{1,2})\s*月/;
    const table = document.querySelector("table");
    const scope = table?.closest("div")?.parentElement ?? document.body;

    const candidates = Array.from(scope.querySelectorAll("*"));
    for (const el of candidates) {
      const text = el.textContent?.trim() ?? "";
      if (text.length > 20) continue;
      const match = text.match(monthPattern);
      if (match) {
        return { year: parseInt(match[1], 10), month: parseInt(match[2], 10) };
      }
    }
    return null;
  });
}

async function navigateCalendarMonth(ctx: PageContext, forward: boolean): Promise<boolean> {
  return ctx.evaluate((goForward) => {
    const table = document.querySelector("table");
    const scope = table?.closest("div") ?? document;

    const buttons = Array.from(
      scope.querySelectorAll("button, .el-button, [class*='prev'], [class*='next']")
    );

    const navBtn = buttons.find((b) => {
      const cls = b.className?.toString() ?? "";
      const text = b.textContent?.trim() ?? "";
      if (goForward) {
        return cls.includes("next") || text === ">" || text === "›" || text === "»";
      }
      return cls.includes("prev") || text === "<" || text === "‹" || text === "«";
    });

    if (navBtn) {
      (navBtn as HTMLElement).click();
      return true;
    }

    const icons = Array.from(scope.querySelectorAll("i[class*='arrow'], svg"));
    if (icons.length >= 2) {
      const icon = goForward ? icons[icons.length - 1] : icons[0];
      (icon as HTMLElement).click();
      return true;
    }

    return false;
  }, forward);
}

async function clickCalendarDayCell(ctx: PageContext, dayLabel: string): Promise<boolean> {
  const handle = await (ctx as Page).evaluateHandle((targetLabel) => {
    const matches = Array.from(document.querySelectorAll("table td *")).filter(
      (el) => el.textContent?.trim() === targetLabel
    );
    if (matches.length === 0) return null;

    return matches.sort(
      (a, b) => b.querySelectorAll("*").length - a.querySelectorAll("*").length
    )[0];
  }, dayLabel);

  const element = handle.asElement() as import("puppeteer").ElementHandle<Element> | null;
  if (!element) {
    await handle.dispose();
    return false;
  }

  await element.click();
  await handle.dispose();
  return true;
}

async function waitForReportDialog(ctx: PageContext, timeoutMs: number): Promise<void> {
  await ctx.waitForFunction(
    () => {
      const dialogs = Array.from(
        document.querySelectorAll(".el-dialog, [role='dialog']")
      );
      return dialogs.some((d) => {
        const style = window.getComputedStyle(d);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return d.textContent?.includes("填写报工");
      });
    },
    { timeout: timeoutMs }
  );
}

async function selectCalendarDate(ctx: PageContext, targetDate: string): Promise<void> {
  const date = parseISO(targetDate);
  const year = getYear(date);
  const month = getMonth(date) + 1;
  const day = getDate(date);
  const dayLabel = `${day} 日`;

  console.log(`Selecting date: ${format(date, "yyyy-MM-dd")}`);

  if (!(await hasCalendarTable(ctx))) {
    throw new Error("Calendar table not available before date selection");
  }

  const maxNavAttempts = 24;
  for (let i = 0; i < maxNavAttempts; i++) {
    const header = await parseCalendarHeader(ctx);
    if (!header) {
      throw new Error("Could not parse calendar month header (expected e.g. 2026 年 7 月)");
    }

    if (header.year === year && header.month === month) {
      break;
    }

    const goForward = header.year < year || (header.year === year && header.month < month);
    const navigated = await navigateCalendarMonth(ctx, goForward);
    if (!navigated) {
      throw new Error(`Could not navigate calendar to ${year} 年 ${month} 月`);
    }

    await sleep(400);

    if (i === maxNavAttempts - 1) {
      throw new Error(`Calendar navigation timed out for ${year} 年 ${month} 月`);
    }
  }

  const daySelected = await clickCalendarDayCell(ctx, dayLabel);
  if (!daySelected) {
    throw new Error(`Could not click calendar day cell "${dayLabel}"`);
  }

  try {
    await waitForReportDialog(ctx, 5000);
  } catch {
    console.log(`Dialog not open after first click on "${dayLabel}", retrying...`);
    await clickCalendarDayCell(ctx, dayLabel);
    await waitForReportDialog(ctx, 10000);
  }

  const dialogTitle = await ctx.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll(".el-dialog, [role='dialog']"));
    const dialog = dialogs.find((d) => d.textContent?.includes("填写报工"));
    return (
      dialog?.querySelector(".el-dialog__title")?.textContent?.trim() ??
      dialog?.textContent?.slice(0, 20)?.trim() ??
      ""
    );
  });

  if (!dialogTitle.includes("填写报工")) {
    throw new Error(`Expected dialog titled "填写报工", got "${dialogTitle}"`);
  }
}

async function isDialogContentFilled(ctx: PageContext): Promise<boolean> {
  return ctx.evaluate(() => {
    const dialog = document.querySelector(".el-dialog");
    if (!dialog) return false;

    const labels = Array.from(dialog.querySelectorAll("label, .el-form-item__label"));
    const contentLabel = labels.find((el) => el.textContent?.includes("内容"));
    if (!contentLabel) return false;

    const formItem = contentLabel.closest(".el-form-item");
    const input = formItem?.querySelector("textarea, input") as
      | HTMLTextAreaElement
      | HTMLInputElement
      | null;
    return !!input?.value?.trim();
  });
}

/**
 * Navigates to the report page, fills the form, and optionally submits.
 */
export async function fillReport(
  page: Page,
  reportConfig: ReportConfig,
  generatedReport: GeneratedReport,
  targetDate: string,
  puppeteerConfig: PuppeteerConfig
): Promise<void> {
  page.setDefaultTimeout(puppeteerConfig.defaultTimeout);

  try {
    const reportCtx = await navigateToReportPage(page, reportConfig.pageUrl);
    await selectCalendarDate(reportCtx, targetDate);

    const alreadyFilled = await isDialogContentFilled(reportCtx);
    if (alreadyFilled && !reportConfig.overwriteExisting) {
      jobLog(
        "当天报工已存在，跳过填写（overwriteExisting=false）。新生成的日报未写入系统。可加 --overwrite 或设置 report.overwriteExisting=true 覆盖。"
      );
      return;
    }

    if (alreadyFilled && reportConfig.overwriteExisting) {
      jobLog("Report already filled. Overwriting per config.");
    }

    const content = formatReportContent(generatedReport);

    await selectDialogDropdown(reportCtx, "项目1", reportConfig.project1);
    await selectDialogDropdown(reportCtx, "项目2", reportConfig.project2);
    await selectDialogDropdown(reportCtx, "产品线类别", reportConfig.productLine);

    await fillDialogInput(reportCtx, "工作地点", reportConfig.workLocation);
    await fillDialogInput(reportCtx, "内容", content);

    console.log('Clicking dialog confirm (确 定)...');
    const confirmClicked = await clickDialogButton(reportCtx, "确");
    if (!confirmClicked) {
      throw new Error('Could not find dialog confirm button matching "确"');
    }

    await sleep(1000);

    if (reportConfig.submitAfterFill) {
      console.log("Clicking page submit (提交)...");
      const submitClicked = await clickPageButton(page, "提交");
      if (!submitClicked) {
        jobLog('Could not find "提交" button. Report may need manual submission.');
      } else {
        jobLog("Report submitted.");
      }
    }

    console.log("Report fill completed.");
  } catch (err) {
    await saveDebugScreenshot(page, "fill-error").catch(() => {});
    throw err;
  }
}
