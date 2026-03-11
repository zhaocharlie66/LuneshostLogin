const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const WEBSITE = process.env.WEBSITE_URL;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function simulateHuman(page) {
  console.log("[HUMAN] 模拟用户行为");

  // 随机化鼠标移动路径，更贴近真人行为
  const randomX1 = Math.floor(Math.random() * 500);
  const randomY1 = Math.floor(Math.random() * 500);
  const randomX2 = Math.floor(Math.random() * 500);
  const randomY2 = Math.floor(Math.random() * 500);
  
  await page.mouse.move(randomX1, randomY1);
  await sleep(Math.floor(Math.random() * 500) + 300); // 随机延迟 300-800ms
  await page.mouse.move(randomX2, randomY2);
  await sleep(Math.floor(Math.random() * 500) + 300);
  await page.mouse.wheel({ deltaY: Math.floor(Math.random() * 300) + 200 }); // 随机滚动距离
  await sleep(Math.floor(Math.random() * 1000) + 500);
}

async function detectTurnstile(page) {
  try {
    // 增加等待元素加载的逻辑，避免漏检
    const exist = await page.evaluate(() => {
      if (document.querySelector('[name="cf-turnstile-response"]')) return true;
      if (document.querySelector('label.cb-lb input[type="checkbox"]')) return true;
      if (document.querySelector('#success-text')) return true;
      return false;
    });
    return exist;
  } catch (err) {
    console.warn("[DETECT] 检测 Turnstile 元素失败:", err.message);
    return false;
  }
}

async function handleTurnstile(page) {
  console.log("[TURNSTILE] 检测 Turnstile");

  const timeout = 120000; // 延长超时时间至 2 分钟
  const start = Date.now();
  let checkboxClicked = false; // 标记复选框是否已点击

  while (Date.now() - start < timeout) {
    try {
      const state = await page.evaluate(() => {
        const result = {
          success: false,
          token: false,
          checkbox: false
        };

        const success = document.querySelector("#success-text");
        if (success && success.innerText.includes("成功")) {
          result.success = true;
        }

        const token = document.querySelector('[name="cf-turnstile-response"]');
        if (token && token.value && token.value.length > 20) {
          result.token = true;
        }

        const checkbox = document.querySelector('label.cb-lb input[type="checkbox"]');
        if (checkbox && !checkbox.checked) { // 仅当复选框未勾选时标记
          result.checkbox = true;
        }

        return result;
      });

      // 验证成功的判断
      if (state.success || state.token) {
        console.log(`[TURNSTILE] 验证成功 - ${state.success ? 'success状态' : 'token已生成'}`);
        return true;
      }

      // 复选框未点击时才执行点击（避免重复点击）
      if (state.checkbox && !checkboxClicked) {
        console.log("[TURNSTILE] 需要点击 checkbox");
        const checkbox = await page.$('label.cb-lb input[type="checkbox"]');
        if (checkbox) {
          // 模拟真人点击：先移动到复选框再点击
          await page.mouse.move(
            (await checkbox.boundingBox()).x + 10,
            (await checkbox.boundingBox()).y + 10
          );
          await sleep(500);
          await checkbox.click({ delay: Math.floor(Math.random() * 200) + 100 }); // 随机点击延迟
          console.log("[TURNSTILE] checkbox 已点击");
          checkboxClicked = true;
          await sleep(5000); // 点击后延长等待时间，给验证加载留足时间
        }
      }

      // 额外处理：检测 Turnstile 弹窗/iframe（常见的验证容器）
      const turnstileIframe = await page.$('iframe[src*="turnstile"]');
      if (turnstileIframe && !state.success) {
        console.log("[TURNSTILE] 检测到验证 iframe，等待验证完成");
        await sleep(3000); // 等待 iframe 内验证加载
      }

    } catch (err) {
      console.warn("[TURNSTILE] 单次验证检查失败:", err.message);
    }

    await sleep(2000); // 延长循环间隔，减少资源占用
  }

  throw new Error("Turnstile 验证超时（已等待 2 分钟）");
}

async function login() {
  // 关键修改：使用新版无头模式，适配无图形界面的服务器环境
  const browser = await puppeteer.launch({
    headless: "new", // 新版无头模式（替代 false/true）
    args: [
      "--no-sandbox", // 必须：服务器环境需要关闭沙箱
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", // 解决内存不足问题
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--window-size=1920,1080", // 显式设置窗口尺寸
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36" // 固定高版本UA
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 }); // 设置窗口尺寸
  page.setDefaultTimeout(120000); // 延长页面默认超时时间

  // 清除自动化标识（强化反检测）
  await page.evaluateOnNewDocument(() => {
    delete window.navigator.webdriver;
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en']
    });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
    // 额外隐藏自动化特征
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  });

  try {
    console.log("[INFO] 打开登录页面");
    await page.goto(WEBSITE, {
      waitUntil: "networkidle2",
      timeout: 120000
    });

    await simulateHuman(page);

    console.log("[INFO] 输入账号密码");
    await page.waitForSelector("#email", { visible: true }); // 确保元素可见
    await page.type("#email", USERNAME, { delay: Math.floor(Math.random() * 50) + 30 }); // 随机输入延迟
    await page.type("#password", PASSWORD, { delay: Math.floor(Math.random() * 50) + 30 });

    const hasTurnstile = await detectTurnstile(page);
    if (hasTurnstile) {
      console.log("[INFO] 发现 Turnstile");
      await simulateHuman(page);
      await handleTurnstile(page);
    } else {
      console.log("[INFO] 未检测到 Turnstile");
    }

    console.log("[INFO] 点击 Submit");
    // 确保提交按钮可点击
    await page.waitForSelector('button[type="submit"]', { visible: true });
    await page.click('button[type="submit"]', { delay: Math.floor(Math.random() * 200) + 100 });

    // 延长导航等待时间
    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 60000
    });

    const url = page.url();
    console.log("[INFO] 当前页面:", url);

    if (url.includes("login")) {
      await page.screenshot({
        path: "login_failed.png",
        fullPage: true
      });
      throw new Error("仍然停留在登录页，登录失败");
    }

    console.log("[SUCCESS] 登录成功");

  } catch (err) {
    console.error("[ERROR]", err.message);
    await page.screenshot({
      path: "error.png",
      fullPage: true
    });
    throw err;

  } finally {
    await sleep(2000); // 关闭前等待，确保所有操作完成
    await browser.close();
  }
}

// 增加全局错误捕获
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

login();
