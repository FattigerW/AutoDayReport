import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { GitConfig } from "./config";
import { jobLog } from "./job-logger";

const execFileAsync = promisify(execFile);

export interface CommitInfo {
  repo: string;
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

function findGitRepos(
  dir: string,
  maxDepth: number,
  currentDepth = 0
): string[] {
  if (currentDepth > maxDepth) {
    return [];
  }

  const repos: string[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const gitDir = path.join(dir, ".git");
  if (fs.existsSync(gitDir)) {
    repos.push(dir);
    return repos;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    repos.push(
      ...findGitRepos(path.join(dir, entry.name), maxDepth, currentDepth + 1)
    );
  }

  return repos;
}

async function getCommitsForDate(
  repoPath: string,
  targetDate: string,
  authorFilter: string
): Promise<GitLogEntry[]> {
  const since = `${targetDate} 00:00:00`;
  const until = `${targetDate} 23:59:59`;

  const args = [
    "log",
    `--since=${since}`,
    `--until=${until}`,
    "--pretty=format:%H|%an|%ai|%s",
    "--no-merges",
  ];

  if (authorFilter) {
    args.push(`--author=${authorFilter}`);
  }

  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!stdout.trim()) {
      return [];
    }

    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, author, date, ...messageParts] = line.split("|");
        return {
          hash: hash ?? "",
          author: author ?? "",
          date: date ?? "",
          message: messageParts.join("|"),
        };
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    jobLog(`  [git] failed to read log in ${path.basename(repoPath)}: ${msg}`);
    return [];
  }
}

/**
 * Recursively scans scanRoot for git repositories and collects commits for the target date.
 */
export async function collectCommits(
  config: GitConfig,
  targetDate: string
): Promise<CommitInfo[]> {
  const { scanRoot, maxDepth, author } = config;

  if (!fs.existsSync(scanRoot)) {
    jobLog(`Git scan root does not exist: ${scanRoot}`);
    return [];
  }

  jobLog(`Git scan: root=${scanRoot}, maxDepth=${maxDepth}, author=${author || "(all)"}`);
  const repos = findGitRepos(scanRoot, maxDepth);
  jobLog(`Git scan: found ${repos.length} repositories.`);

  const allCommits: CommitInfo[] = [];
  const repoSummary: string[] = [];

  for (const repoPath of repos) {
    const commits = await getCommitsForDate(repoPath, targetDate, author);
    const repoName = path.basename(repoPath);

    for (const commit of commits) {
      allCommits.push({
        repo: repoName,
        hash: commit.hash.slice(0, 8),
        message: commit.message,
        author: commit.author,
        date: commit.date,
      });
    }

    repoSummary.push(`${repoName}: ${commits.length}`);
    for (const commit of commits) {
      jobLog(`  [commit] [${repoName}] ${commit.hash.slice(0, 8)} ${commit.message}`);
    }
  }

  jobLog(`Git scan: total ${allCommits.length} commit(s) for ${targetDate}.`);
  jobLog(`Git scan by repo: ${repoSummary.join(", ") || "(none)"}`);
  return allCommits;
}
