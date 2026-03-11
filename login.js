const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

// 强化Stealth插件，覆盖更多指纹特征
puppeteer.use(StealthPlugin({
  hideWebGL: true,
  hideCanvas: true,
  hideAudio: true,
  disableWebDriver: true
}));

const WEBSITE = process.env.WEBSITE_URL;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

// 随机休眠函数（模拟人类操作间隔）
function sleep(ms) {
  // 增加随机偏移，避免固定延迟被识别
  const randomDelay = Math.floor(Math.random() * 800) + ms;
  return new Promise(r => setTimeout(r, randomDelay));
}

// 增强人类行为模拟（适配CI环境）
async function simulateHuman(page) {
  console.log("[HUMAN] 模拟用户行为");

  // 随机鼠标移动（不再固定坐标）
  const randomX1 = Math.floor(Math.random() * 500) + 100;
  const randomY1 = Math.floor(Math.random() * 400) + 100;
  await page.mouse.move(randomX1, randomY1, { steps: 20 }); // 分步移动，模拟人类拖拽
  await sleep(600);

  const randomX2 = Math.floor(Math.random() * 500) + 100;
  const randomY2 = Math.floor(Math.random() * 400) + 100;
  await page.mouse.move(randomX2, randomY2, { steps: 25 });
  await sleep(700);

  // 随机滚动页面
  await page.mouse.wheel({ deltaY: Math.floor(Math.random() * 200) + 200 });
  
  // 随机点击空白处
  await page.mouse.click(
    Math.floor(Math.random() * 300) + 200,
    Math.floor(Math.random() * 200) + 200,
    { delay: Math.floor(Math.random() * 300) + 100 } // 点击延迟
  );

  await sleep(1200);
}

// 优化Turnstile检测（精准匹配"确认你是真人"勾选框）
async function detectTurnstile(page) {
  // 先等待页面完全渲染（CI环境加载慢）
  await sleep(3000);
  
  const exist = await page.evaluate(() => {
    // 精准匹配勾选框相关元素
    const checkbox = document.querySelector('label.cb-lb input[type="checkbox"]');
    const labelText = document.querySelector('.cb-lb-t')?.innerText || '';
    // 同时满足：存在复选框 + 标签包含"确认您是真人"
    return checkbox && labelText.includes("确认您是真人");
  });

  return exist;
}

// 优化Turnstile处理（适配GitHub Action环境）
async function handleTurnstile(page) {
  console.log("[TURNSTILE] 检测 Turnstile 验证");

  // 延长超时（CI环境网络/渲染慢）
  const timeout = 90000; 
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const state = await page.evaluate(() => {
      const result = {
        success: false,
        token: false,
        checkbox: false
      };

      // 1. 检测验证成功状态
      const successText = document.querySelector("#success-text")?.innerText || '';
      if (successText.includes("成功")) {
        result.success = true;
      }

      // 2. 检测有效token（验证成功的核心标识）
      const tokenInput = document.querySelector('[name="cf-turnstile-response"]');
      if (tokenInput && tokenInput.value && tokenInput.value.length > 20) {
        result.token = true;
      }

      // 3. 检测"确认你是真人"勾选框
      const checkbox = document.querySelector('label.cb-lb input[type="checkbox"]');
      const labelText = document.querySelector('.cb-lb-t')?.innerText || '';
      if (checkbox && labelText.includes("确认您是真人")) {
        result.checkbox = true;
      }

      return result;
    });

    // 验证成功：直接返回
    if (state.success || state.token) {
      console.log(`[TURNSTILE] 验证成功（${state.success ? '状态成功' : 'Token生成'}）`);
      return true;
    }

    // 存在勾选框：模拟人类点击（核心优化）
    if (state.checkbox) {
      console.log("[TURNSTILE] 点击'确认您是真人'勾选框");

      const checkbox = await page.$('label.cb-lb input[type="checkbox"]');
      if (checkbox) {
        // 模拟人类操作：先移动到勾选框 → 悬停 → 点击（带随机延迟）
        const boxRect = await page.evaluate(el => {
          const rect = el.getBoundingClientRect();
          // 点击勾选框的"非中心"位置（更像人类）
          return { 
            x: rect.x + Math.floor(Math.random() * 10) + 5, 
            y: rect.y + Math.floor(Math.random() * 10) + 5 
          };
        }, checkbox);

        // 分步移动鼠标到勾选框
        await page.mouse.move(boxRect.x, boxRect.y, { steps: 15 });
        await sleep(800); // 悬停延迟（人类思考时间）
        
        // 模拟人类点击（带随机延迟）
        await checkbox.click({ delay: Math.floor(Math.random() * 500) + 200 });
        console.log("[TURNSTILE] 勾选框已点击，等待验证结果");

        // 延长点击后等待时间（CI环境验证处理慢）
        await sleep(8000);
      }
    }

    // 降低轮询频率（避免高频检测被判定为机器）
    await sleep(2500);
  }

  throw new Error("Turnstile 验证超时（60s）");
}

// 核心登录函数（适配GitHub Action环境）
async function login() {
  // 浏览器启动参数优化（针对GitHub Action的无头环境）
  const browser = await puppeteer.launch({
    // 使用headless: "new"（新版无头模式，更接近真实浏览器）
    headless: "new", 
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=VizDisplayCompositor", // 适配CI环境渲染
      "--start-maximized", // 最大化窗口（模拟真实用户）
      "--ignore-certificate-errors", // 忽略CI环境证书问题
      "--disable-extensions",
      "--disable-plugins",
      "--disable-images", // 禁用图片加载（加快CI环境速度）
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ],
    // 延长启动超时（CI环境资源紧张）
    timeout: 120000
  });

  const page = await browser.newPage();

  // 页面超时配置（适配CI环境）
  page.setDefaultTimeout(90000);

  // 额外屏蔽自动化特征（关键）
  await page.evaluateOnNewDocument(() => {
    delete window.navigator.webdriver;
    // 模拟真实设备内存（避免被识别为容器环境）
    window.navigator.deviceMemory = 8;
    // 模拟真实核心数
    window.navigator.hardwareConcurrency = 8;
  });

  try {
    console.log("[INFO] 启动浏览器，打开登录页面");
    await page.goto(WEBSITE, {
      waitUntil: "networkidle2", // 等待网络稳定（CI环境网络波动）
      timeout: 90000
    });

    // 第一步：模拟人类行为（输入账号前）
    await simulateHuman(page);

    console.log("[INFO] 输入账号密码");
    // 等待账号输入框加载（CI环境渲染慢）
    await page.waitForSelector("#email", { timeout: 30000 });
    // 模拟人类输入（随机延迟）
    await page.type("#email", USERNAME, { delay: Math.floor(Math.random() * 80) + 30 });
    await page.type("#password", PASSWORD, { delay: Math.floor(Math.random() * 80) + 30 });

    // 检测Turnstile验证
    const hasTurnstile = await detectTurnstile(page);
    if (hasTurnstile) {
      console.log("[INFO] 发现 Turnstile 验证，开始处理");
      // 验证前再模拟一次人类行为
      await simulateHuman(page);
      // 处理Turnstile验证
      await handleTurnstile(page);
    } else {
      console.log("[INFO] 未检测到 Turnstile 验证");
    }

    console.log("[INFO] 点击 Submit 提交登录");
    // 模拟人类点击提交按钮（带延迟）
    await page.click('button[type="submit"]', { delay: Math.floor(Math.random() * 500) + 200 });

    // 等待登录跳转（CI环境慢，延长超时）
    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 60000
    });

    const currentUrl = page.url();
    console.log("[INFO] 当前页面:", currentUrl);

    // 验证是否登录成功
    if (currentUrl.includes("login")) {
      await page.screenshot({ path: "login_failed.png", fullPage: true });
      throw new Error("登录失败：仍然停留在登录页");
    }

    console.log("[SUCCESS] 登录成功");
  } catch (err) {
    console.error("[ERROR] 登录流程异常:", err.message);
    await page.screenshot({ path: "error.png", fullPage: true });
    throw err;
  } finally {
    await browser.close();
  }
}

// 执行登录
login();
