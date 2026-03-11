const puppeteer = require("puppeteer");
const axios = require("axios");

const WEBSITE = process.env.WEBSITE_URL;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForTurnstileToken(page) {

  console.log("[TURNSTILE] 等待自动验证...");

  const timeout = 30000;
  const start = Date.now();

  while (Date.now() - start < timeout) {

    const token = await page.evaluate(() => {
      const el = document.querySelector(
        'textarea[name="cf-turnstile-response"]'
      );
      return el ? el.value : null;
    });

    if (token && token.length > 10) {
      console.log("[TURNSTILE] 验证成功");
      return true;
    }

    await sleep(1000);
  }

  console.log("[TURNSTILE] 未检测到 token");
  return false;
}

async function detectTurnstile(page) {

  console.log("[INFO] 检测 Turnstile...");

  const exists = await page.evaluate(() => {

    if (document.querySelector('iframe[src*="challenges.cloudflare.com"]'))
      return true;

    if (document.querySelector('[data-sitekey]'))
      return true;

    if (document.querySelector('textarea[name="cf-turnstile-response"]'))
      return true;

    return false;
  });

  if (exists) {
    console.log("[INFO] 发现 Turnstile");
  } else {
    console.log("[INFO] 未检测到 Turnstile");
  }

  return exists;
}

async function login() {

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const page = await browser.newPage();

  page.setDefaultTimeout(30000);

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  try {

    console.log("[INFO] 打开登录页面");

    await page.goto(WEBSITE, {
      waitUntil: "networkidle2"
    });

    await page.waitForSelector("#email");

    await page.type("#email", USERNAME, { delay: 50 });
    await page.type("#password", PASSWORD, { delay: 50 });

    const hasTurnstile = await detectTurnstile(page);

    if (hasTurnstile) {

      const ok = await waitForTurnstileToken(page);

      if (!ok) {
        throw new Error("Turnstile 自动验证失败");
      }

    }

    console.log("[INFO] 点击 Submit");

    await page.click('button[type="submit"]');

    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 20000
    });

    const url = page.url();
    const title = await page.title();

    console.log("[INFO] 当前页面:", url);

    if (url.includes("login")) {
      throw new Error("仍然停留在登录页");
    }

    console.log("[SUCCESS] 登录成功");

  } catch (err) {

    console.error("[ERROR]", err.message);

    await page.screenshot({
      path: "login-error.png",
      fullPage: true
    });

    throw err;

  } finally {

    await browser.close();

  }
}

login();
