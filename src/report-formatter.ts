import { CommitInfo } from "./git-collector";
import { GeneratedReport } from "./llm";

export function formatReportPrompt(
  departmentName: string,
  formattedDate: string,
  commits: CommitInfo[]
): string {
  const commitLines =
    commits.length > 0
      ? commits
          .map(
            (c) =>
              `- [${c.repo}] ${c.message} (author: ${c.author}, hash: ${c.hash})`
          )
          .join("\n")
      : "（今日无 Git 提交记录，请根据一般开发工作生成合理内容）";

  return `请根据以下 Git 提交记录，生成工作日报。

部门名称：${departmentName}
日期：${formattedDate}

Git 提交记录：
${commitLines}

请严格按以下格式输出（不要添加其他说明）：

部门名称：${departmentName} 日期:${formattedDate} 今日工作内容:
1. ...
2. ...
次日工作计划：
1. ...
2. ...

要求：
- 今日工作内容基于提交记录归纳总结，每条简洁明了
- 次日工作计划合理推断后续工作
- 使用中文，专业简洁`;
}

export function parseReportResponse(
  response: string,
  departmentName: string,
  formattedDate: string
): GeneratedReport {
  const todayWork: string[] = [];
  const tomorrowPlan: string[] = [];

  const todayMatch = response.match(
    /今日工作内容:\s*([\s\S]*?)(?=次日工作计划：|$)/i
  );
  const tomorrowMatch = response.match(/次日工作计划：\s*([\s\S]*?)$/i);

  if (todayMatch?.[1]) {
    const lines = todayMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d+\./.test(l));
    todayWork.push(...lines);
  }

  if (tomorrowMatch?.[1]) {
    const lines = tomorrowMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d+\./.test(l));
    tomorrowPlan.push(...lines);
  }

  if (todayWork.length === 0) {
    todayWork.push("1. 日常开发与维护工作");
  }
  if (tomorrowPlan.length === 0) {
    tomorrowPlan.push("1. 继续推进项目开发工作");
  }

  return {
    departmentName,
    date: formattedDate,
    todayWork,
    tomorrowPlan,
    rawText: response.trim(),
  };
}

export function formatReportContent(report: GeneratedReport): string {
  return [
    `部门名称：${report.departmentName} 日期:${report.date} 今日工作内容:`,
    ...report.todayWork,
    "次日工作计划：",
    ...report.tomorrowPlan,
  ].join("\n");
}
