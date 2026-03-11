const puppeteer = require("puppeteer");
const axios = require("axios");

const WEBSITE = process.env.WEBSITE_URL;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegramMessage(message) {
  if (!TG_TOKEN || !TG_CHAT) return;

  try {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT,
      text: message,
      parse_mode: "Markdown"
    });
  } catch (e) {
    console.error("Telegram发送失败:", e.message);
  }
}

async function detectTurnstile(page) {
  console.log("[INFO] 检测 Turnstile...");

  try {
    await page.waitForSelector(
      'iframe[src*="challenges.cloudflare.com"]',
      { timeout: 10000 }
    );

    console.log("[INFO] 发现 Turnstile iframe");
    return true;
  } catch {
    console.log("[INFO] 未检测到 Turnstile");
    return false;
  }
}

async function clickTurnstile(page) {
  console.log("[INFO] 尝试点击 Turnstile...");

  const frames = page.frames();

  for (const frame of frames) {
    if (frame.url().includes("challenges.cloudflare.com")) {
      try {
        const checkbox = await frame.waitForSelector(
          'input[type="checkbox"], div[role="button"]',
          { timeout: 5000 }
        );

        if (checkbox) {
          await checkbox.click({ delay: 100 });
          console.log("[INFO] Turnstile 已点击");
          return true;
        }
      } catch (e) {
        console.log("[WARN] 未找到 Turnstile checkbox");
      }
    }
  }

  console.log("[WARN] Turnstile 点击失败");
  return false;
}

async function waitForTurnstileSolved(page) {
  console.log("[INFO] 等待 Turnstile 完成验证...");

  const timeout = 20000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const solved = await page.evaluate(() => {
      const textarea = document.querySelector(
        'textarea[name="cf-turnstile-response"]'
      );
      return textarea && textarea.value.length > 0;
    });

    if (solved) {
      console.log("[SUCCESS] Turnstile 验证成功");
      return true;
    }

    await sleep(1000);
  }

  console.log("[WARN] Turnstile 未确认完成");
  return false;
}

async function login() {

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  page.setDefaultTimeout(20000);

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

      await sleep(2000);

      await clickTurnstile(page);

      await waitForTurnstileSolved(page);

    }

    console.log("[INFO] 提交登录");

    await page.click('button[type="submit"]');

    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 15000
    });

    const url = page.url();
    const title = await page.title();

    console.log("[INFO] 当前页面:", url);

    if (!title.toLowerCase().includes("login")) {

      console.log("[SUCCESS] 登录成功");

      await sendTelegramMessage(
        `*登录成功*\n时间: ${new Date().toISOString()}\nURL: ${url}\n标题: ${title}`
      );

    } else {

      throw new Error("仍然停留在登录页");

    }

  } catch (error) {

    console.error("[ERROR]", error.message);

    await page.screenshot({
      path: "login-failure.png",
      fullPage: true
    });

    await sendTelegramMessage(
      `*登录失败*\n时间: ${new Date().toISOString()}\n错误: ${error.message}`
    );

    throw error;

  } finally {

    await browser.close();

  }
}

login();
