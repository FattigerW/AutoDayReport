import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";
import { fillReport } from "./browser/fill-report";
import { login } from "./browser/login";
import { getReportsDir, loadConfig } from "./config";
import { collectCommits } from "./git-collector";
import { initJobLogger, jobLog, jobLogLines } from "./job-logger";
import { GeneratedReport, generateReport } from "./llm";
import { ensureNetwork } from "./network";

export interface RunOnceOptions {
  date: string;
  dryRun?: boolean;
  fillOnly?: boolean;
  /** 手动运行时强制覆盖当天已填内容 */
  overwrite?: boolean;
}

function loadSavedReport(date: string, departmentName: string): GeneratedReport | null {
  const reportPath = path.join(getReportsDir(), `${date}.txt`);
  if (!fs.existsSync(reportPath)) {
    return null;
  }

  const rawText = fs.readFileSync(reportPath, "utf-8").trim();
  if (!rawText) {
    return null;
  }

  return {
    departmentName,
    date,
    todayWork: ["1. （来自已保存报告）"],
    tomorrowPlan: ["1. 继续推进项目开发工作"],
    rawText,
  };
}

function buildPlaceholderReport(date: string, departmentName: string): GeneratedReport {
  const rawText = [
    `部门名称：${departmentName} 日期:${date} 今日工作内容:`,
    "1. 日常开发与维护工作",
    "次日工作计划：",
    "1. 继续推进项目开发工作",
  ].join("\n");

  return {
    departmentName,
    date,
    todayWork: ["1. 日常开发与维护工作"],
    tomorrowPlan: ["1. 继续推进项目开发工作"],
    rawText,
  };
}

export async function runOnce(options: RunOnceOptions): Promise<void> {
  const { date, dryRun = false, fillOnly = false, overwrite = false } = options;
  const modeLabel = dryRun ? " (dry-run)" : fillOnly ? " (fill-only)" : "";

  const config = loadConfig();
  initJobLogger({ timezone: config.schedule?.timezone ?? "Asia/Shanghai" });

  jobLog(`Run started for date=${date}${modeLabel}`);

  jobLog("Checking network connectivity...");
  await ensureNetwork(config.network);
  jobLog("Network is ready.");

  let report: GeneratedReport;

  if (fillOnly) {
    report =
      loadSavedReport(date, config.report.departmentName) ??
      buildPlaceholderReport(date, config.report.departmentName);
    jobLog("Fill-only mode: skipped Git collection and LLM generation.");
  } else {
    const commits = await collectCommits(config.git, date);
    report = await generateReport(
      config.qwen,
      config.report,
      commits,
      date,
      config.git.repoDisplayNames
    );
  }

  jobLog("Generated report:");
  jobLogLines(report.rawText.split("\n"), "  | ");

  if (dryRun) {
    jobLog("Dry-run mode: skipped browser automation.");
    return;
  }

  jobLog("Launching browser...");
  const browser = await puppeteer.launch({
    headless: config.puppeteer.headless,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    jobLog("Logging in...");
    await login(page, config.login, config.puppeteer);
    jobLog("Login successful. Filling report...");
    const reportConfig = {
      ...config.report,
      overwriteExisting: overwrite || config.report.overwriteExisting,
    };
    if (overwrite) {
      jobLog("Overwrite mode enabled — will replace existing report content if present.");
    }
    await fillReport(page, reportConfig, report, date, config.puppeteer);
    jobLog("Report fill completed.");
  } finally {
    await browser.close();
    jobLog("Browser closed.");
  }

  jobLog(`Run completed successfully for ${date}.`);
}
