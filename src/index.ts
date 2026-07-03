import { format } from "date-fns";
import { runOnce } from "./run-job";

interface CliArgs {
  date: string;
  dryRun: boolean;
  fillOnly: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let date = format(new Date(), "yyyy-MM-dd");
  let dryRun = false;
  let fillOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--date" && args[i + 1]) {
      date = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--fill-only") {
      fillOnly = true;
    }
  }

  return { date, dryRun, fillOnly };
}

async function main(): Promise<void> {
  const { date, dryRun, fillOnly } = parseArgs();
  await runOnce({ date, dryRun, fillOnly });
}

main().catch((err) => {
  console.error("AutoDayReport failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
