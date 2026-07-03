import * as fs from "fs";
import * as path from "path";
import { format } from "date-fns";
import { getReportsDir, QwenConfig, ReportConfig } from "./config";
import { CommitInfo } from "./git-collector";
import { formatReportPrompt, parseReportResponse } from "./report-formatter";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export interface GeneratedReport {
  departmentName: string;
  date: string;
  todayWork: string[];
  tomorrowPlan: string[];
  rawText: string;
}

async function callQwenApi(
  config: QwenConfig,
  prompt: string
): Promise<string> {
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "你是一个专业的工作日报助手。根据提供的 Git 提交记录，生成简洁、专业的工作日报。严格按照指定格式输出，使用中文。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Qwen API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Qwen API returned empty response");
  }

  return content;
}

function saveRawCommits(commits: CommitInfo[], targetDate: string): string {
  const reportsDir = getReportsDir();
  const filePath = path.join(reportsDir, `${targetDate}.txt`);

  const lines = commits.map(
    (c) => `[${c.repo}] ${c.hash} - ${c.message} (${c.author}, ${c.date})`
  );

  const content =
    lines.length > 0
      ? lines.join("\n")
      : "No commits found for this date.";

  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`Saved raw commits to ${filePath}`);
  return filePath;
}

function buildFallbackReport(
  reportConfig: ReportConfig,
  targetDate: string,
  commits: CommitInfo[]
): GeneratedReport {
  const formattedDate = format(new Date(targetDate), "yyyy/MM/dd");
  const todayWork =
    commits.length > 0
      ? commits.map((c, i) => `${i + 1}. [${c.repo}] ${c.message}`)
      : ["1. 日常开发与维护工作"];

  return {
    departmentName: reportConfig.departmentName,
    date: formattedDate,
    todayWork,
    tomorrowPlan: ["1. 继续推进项目开发工作"],
    rawText: [
      `部门名称：${reportConfig.departmentName} 日期:${formattedDate} 今日工作内容:`,
      ...todayWork,
      "次日工作计划：",
      "1. 继续推进项目开发工作",
    ].join("\n"),
  };
}

/**
 * Generates a daily report using Qwen LLM based on collected commits.
 * Retries up to 2 times on failure; falls back to raw commit list.
 */
export async function generateReport(
  qwenConfig: QwenConfig,
  reportConfig: ReportConfig,
  commits: CommitInfo[],
  targetDate: string
): Promise<GeneratedReport> {
  const formattedDate = format(new Date(targetDate), "yyyy/MM/dd");
  const prompt = formatReportPrompt(
    reportConfig.departmentName,
    formattedDate,
    commits
  );

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retrying LLM generation (attempt ${attempt + 1})...`);
      } else {
        console.log("Generating report with Qwen LLM...");
      }

      const response = await callQwenApi(qwenConfig, prompt);
      const parsed = parseReportResponse(response, reportConfig.departmentName, formattedDate);

      console.log("Report generated successfully.");
      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`LLM generation failed: ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  console.warn("LLM generation failed after retries. Saving raw commits and using fallback.");
  saveRawCommits(commits, targetDate);
  return buildFallbackReport(reportConfig, targetDate, commits);
}
