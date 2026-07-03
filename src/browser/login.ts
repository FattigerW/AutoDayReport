import * as path from "path";
import { Page } from "puppeteer";
import { getReportsDir, LoginConfig, PuppeteerConfig } from "../config";
import { findCaptchaImage, recognizeCaptcha } from "./captcha";

const DEFAULT_SELECTORS = {
  username:
    'input[type="text"], input[placeholder*="用户"], input[placeholder*="账号"], input[name="username"], #username',
  password:
    'input[type="password"], input[placeholder*="密码"], input[name="password"], #password',
  submit: 'button[type="submit"], .el-button--primary, button.login-btn, .login-button',
  successIndicator:
    '.sidebar, .el-menu, .main-container, [class*="sidebar"], [class*="nav"]',
  captchaInput: 'input[placeholder*="验证码"]',
};

const DEFAULT_CAPTCHA_MAX_RETRIES = 5;
const LOGIN_CHECK_TIMEOUT_MS = 5000;

async function isLoginSuccess(
  page: Page,
  successIndicator: string,
  initialUrl: string,
  timeout: number
): Promise<boolean> {
  try {
    await Promise.race([
      page.waitForSelector(successIndicator, { timeout }),
      page.waitForFunction(
        (startUrl: string) => window.location.href !== startUrl,
        { timeout },
        initialUrl
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function clearAndType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, text, { delay: 50 });
}

/**
 * Performs login on the target system using Puppeteer.
 * Supports captcha OCR with automatic retry on failure.
 */
export async function login(
  page: Page,
  config: LoginConfig,
  puppeteerConfig: PuppeteerConfig
): Promise<void> {
  const selectors = {
    ...DEFAULT_SELECTORS,
    ...config.selectors,
  };
  const captchaMaxRetries = config.captchaMaxRetries ?? DEFAULT_CAPTCHA_MAX_RETRIES;
  const captchaDebug = config.captchaDebug ?? false;
  const debugDir = captchaDebug
    ? path.join(getReportsDir(), "captcha-debug")
    : undefined;

  page.setDefaultTimeout(puppeteerConfig.defaultTimeout);

  console.log(`Navigating to login page: ${config.url}`);
  await page.goto(config.url, { waitUntil: "networkidle2" });

  const initialUrl = page.url();

  await page.waitForSelector(selectors.username);
  await page.type(selectors.username, config.username, { delay: 50 });

  await page.waitForSelector(selectors.password);
  await page.type(selectors.password, config.password, { delay: 50 });

  const captchaInput = await page.$(selectors.captchaInput);

  if (!captchaInput) {
    await page.click(selectors.submit);
    console.log("Waiting for login success...");

    if (
      !(await isLoginSuccess(
        page,
        selectors.successIndicator,
        initialUrl,
        puppeteerConfig.defaultTimeout
      ))
    ) {
      throw new Error(
        "Login failed: could not detect successful login (sidebar/URL change)."
      );
    }
    console.log("Login successful.");
    return;
  }

  console.log("Captcha detected, attempting OCR login...");
  let imageSelector = await findCaptchaImage(
    page,
    selectors.captchaInput,
    selectors.captchaImage
  );

  for (let attempt = 1; attempt <= captchaMaxRetries; attempt++) {
    console.log(`Captcha attempt ${attempt}/${captchaMaxRetries}...`);

    const captchaText = await recognizeCaptcha(
      page,
      imageSelector,
      debugDir,
      {
        mode: config.captchaOcrMode ?? "default",
        engine: (config.captchaOcrEngine as "ddddocr" | "python" | "auto") ?? "auto",
      }
    );
    if (!captchaText || captchaText.length !== 4) {
      console.warn(
        `OCR returned invalid text (${captchaText || "empty"}), refreshing captcha...`
      );
      if (attempt < captchaMaxRetries) {
        await page.click(imageSelector);
        await new Promise((resolve) => setTimeout(resolve, 500));
        imageSelector = await findCaptchaImage(
          page,
          selectors.captchaInput,
          selectors.captchaImage
        );
      }
      continue;
    }

    console.log(`OCR result: ${captchaText}`);
    await clearAndType(page, selectors.captchaInput, captchaText);

    await page.click(selectors.submit);

    if (
      await isLoginSuccess(
        page,
        selectors.successIndicator,
        initialUrl,
        LOGIN_CHECK_TIMEOUT_MS
      )
    ) {
      // Wait until SPA shell is ready (avoid navigating while still on login route)
      await page
        .waitForFunction(
          () =>
            !window.location.hash.includes("login") &&
            !window.location.pathname.includes("login"),
          { timeout: puppeteerConfig.defaultTimeout }
        )
        .catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log("Login successful.");
      return;
    }

    if (attempt < captchaMaxRetries) {
      console.log("Login not successful, refreshing captcha...");
      await page.click(imageSelector);
      await new Promise((resolve) => setTimeout(resolve, 500));
      imageSelector = await findCaptchaImage(
        page,
        selectors.captchaInput,
        selectors.captchaImage
      );
    }
  }

  throw new Error(
    `Login failed after ${captchaMaxRetries} captcha attempts. ` +
      "Check credentials, captcha selectors, or enable captchaDebug for OCR artifacts."
  );
}
