const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

// 仅保留有效的 stealth 插件
puppeteer.use(StealthPlugin());

// 环境变量
const WEBSITE = process.env.WEBSITE_URL;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

// 带时间戳的详细日志
function logStep(step, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${step}] ${message}`);
}

// 休眠函数（随机化，贴近真人）
function sleep(ms) {
  const randomDelay = Math.floor(Math.random() * 500) + ms;
  return new Promise(r => setTimeout(r, randomDelay));
}

/**
 * 模拟真人级交互（核心：慢节奏、随机化，对抗静默检测）
 */
async function simulateRealHuman(page) {
  logStep("HUMAN", "开始模拟真人交互（对抗静默检测）");
  
  // 1. 随机鼠标移动（多段路径，模拟犹豫）
  const paths = [
    [Math.floor(Math.random() * 200) + 100, Math.floor(Math.random() * 200) + 100],
    [Math.floor(Math.random() * 300) + 200, Math.floor(Math.random() * 300) + 200],
    [Math.floor(Math.random() * 150) + 300, Math.floor(Math.random() * 250) + 150]
  ];
  for (const [x, y] of paths) {
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 }); // 分步移动，非瞬间跳转
    await sleep(300);
  }

  // 2. 随机滚动页面（模拟浏览）
  await page.mouse.wheel({ deltaY: Math.floor(Math.random() * 400) + 200 });
  await sleep(800);

  // 3. 模拟鼠标悬停在输入框/按钮上（真人会先 hover 再操作）
  await page.waitForSelector("#email", { visible: true });
  const emailBox = await page.$("#email");
  const emailBoxPos = await emailBox.boundingBox();
  await page.mouse.move(emailBoxPos.x + 10, emailBoxPos.y + 10);
  await sleep(500);

  const passwordBox = await page.$("#password");
  const passwordBoxPos = await passwordBox.boundingBox();
  await page.mouse.move(passwordBoxPos.x + 10, passwordBoxPos.y + 10);
  await sleep(500);

  logStep("HUMAN", "真人交互模拟完成");
}

/**
 * 等待 Turnstile 静默验证完成（核心：检测 token 生成）
 */
async function waitForSilentTurnstile(page) {
  logStep("TURNSTILE", "开始等待静默验证完成（无勾选框场景）");
  const timeout = 60000; // 静默验证超时60秒
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    try {
      // 检测静默验证核心标识：Cloudflare 生成的 token
      const tokenInfo = await page.evaluate(() => {
        const tokenElement = document.querySelector('[name="cf-turnstile-response"]');
        return {
          exists: !!tokenElement,
          hasValue: tokenElement ? tokenElement.value.length > 0 : false,
          valueLength: tokenElement ? tokenElement.value.length : 0
        };
      });

      logStep("TURNSTILE", `静默验证状态：token存在=${tokenInfo.exists}, token长度=${tokenInfo.valueLength}（已等${elapsed}s）`);

      // 静默验证成功：token 存在且有值
      if (tokenInfo.exists && tokenInfo.hasValue) {
        logStep("TURNSTILE", "✅ 静默验证成功！已生成有效 token");
        return true;
      }

      // 未完成，继续等待（随机间隔，避免固定节奏）
      await sleep(2000);

    } catch (err) {
      logStep("TURNSTILE", `静默验证检测失败：${err.message}，继续等待`);
      await sleep(2000);
    }
  }

  // 超时兜底：打印页面 token 相关 HTML
  const tokenHtml = await page.evaluate(() => {
    return document.querySelector('form') ? document.querySelector('form').innerHTML.substring(0, 1000) : '无form表单';
  });
  logStep("TURNSTILE", `❌ 静默验证超时，token相关HTML：${tokenHtml}`);
  throw new Error("Turnstile 静默验证超时（60秒），未生成有效 token");
}

/**
 * 主登录函数（适配静默验证）
 */
async function login() {
  logStep("LOGIN", "🔍 启动登录流程（适配 Turnstile 静默验证）");
  
  // 浏览器启动配置：极致隐藏自动化特征
  const browser = await puppeteer.launch({
    headless: "new", // 新版无头模式（兼容性更好）
    args: [
      "--no-sandbox",                // 服务器必须
      "--disable-setuid-sandbox",    // 服务器必须
      "--disable-dev-shm-usage",     // 解决内存不足
      "--disable-blink-features=AutomationControlled", // 核心：禁用自动化标识
      "--disable-features=VizDisplayCompositor",       // 禁用合成器，降低检测概率
      "--window-size=1920,1080",     // 固定窗口，避免异常视口
      "--start-maximized",           // 最大化窗口
      "--enable-javascript",         // 确保JS运行（Turnstile 依赖）
      "--disable-web-security",      // 避免跨域拦截
      "--disable-features=IsolateOrigins,site-per-process", // 禁用隔离，贴近普通浏览器
      "--disable-ipc-flooding-protection", // 禁用IPC限流
    ],
    ignoreHTTPSErrors: true,         // 忽略HTTPS错误（避免证书问题）
    defaultViewport: null,           // 禁用默认视口，使用最大化窗口
    slowMo: Math.floor(Math.random() * 50) + 30, // 全局慢动作（模拟真人操作速度）
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(120000); // 全局超时120秒

  // 手动设置真实的 User-Agent（替代无效插件）
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  // 设置语言
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  });

  // 终极反检测：覆盖所有自动化特征（Cloudflare 重点检测）
  await page.evaluateOnNewDocument(() => {
    // 1. 彻底删除 webdriver 标识
    delete window.navigator.webdriver;
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true
    });

    // 2. 模拟真实浏览器的硬件信息
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => Math.floor(Math.random() * 4) + 4, // 4-8核CPU
      configurable: true
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => Math.floor(Math.random() * 4) + 4, // 4-8G内存
      configurable: true
    });

    // 3. 模拟真实的语言/时区
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true
    });
    Object.defineProperty(Intl, 'DateTimeFormat', {
      value: Intl.DateTimeFormat,
      configurable: true
    });

    // 4. 隐藏 Puppeteer 的执行环境特征
    window.chrome = {
      app: { isInstalled: false },
      runtime: {},
      webstore: {}
    };
    delete window.$cdc_asdjflasutopfhvcZLmcfl_; // 清除 ChromeDevTools 标识
    delete window._phantom;
    delete window.__nightmare;
  });

  // 监听 Turnstile 相关请求（排查静默验证请求）
  page.on('request', req => {
    const url = req.url();
    if (url.includes('turnstile') || url.includes('cdn-cgi/challenge')) {
      logStep("NETWORK", `Turnstile 请求：${req.method()} ${url.slice(0, 120)}...`);
    }
  });

  // 监听页面 JS 报错（排查静默验证失败原因）
  page.on('pageerror', err => {
    logStep("PAGE_ERROR", `页面 JS 报错：${err.message}`);
  });

  try {
    // 1. 打开登录页（慢加载，模拟真人）
    logStep("LOGIN", `打开登录页：${WEBSITE}`);
    await page.goto(WEBSITE, {
      waitUntil: "networkidle0", // 等待所有网络请求完成（静默验证依赖网络）
      timeout: 120000
    });
    logStep("LOGIN", "登录页加载完成（等待静默验证初始化）");
    await sleep(3000); // 额外等待3秒，让 Turnstile 脚本加载完成

    // 2. 模拟真人交互（核心：对抗静默检测）
    await simulateRealHuman(page);

    // 3. 输入账号密码（极致慢节奏，模拟真人打字）
    logStep("LOGIN", "开始输入账号（真人打字速度）");
    await page.waitForSelector("#email", { visible: true, timeout: 10000 });
    await page.type("#email", USERNAME, {
      delay: Math.floor(Math.random() * 100) + 50 // 50-150ms/字符
    });
    await sleep(800); // 输入后停顿

    logStep("LOGIN", "开始输入密码（真人打字速度）");
    await page.type("#password", PASSWORD, {
      delay: Math.floor(Math.random() * 100) + 50
    });
    await sleep(1200); // 输入后停顿，模拟检查密码

    // 4. 关键步骤：等待 Turnstile 静默验证完成（生成 token）
    logStep("LOGIN", "等待 Turnstile 静默验证生成 token");
    await waitForSilentTurnstile(page);

    // 5. 再次模拟真人交互（提交前的犹豫）
    await simulateRealHuman(page);
    await sleep(1000);

    // 6. 点击登录按钮（模拟真人点击）
    logStep("LOGIN", "点击登录按钮（模拟真人点击）");
    const submitBtn = await page.$('button[type="submit"]');
    if (!submitBtn) {
      throw new Error("未找到登录提交按钮");
    }
    // 先 hover 再点击（真人操作习惯）
    await page.hover('button[type="submit"]');
    await sleep(500);
    await submitBtn.click({ delay: Math.floor(Math.random() * 200) + 100 });

    // 7. 等待登录结果（延长等待时间，适配慢响应）
    logStep("LOGIN", "等待登录跳转（静默验证后提交）");
    await page.waitForNavigation({
      waitUntil: ["networkidle0", "domcontentloaded"],
      timeout: 90000
    });

    const currentUrl = page.url();
    logStep("LOGIN", `登录后跳转 URL：${currentUrl}`);

    // 8. 验证登录是否成功（兼容多场景）
    const isLoginSuccess = !currentUrl.includes("login") && 
                          !currentUrl.includes("signin") && 
                          page.url() !== WEBSITE;

    if (!isLoginSuccess) {
      logStep("LOGIN", "❌ 登录失败：仍停留在登录相关页面");
      await page.screenshot({ path: "login_failed.png", fullPage: true });
      // 打印页面关键信息，排查失败原因
      const pageText = await page.evaluate(() => document.body.innerText);
      logStep("LOGIN", `页面关键文本：${pageText.substring(0, 500)}`);
      throw new Error("登录失败：未跳转到目标页面，仍在登录页");
    }

    logStep("LOGIN", "✅ 登录成功！（静默验证通过）");

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

// 全局错误捕获
process.on('unhandledRejection', (reason, promise) => {
  logStep("GLOBAL_ERROR", `未处理错误：${reason.message}`);
  process.exit(1);
});

// 启动登录
login();
