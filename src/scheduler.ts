import { format, subDays } from "date-fns";
import * as cron from "node-cron";
import * as fs from "fs";
import * as path from "path";
import { loadConfig, ScheduleConfig } from "./config";
import { runOnce } from "./run-job";

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "scheduler.log");

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

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
  ensureLogDir();

  const config = loadConfig();
  const schedule = config.schedule;

  if (!schedule) {
    throw new Error(
      "schedule section missing in config.json. Copy the schedule block from config/config.example.json."
    );
  }

  if (!schedule.enabled) {
    log("schedule.enabled is false — scheduler exiting.");
    return;
  }

  if (!schedule.runTime) {
    throw new Error("schedule.runTime is required when schedule.enabled is true.");
  }

  if (schedule.reportDate !== "today" && schedule.reportDate !== "yesterday") {
    throw new Error(`Invalid schedule.reportDate "${schedule.reportDate}". Expected "today" or "yesterday".`);
  }

  const timezone = schedule.timezone ?? "Asia/Shanghai";
  const cronExpr = runTimeToCron(schedule.runTime);

  log(`AutoDayReport scheduler started.`);
  log(`  runTime: ${schedule.runTime} (cron: ${cronExpr})`);
  log(`  timezone: ${timezone}`);
  log(`  reportDate: ${schedule.reportDate}`);
  log(`  next run (approx): ${getNextRunDescription(schedule.runTime, timezone)}`);

  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression derived from runTime: ${cronExpr}`);
  }

  cron.schedule(
    cronExpr,
    async () => {
      const date = resolveReportDate(schedule.reportDate);
      log(`Scheduled run triggered. reportDate=${schedule.reportDate} → date=${date}`);
      try {
        await runOnce({ date, dryRun: false, fillOnly: false });
        log(`Scheduled run completed for ${date}.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Scheduled run failed: ${msg}`);
      }
    },
    { timezone }
  );

  log("Scheduler is running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  log(`Scheduler fatal error: ${msg}`);
  process.exit(1);
});
