const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

// 环境变量
const WEBSITE = process.env.WEBSITE_URL;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

// 带时间戳的详细日志（定位问题核心）
function logStep(step, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${step}] ${message}`);
}

// 休眠函数
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 模拟真人行为（轻量适配无复杂验证）
async function simulateHuman(page) {
  logStep("HUMAN", "开始模拟用户行为");
  // 随机鼠标移动（贴近真人操作）
  const x1 = Math.floor(Math.random() * 300) + 100, y1 = Math.floor(Math.random() * 300) + 100;
  const x2 = Math.floor(Math.random() * 300) + 200, y2 = Math.floor(Math.random() * 300) + 200;
  await page.mouse.move(x1, y1);
  await sleep(Math.floor(Math.random() * 400) + 200);
  await page.mouse.move(x2, y2);
  await sleep(Math.floor(Math.random() * 400) + 200);
  // 轻微滚动
  await page.mouse.wheel({ deltaY: Math.floor(Math.random() * 200) + 100 });
  await sleep(Math.floor(Math.random() * 800) + 400);
  logStep("HUMAN", "用户行为模拟完成");
}

// 检测Turnstile（适配cb-lb/cb-i容器）
async function detectTurnstile(page) {
  logStep("DETECT", "检测Turnstile勾选容器");
  try {
    await page.waitForSelector('body', { timeout: 8000 });
    // 匹配实际的「确认你是真人」容器（核心修正）
    const hasTurnstile = await page.evaluate(() => {
      return !!document.querySelector('.cb-lb') || !!document.querySelector('.cb-i') || !!document.querySelector('.cb-lb-t');
    });
    logStep("DETECT", `是否检测到Turnstile：${hasTurnstile}`);
    return hasTurnstile;
  } catch (err) {
    logStep("DETECT", `检测失败：${err.message}`);
    return false;
  }
}

// 处理Turnstile纯勾选验证（核心修正：选择器+点击逻辑）
async function handleTurnstile(page) {
  logStep("TURNSTILE", "开始处理纯勾选Turnstile验证");
  const timeout = 90000; // 缩短为90秒（纯勾选验证无需2分钟）
  const start = Date.now();
  let isClicked = false; // 标记是否已点击勾选框

  while (Date.now() - start < timeout) {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    logStep("TURNSTILE", `轮询验证状态（已耗时${elapsed}s，剩余${Math.floor((timeout - (Date.now() - start))/1000)}s）`);

    try {
      // 1. 获取当前验证核心状态（适配纯勾选）
      const state = await page.evaluate(() => {
        const result = {
          // 验证成功标识：Cloudflare生成token/成功文本
          hasToken: !!document.querySelector('[name="cf-turnstile-response"]')?.value,
          successText: document.querySelector('.cb-lb-t')?.innerText || '',
          // 实际勾选容器是否存在
          hasCheckContainer: !!document.querySelector('.cb-lb'),
          // 验证完成的视觉标识（部分页面会隐藏勾选框）
          isCheckHidden: document.querySelector('.cb-lb')?.style.display === 'none'
        };
        // 纯勾选验证成功的核心判断：有token / 勾选框隐藏
        result.verified = result.hasToken || result.isCheckHidden;
        return result;
      });

      // 打印详细状态（便于排查）
      logStep("TURNSTILE", `当前状态：有Token=${state.hasToken}, 勾选容器存在=${state.hasCheckContainer}, 容器隐藏=${state.isCheckHidden}, 验证成功=${state.verified}`);

      // 2. 验证成功，直接返回
      if (state.verified) {
        logStep("TURNSTILE", "✅ 纯勾选验证成功！");
        return true;
      }

      // 3. 未点击过，且勾选容器存在 → 模拟真人点击（核心修正）
      if (state.hasCheckContainer && !isClicked) {
        logStep("TURNSTILE", "准备点击「确认你是真人」勾选框");
        // 定位实际的勾选容器（.cb-lb是核心容器）
        const checkBox = await page.$('.cb-lb');
        if (checkBox) {
          // 获取容器位置，点击**左侧勾选框区域**（真人点击习惯，而非文字）
          const box = await checkBox.boundingBox();
          logStep("TURNSTILE", `勾选容器位置：x=${box.x}, y=${box.y}, 宽=${box.width}, 高=${box.height}`);
          // 点击容器左侧10px位置（匹配cb-i勾选图标区域）
          const clickX = box.x + 10, clickY = box.y + box.height / 2;
          await page.mouse.move(clickX, clickY); // 先移动鼠标到勾选框
          await sleep(600); // 停留片刻，模拟真人犹豫
          await page.mouse.click(clickX, clickY, { delay: Math.floor(Math.random() * 150) + 50 }); // 模拟真人点击
          logStep("TURNSTILE", "✅ 已点击「确认你是真人」勾选框");
          isClicked = true;
          await sleep(4000); // 点击后等待4秒，让Cloudflare生成token
        } else {
          logStep("TURNSTILE", "⚠️ 未找到.cb-lb容器，尝试匹配.cb-i");
          await page.click('.cb-i', { delay: 200 });
          isClicked = true;
          await sleep(4000);
        }
      }

      // 4. 已点击，等待token生成（轮询间隔3秒）
      if (isClicked) {
        logStep("TURNSTILE", "已点击勾选框，等待Cloudflare生成验证Token");
        await sleep(3000);
      }

    } catch (loopErr) {
      logStep("TURNSTILE", `单次轮询失败：${loopErr.message}，继续重试`);
      await sleep(2000);
    }
  }

  // 超时兜底：保存截图+页面信息
  logStep("TURNSTILE", "❌ 验证超时，保存截图到turnstile_timeout.png");
  await page.screenshot({ path: "turnstile_timeout.png", fullPage: true });
  // 打印勾选框周边HTML（便于确认最终DOM结构）
  const checkHtml = await page.$eval('.cb-lb', el => el.outerHTML).catch(() => '未找到.cb-lb');
  logStep("TURNSTILE", `勾选框最终DOM：${checkHtml}`);
  throw new Error(`Turnstile纯勾选验证超时（90秒），已保存截图和DOM信息`);
}

// 主登录函数
async function login() {
  logStep("LOGIN", "🔍 启动登录流程");
  // 新版无头模式（适配服务器无图形界面）
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080", // 固定窗口，避免元素偏移
      "--disable-web-security",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  page.setDefaultTimeout(90000); // 全局超时90秒

  // 强化反爬：彻底隐藏自动化标识（Cloudflare重点检测）
  await page.evaluateOnNewDocument(() => {
    delete window.navigator.webdriver;
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4] });
    // 隐藏Puppeteer的视口标识
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1920 });
    Object.defineProperty(window, 'innerHeight', { writable: true, value: 1080 });
  });

  // 监听页面JS报错（排查页面端问题）
  page.on('pageerror', err => logStep("PAGE_ERROR", `页面JS报错：${err.message}`));
  // 监听Turnstile网络请求（排查token请求是否被拦截）
  page.on('request', req => {
    if (req.url().includes('turnstile') || req.url().includes('cf-chl')) {
      logStep("NETWORK", `Turnstile请求：${req.method()} ${req.url().slice(0, 100)}...`);
    }
  });

  try {
    // 1. 打开登录页
    logStep("LOGIN", `打开登录页：${WEBSITE}`);
    await page.goto(WEBSITE, { waitUntil: "networkidle2", timeout: 90000 });
    logStep("LOGIN", "登录页加载完成");

    // 2. 模拟真人行为
    await simulateHuman(page);

    // 3. 输入账号密码（模拟真人打字速度）
    logStep("LOGIN", "开始输入账号");
    await page.waitForSelector("#email", { visible: true, timeout: 8000 });
    await page.type("#email", USERNAME, { delay: Math.floor(Math.random() * 60) + 40 });
    logStep("LOGIN", "开始输入密码");
    await page.type("#password", PASSWORD, { delay: Math.floor(Math.random() * 60) + 40 });
    logStep("LOGIN", "账号密码输入完成");

    // 4. 检测并处理Turnstile
    const hasTurnstile = await detectTurnstile(page);
    if (hasTurnstile) {
      logStep("LOGIN", "检测到Turnstile纯勾选验证，开始处理");
      await simulateHuman(page); // 验证前再模拟一次行为，降低检测概率
      await handleTurnstile(page);
    }

    // 5. 点击登录按钮
    logStep("LOGIN", "点击登录提交按钮");
    await page.waitForSelector('button[type="submit"]', { visible: true, timeout: 8000 });
    await page.click('button[type="submit"]', { delay: Math.floor(Math.random() * 200) + 100 });

    // 6. 等待登录结果
    logStep("LOGIN", "等待页面导航，确认登录结果");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    const currentUrl = page.url();
    logStep("LOGIN", `登录后跳转URL：${currentUrl}`);

    // 7. 验证登录是否成功
    if (currentUrl.includes("login")) {
      logStep("LOGIN", "❌ 登录失败：仍停留在登录页");
      await page.screenshot({ path: "login_failed.png", fullPage: true });
      throw new Error("登录失败：未跳转到目标页面，仍在登录页");
    }

    logStep("LOGIN", "✅ 登录成功！");

  } catch (err) {
    logStep("LOGIN", `❌ 登录流程失败：${err.message}`);
    await page.screenshot({ path: "login_error.png", fullPage: true });
    throw err;
  } finally {
    logStep("LOGIN", "关闭浏览器");
    await sleep(2000);
    await browser.close();
  }
}

// 全局错误捕获，避免进程挂掉
process.on('unhandledRejection', (reason, promise) => {
  logStep("GLOBAL_ERROR", `未处理错误：${reason.message}`);
  process.exit(1);
});

// 启动登录
login();
