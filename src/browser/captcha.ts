import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { Page } from "puppeteer";
import { DdddOcr, CHARSET_RANGE, MODEL_TYPE } from "ddddocr-node";

const execFileAsync = promisify(execFile);

export interface CaptchaOcrConfig {
  mode?: "default" | "beta";
  engine?: "ddddocr" | "python" | "auto";
}

const PYTHON_OCR_SCRIPT = path.join(__dirname, "..", "..", "scripts", "ocr.py");

let ocrInstance: DdddOcr | null = null;
let ocrMode: "default" | "beta" | null = null;

function getOcrInstance(mode: "default" | "beta" = "default"): DdddOcr {
  if (!ocrInstance || ocrMode !== mode) {
    ocrInstance = new DdddOcr().setRanges(CHARSET_RANGE.MIX_LOWER_UPPER_NUM_CASE);
    if (mode === "beta") {
      ocrInstance.setOcrMode(MODEL_TYPE.OCR_BETA);
    }
    ocrMode = mode;
  }
  return ocrInstance;
}

async function recognizeWithDdddocr(
  imagePath: string,
  mode: "default" | "beta"
): Promise<string> {
  const text = await getOcrInstance(mode).classification(imagePath);
  return text.replace(/[^a-zA-Z0-9]/g, "");
}

async function recognizeWithPython(imagePath: string): Promise<string> {
  const { stdout } = await execFileAsync("python", [PYTHON_OCR_SCRIPT, imagePath], {
    timeout: 30000,
  });
  return stdout.trim().replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Locates the captcha image element near the captcha input, or uses a custom selector.
 */
export async function findCaptchaImage(
  page: Page,
  inputSelector: string,
  customImageSelector?: string
): Promise<string> {
  if (customImageSelector) {
    await page.waitForSelector(customImageSelector);
    return customImageSelector;
  }

  const selector = await page.evaluate((inputSel) => {
    const input = document.querySelector(inputSel);
    if (!input) return null;

    let container = input.parentElement;
    for (let i = 0; i < 4 && container; i++) {
      const imgs = Array.from(container.querySelectorAll("img"));
      if (imgs.length === 1) {
        imgs[0].setAttribute("data-captcha-img", "true");
        return 'img[data-captcha-img="true"]';
      }
      if (imgs.length > 1) {
        const inputRect = input.getBoundingClientRect();
        let closest = null;
        let minDist = Infinity;
        for (const img of imgs) {
          const rect = img.getBoundingClientRect();
          const dist =
            Math.abs(rect.top - inputRect.top) + Math.abs(rect.left - inputRect.left);
          if (dist < minDist) {
            minDist = dist;
            closest = img;
          }
        }
        if (closest) {
          closest.setAttribute("data-captcha-img", "true");
          return 'img[data-captcha-img="true"]';
        }
      }
      container = container.parentElement;
    }

    const inputRect = input.getBoundingClientRect();
    let closest = null;
    let minDist = Infinity;
    for (const img of Array.from(document.querySelectorAll("img"))) {
      const rect = img.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 15) continue;
      const dist =
        Math.abs(rect.top - inputRect.top) + Math.abs(rect.left - inputRect.left);
      if (dist < minDist && dist < 300) {
        minDist = dist;
        closest = img;
      }
    }
    if (closest) {
      closest.setAttribute("data-captcha-img", "true");
      return 'img[data-captcha-img="true"]';
    }
    return null;
  }, inputSelector);

  if (!selector) {
    throw new Error("Could not find captcha image near input");
  }
  return selector;
}

/**
 * Screenshots the captcha image and runs OCR via ddddocr-node.
 */
export async function recognizeCaptcha(
  page: Page,
  imageSelector: string,
  debugDir?: string,
  ocrConfig?: CaptchaOcrConfig
): Promise<string> {
  const element = await page.$(imageSelector);
  if (!element) {
    throw new Error(`Captcha image not found: ${imageSelector}`);
  }

  const rawBuffer = (await element.screenshot({ type: "png" })) as Buffer;
  const mode = ocrConfig?.mode ?? "default";
  const engine = ocrConfig?.engine ?? "auto";

  const tempPath = path.join(os.tmpdir(), `captcha-${Date.now()}.png`);
  let cleaned = "";
  try {
    fs.writeFileSync(tempPath, rawBuffer);

    if (engine === "python") {
      cleaned = await recognizeWithPython(tempPath);
    } else if (engine === "ddddocr") {
      cleaned = await recognizeWithDdddocr(tempPath, mode);
    } else {
      cleaned = await recognizeWithDdddocr(tempPath, mode);
      if (cleaned.length !== 4) {
        console.warn(
          `Node OCR returned "${cleaned}", falling back to Python ddddocr...`
        );
        cleaned = await recognizeWithPython(tempPath);
      }
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }

  if (debugDir) {
    fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(path.join(debugDir, "captcha-raw.png"), rawBuffer);
    fs.writeFileSync(path.join(debugDir, "captcha-text.txt"), cleaned);
  }

  return cleaned;
}
