const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

// 注册反检测插件
puppeteer.use(StealthPlugin());

// 环境变量读取（增加默认值，避免未配置时报错）
const WEBSITE = process.env.WEBSITE_URL || "";
const USERNAME = process.env.USERNAME || "";
const PASSWORD = process.env.PASSWORD || "";

// 校验必要环境变量
if (!WEBSITE || !USERNAME || !PASSWORD) {
  console.error("[ERROR] 请配置 WEBSITE_URL、USERNAME、PASSWORD 环境变量");
  process.exit(1);
}

/**
 * 休眠函数（封装）
 * @param {number} ms 毫秒数
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 模拟人类行为（增加随机偏移，更贴近真实操作）
 * @param {import('puppeteer').Page} page 
 */
async function simulateHuman(page) {
  console.log("[HUMAN] 模拟用户行为");

  // 随机鼠标移动（避免固定坐标）
  const randomX1 = 100 + Math.floor(Math.random() * 300);
  const randomY1 = 100 + Math.floor(Math.random() * 300);
  await page.mouse.move(randomX1, randomY1);
  await sleep(300 + Math.random() * 500);

  const randomX2 = 200 + Math.floor(Math.random() * 400);
  const randomY2 = 200 + Math.floor(Math.random() * 400);
  await page.mouse.move(randomX2, randomY2);
  await sleep(300 + Math.random() * 500);

  // 随机滚轮滚动
  await page.mouse.wheel({ deltaY: 200 + Math.random() * 400 });
  await sleep(800 + Math.random() * 600);

  // 增加随机点击空白处（增强人类行为模拟）
  await page.mouse.click(randomX2 / 2, randomY2 / 2, { delay: 100 + Math.random() * 200 });
}

/**
 * 检测 Turnstile 元素（优化选择器，覆盖更多场景）
 * @param {import('puppeteer').Page} page 
 * @returns {Promise<boolean>}
 */
async function detectTurnstile(page) {
  try {
    const exist = await page.evaluate(() => {
      // 覆盖 Turnstile 常见选择器
      const selectors = [
        '[name="cf-turnstile-response"]',
        'label.cb-lb input[type="checkbox"]',
        '#success-text',
        '.cf-turnstile',
        '[data-cf-turnstile]',
        'iframe[src*="turnstile"]'
      ];
      
      return selectors.some(selector => document.querySelector(selector));
    });
    return exist;
  } catch (err) {
    console.warn("[WARN] Turnstile 检测失败，默认返回 false:", err.message);
    return false;
  }
}

/**
 * 处理 Turnstile 验证（核心逻辑保留，增加状态日志、错误重试）
 * @param {import('puppeteer').Page} page 
 * @returns {Promise<boolean>}
 */
async function handleTurnstile(page) {
  console.log("[TURNSTILE] 检测 Turnstile 验证");

  const timeout = 60000;
  const start = Date.now();
  let retryCount = 0; // 点击复选框重试次数

  while (Date.now() - start < timeout) {
    try {
      const state = await page.evaluate(() => {
        const result = {
          success: false,
          token: false,
          checkbox: false
        };

        // 检测成功状态
        const successEl = document.querySelector("#success-text");
        if (successEl && successEl.innerText.includes("成功")) {
          result.success = true;
        }

        // 检测 Turnstile Token
        const tokenEl = document.querySelector('[name="cf-turnstile-response"]');
        if (tokenEl && tokenEl.value && tokenEl.value.length > 20) {
          result.token = true;
        }

        // 检测验证复选框
        const checkboxEl = document.querySelector('label.cb-lb input[type="checkbox"]');
        if (checkboxEl && !checkboxEl.checked) {
          result.checkbox = true;
        }

        return result;
      });

      // 状态判断逻辑（核心逻辑完全保留）
      if (state.success) {
        console.log("[TURNSTILE] 验证成功（success 状态）");
        return true;
      }

      if (state.token) {
        console.log("[TURNSTILE] 验证成功（token 已生成）");
        return true;
      }

      if (state.checkbox && retryCount < 3) {
        console.log(`[TURNSTILE] 需要点击验证复选框（重试次数：${retryCount + 1}）`);
        const checkbox = await page.$('label.cb-lb input[type="checkbox"]');
        if (checkbox) {
          // 模拟人类点击（增加偏移和延迟）
          await checkbox.click({ offset: { x: 2, y: 2 }, delay: 100 + Math.random() * 300 });
          console.log("[TURNSTILE] 已点击验证复选框");
          await sleep(3000 + Math.random() * 2000); // 延长等待时间，适配验证加载
          retryCount++;
        }
      }

      await sleep(1500 + Math.random() * 1000); // 随机休眠，避免固定间隔
    } catch (err) {
      console.warn("[WARN] Turnstile 单次检测异常，继续重试:", err.message);
      await sleep(2000);
    }
  }

  throw new Error(`Turnstile 验证超时（${timeout / 1000}s）`);
}

/**
 * 核心登录逻辑
 */
async function login() {
  let browser = null;
  try {
    console.log("[INFO] 启动浏览器");
    // 浏览器启动配置增强（适配更多环境）
    browser = await puppeteer.launch({
      headless: "new", // 使用新版无头模式，更稳定
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security", // 适配部分网站的跨域限制
        "--start-maximized", // 最大化窗口，更贴近真实用户
        "--ignore-certificate-errors" // 忽略证书错误（适配测试环境）
      ],
      ignoreDefaultArgs: ["--enable-automation"], // 移除自动化标识
      defaultViewport: null // 使用窗口默认视口
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(60000);

    // 设置更真实的 User-Agent（随机化小版本号）
    const minorVersion = Math.floor(Math.random() * 10);
    await page.setUserAgent(
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
      `(KHTML, like Gecko) Chrome/120.0.0.${minorVersion} Safari/537.36`
    );

    // 清除 navigator.webdriver 标识（增强反检测）
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
    });

    console.log("[INFO] 打开登录页面:", WEBSITE);
    await page.goto(WEBSITE, {
      waitUntil: "networkidle2",
      timeout: 60000
    });

    // 模拟人类行为后再输入账号密码
    await simulateHuman(page);

    console.log("[INFO] 输入账号密码");
    // 等待输入框加载完成（增加可见性判断）
    await page.waitForSelector("#email", { visible: true });
    await page.waitForSelector("#password", { visible: true });

    // 输入账号密码（增加随机延迟，更贴近人类）
    await page.type("#email", USERNAME, { delay: 30 + Math.random() * 70 });
    await sleep(500 + Math.random() * 500); // 输入密码前停顿
    await page.type("#password", PASSWORD, { delay: 30 + Math.random() * 70 });

    // 检测并处理 Turnstile 验证
    const hasTurnstile = await detectTurnstile(page);
    if (hasTurnstile) {
      console.log("[INFO] 发现 Turnstile 验证，开始处理");
      await simulateHuman(page); // 验证前再次模拟人类行为
      await handleTurnstile(page);
    } else {
      console.log("[INFO] 未检测到 Turnstile 验证");
    }

    // 点击提交按钮（增加等待和可见性判断）
    console.log("[INFO] 点击登录提交按钮");
    await page.waitForSelector('button[type="submit"]', { visible: true });
    await page.click('button[type="submit"]', { delay: 200 + Math.random() * 300 });

    // 等待页面跳转
    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 30000
    });

    const currentUrl = page.url();
    console.log("[INFO] 登录后页面地址:", currentUrl);

    // 验证是否登录成功
    if (currentUrl.includes("login") || currentUrl.includes("signin")) {
      await page.screenshot({ path: "login_failed.png", fullPage: true });
      throw new Error("登录失败：仍停留在登录页面");
    }

    console.log("[SUCCESS] 登录成功！");
    return true;

  } catch (err) {
    console.error("[ERROR] 登录流程异常:", err.message);
    // 异常时截图（如果页面存在）
    if (browser) {
      const pages = await browser.pages();
      if (pages.length > 0) {
        await pages[0].screenshot({ path: "error.png", fullPage: true });
      }
    }
    throw err;

  } finally {
    // 确保浏览器关闭
    if (browser) {
      await browser.close();
      console.log("[INFO] 浏览器已关闭");
    }
  }
}

// 执行登录并处理顶级错误
login().catch((err) => {
  console.error("[FATAL] 登录失败:", err.message);
  process.exit(1);
});
