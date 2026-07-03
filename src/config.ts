import * as fs from "fs";
import * as path from "path";

export interface NetworkConfig {
  checkUrl: string;
  secoclientPath: string;
  connectTimeoutMs: number;
  pollIntervalMs: number;
}

export interface LoginConfig {
  url: string;
  username: string;
  password: string;
  captchaMaxRetries?: number;
  captchaDebug?: boolean;
  captchaOcrEngine?: "ddddocr" | "python" | "auto";
  captchaOcrMode?: "default" | "beta";
  selectors?: {
    username?: string;
    password?: string;
    submit?: string;
    successIndicator?: string;
    captchaInput?: string;
    captchaImage?: string;
  };
}

export interface ReportConfig {
  pageUrl: string;
  departmentName: string;
  project1: string;
  project2: string;
  productLine: string;
  workStatus: string;
  workTime: string;
  workLocation: string;
  overwriteExisting: boolean;
  submitAfterFill: boolean;
}

export interface GitConfig {
  scanRoot: string;
  maxDepth: number;
  author: string;
}

export interface QwenConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface PuppeteerConfig {
  headless: boolean;
  defaultTimeout: number;
}

export interface ScheduleConfig {
  enabled: boolean;
  runTime: string;
  reportDate: "today" | "yesterday";
  timezone?: string;
}

export interface AppConfig {
  network: NetworkConfig;
  login: LoginConfig;
  report: ReportConfig;
  git: GitConfig;
  qwen: QwenConfig;
  puppeteer: PuppeteerConfig;
  schedule: ScheduleConfig;
}

const CONFIG_PATH = path.join(__dirname, "..", "config", "config.json");

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config file not found at ${CONFIG_PATH}. Copy config/config.example.json to config/config.json and fill in your values.`
    );
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as AppConfig;
}

export function getReportsDir(): string {
  const dir = path.join(__dirname, "..", "reports");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
