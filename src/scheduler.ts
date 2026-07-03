import { format, subDays } from "date-fns";
import * as cron from "node-cron";
import { loadConfig, ScheduleConfig } from "./config";
import { initJobLogger, jobLog } from "./job-logger";
import { runOnce } from "./run-job";

function parseRunTime(runTime: string): { hour: number; minute: number } {
  const match = runTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid schedule.runTime "${runTime}". Expected 24h format like "18:00".`);
  }

  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid schedule.runTime "${runTime}". Hour must be 0-23, minute 0-59.`);
  }

  return { hour, minute };
}

export function runTimeToCron(runTime: string): string {
  const { hour, minute } = parseRunTime(runTime);
  return `${minute} ${hour} * * *`;
}

export function resolveReportDate(reportDate: ScheduleConfig["reportDate"]): string {
  const now = new Date();
  if (reportDate === "yesterday") {
    return format(subDays(now, 1), "yyyy-MM-dd");
  }
  if (reportDate === "today") {
    return format(now, "yyyy-MM-dd");
  }
  throw new Error(`Invalid schedule.reportDate "${reportDate}". Expected "today" or "yesterday".`);
}

function getNextRunDescription(runTime: string, timezone: string): string {
  const { hour, minute } = parseRunTime(runTime);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return `${format(next, "yyyy-MM-dd HH:mm")} (${timezone})`;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const schedule = config.schedule;

  if (!schedule) {
    throw new Error(
      "schedule section missing in config.json. Copy the schedule block from config/config.example.json."
    );
  }

  const timezone = schedule.timezone ?? "Asia/Shanghai";
  initJobLogger({ timezone });

  if (!schedule.enabled) {
    jobLog("schedule.enabled is false — scheduler exiting.");
    return;
  }

  if (!schedule.runTime) {
    throw new Error("schedule.runTime is required when schedule.enabled is true.");
  }

  if (schedule.reportDate !== "today" && schedule.reportDate !== "yesterday") {
    throw new Error(`Invalid schedule.reportDate "${schedule.reportDate}". Expected "today" or "yesterday".`);
  }
  const cronExpr = runTimeToCron(schedule.runTime);

  jobLog(`AutoDayReport scheduler started.`);
  jobLog(`  runTime: ${schedule.runTime} (cron: ${cronExpr})`);
  jobLog(`  timezone: ${timezone}`);
  jobLog(`  reportDate: ${schedule.reportDate}`);
  jobLog(`  next run (approx): ${getNextRunDescription(schedule.runTime, timezone)}`);

  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression derived from runTime: ${cronExpr}`);
  }

  cron.schedule(
    cronExpr,
    async () => {
      const date = resolveReportDate(schedule.reportDate);
      jobLog(`Scheduled run triggered. reportDate=${schedule.reportDate} → date=${date}`);
      try {
        await runOnce({ date, dryRun: false, fillOnly: false });
        jobLog(`Scheduled run completed for ${date}.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        jobLog(`Scheduled run failed: ${msg}`);
        if (err instanceof Error && err.stack) {
          jobLog(err.stack);
        }
      }
    },
    { timezone }
  );

  jobLog("Scheduler is running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  jobLog(`Scheduler fatal error: ${msg}`);
  process.exit(1);
});
