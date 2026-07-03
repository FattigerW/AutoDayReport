import { CommitInfo } from "./git-collector";
import { GeneratedReport } from "./llm";

const DEFAULT_REPO_DISPLAY_NAMES: Record<string, string> = {
  "avatar5.0_asset_management_service": "资产管理服务",
  "avatar5.0_dataassets_service": "数据资产服务",
};

export function resolveRepoDisplayName(
  repo: string,
  customNames?: Record<string, string>
): string {
  return customNames?.[repo] ?? DEFAULT_REPO_DISPLAY_NAMES[repo] ?? repo;
}

export function formatReportPrompt(
  departmentName: string,
  formattedDate: string,
  commits: CommitInfo[],
  repoDisplayNames?: Record<string, string>
): string {
  const commitLines =
    commits.length > 0
      ? commits
          .map((c) => {
            const displayName = resolveRepoDisplayName(c.repo, repoDisplayNames);
            return `- 【${displayName}】${c.message} (hash: ${c.hash})`;
          })
          .join("\n")
      : "（今日无 Git 提交记录，请根据一般开发工作生成合理内容）";

  return `请根据以下 Git 提交记录，生成工作日报。

部门名称：${departmentName}
日期：${formattedDate}

Git 提交记录（【】内为项目中文名，输出时必须原样使用，不得缩写或改写）：
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
- 每条工作项开头使用【项目中文名】标注所属项目，名称必须与提交记录中完全一致
- 不同仓库的工作分开列出，不要将多条提交粗暴合并成一条
- 尽量覆盖所有提交记录中的关键工作点，不要遗漏
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
