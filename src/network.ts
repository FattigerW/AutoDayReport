import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import { NetworkConfig } from "./config";

const HTTP_CHECK_TIMEOUT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkUrlReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    return response.ok || response.status < 500;
  } catch {
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      return response.ok || response.status < 500;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function launchSecoClient(secoclientPath: string): void {
  const isMacApp = os.platform() === "darwin" && secoclientPath.endsWith(".app");

  if (!isMacApp && !fs.existsSync(secoclientPath)) {
    throw new Error(`SecoClient not found at: ${secoclientPath}`);
  }

  console.log(`Launching SecoClient: ${secoclientPath}`);

  if (isMacApp) {
    spawn("open", ["-a", secoclientPath], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  spawn(secoclientPath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  }).unref();
}

/**
 * Ensures network connectivity to the internal system.
 * Checks the configured URL; if unreachable, launches SecoClient VPN (when path configured)
 * and polls until connected or timeout.
 */
export async function ensureNetwork(config: NetworkConfig): Promise<void> {
  const { checkUrl, secoclientPath, connectTimeoutMs, pollIntervalMs } =
    config;

  console.log(`Checking network connectivity to ${checkUrl}...`);

  if (await checkUrlReachable(checkUrl)) {
    console.log("Network is reachable.");
    return;
  }

  const trimmedPath = secoclientPath?.trim() ?? "";

  if (!trimmedPath) {
    console.log("Network unreachable and secoclientPath is empty — polling only (no VPN auto-launch).");
  } else {
    console.log("Network unreachable. Starting VPN client...");
    launchSecoClient(trimmedPath);
  }

  const deadline = Date.now() + connectTimeoutMs;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    if (await checkUrlReachable(checkUrl)) {
      console.log("Network connected.");
      return;
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    console.log(`Waiting for network... (${remaining}s remaining)`);
  }

  throw new Error(
    `Network still unreachable after ${connectTimeoutMs / 1000}s. Please connect VPN manually.`
  );
}
