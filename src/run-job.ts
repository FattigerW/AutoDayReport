import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";
import { fillReport } from "./browser/fill-report";
import { login } from "./browser/login";
import { getReportsDir, loadConfig } from "./config";
import { collectCommits } from "./git-collector";
import { GeneratedReport, generateReport } from "./llm";
import { ensureNetwork } from "./network";

export interface RunOnceOptions {
  date: string;
  dryRun?: boolean;
  fillOnly?: boolean;
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
  const { date, dryRun = false, fillOnly = false } = options;
  const modeLabel = dryRun ? " (dry-run)" : fillOnly ? " (fill-only)" : "";
  console.log(`AutoDayReport starting for date: ${date}${modeLabel}`);

  const config = loadConfig();

  await ensureNetwork(config.network);

  let report: GeneratedReport;

  if (fillOnly) {
    report =
      loadSavedReport(date, config.report.departmentName) ??
      buildPlaceholderReport(date, config.report.departmentName);
    console.log("Fill-only mode: skipping Git collection and LLM generation.");
  } else {
    const commits = await collectCommits(config.git, date);

    report = await generateReport(config.qwen, config.report, commits, date);
  }

  console.log("\n--- Generated Report ---");
  console.log(report.rawText);
  console.log("------------------------\n");

  if (dryRun) {
    console.log("Dry-run mode: skipping browser automation.");
    return;
  }

  const browser = await puppeteer.launch({
    headless: config.puppeteer.headless,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await login(page, config.login, config.puppeteer);
    await fillReport(page, config.report, report, date, config.puppeteer);
  } finally {
    await browser.close();
  }

  console.log("AutoDayReport completed successfully.");
}
