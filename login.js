const puppeteer = require('puppeteer');
const axios = require('axios');

async function sendTelegramMessage(botToken, chatId, message) {
  if (!botToken || !chatId) return;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await axios.post(url, {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  }).catch(error => {
    console.error('Telegram 通知失败:', error.message);
  });
}

/**
 * 参考 Python 版本 _try_click_captcha 逻辑
 * 原生点击 Turnstile/Cloudflare 验证按钮（无第三方 API 依赖）
 */
async function tryClickCaptcha(page, stage) {
  try {
    console.log(`🔍 尝试点击 ${stage} 的 Turnstile 验证...`);
    
    // 等待 Turnstile 验证框加载
    await page.waitForSelector(
      'iframe[src*="turnstile"], div[class*="turnstile"], .cf-turnstile, .g-recaptcha',
      { timeout: 5000, visible: true }
    ).catch(() => {
      console.log(`⚠️ ${stage} 未找到 Turnstile 验证框`);
      return;
    });

    // 方式1：点击 Turnstile 验证按钮（iframe 内）
    const iframe = await page.$('iframe[src*="turnstile"]');
    if (iframe) {
      const frame = await iframe.contentFrame();
      if (frame) {
        const checkbox = await frame.$('input[type="checkbox"], div[role="checkbox"], .challenge-form');
        if (checkbox) {
          await checkbox.click({ delay: 100 });
          console.log(`✅ ${stage} 点击 Turnstile 复选框成功`);
          await page.waitForTimeout(3000); // 等待验证完成
          return;
        }
      }
    }

    // 方式2：点击页面上的验证按钮（兼容 g-recaptcha 样式）
    const captchaBtn = await page.$('.g-recaptcha > div, .cf-turnstile > button, div[class*="captcha"] button');
    if (captchaBtn) {
      await captchaBtn.click({ delay: 150 });
      console.log(`✅ ${stage} 点击验证码按钮成功`);
      await page.waitForTimeout(3000);
      return;
    }

    console.log(`⚠️ ${stage} 未找到可点击的验证元素`);
  } catch (e) {
    console.log(`⚠️ ${stage} 点击验证码异常：${e.message}`);
  }
}

/**
 * 检查是否登录成功（参考 Python 版本 _is_logged_in 逻辑）
 */
async function isLoggedIn(page) {
  // 判定条件1：退出按钮可见
  try {
    const logoutBtn = await page.$('a[href="/logout"].action-btn.ghost');
    if (logoutBtn) return true;
  } catch (e) {}

  // 判定条件2：欢迎语包含 Welcome back
  try {
    const welcomeText = await page.$eval('h1.hero-title', el => el.textContent.toLowerCase());
    if (welcomeText.includes('welcome back')) return true;
  } catch (e) {}

  // 判定条件3：URL 不包含 login 且标题不含 Login
  try {
    const url = page.url().toLowerCase();
    const title = (await page.title()).toLowerCase();
    if (!url.includes('login') && !title.includes('login')) return true;
  } catch (e) {}

  return false;
}

async function login() {
  // 参考 Python UC 模式，增强反爬绕过
  const browser = await puppeteer.launch({
    headless: 'new', // 新版无头模式更兼容
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--start-maximized',
      '--disable-blink-features=AutomationControlled', // 禁用自动化检测
      '--disable-features=VizDisplayCompositor',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ],
    ignoreDefaultArgs: ['--enable-automation'], // 移除自动化标识
    defaultViewport: { width: 1920, height: 1080 } // 匹配 Python 窗口大小
  });

  const page = await browser.newPage();

  // 移除 Puppeteer 特征，模拟真实浏览器（关键）
  await page.evaluateOnNewDocument(() => {
    delete window.navigator.webdriver;
    Object.defineProperty(window.navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(window.navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(window.navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(window.navigator, 'deviceMemory', { get: () => 16 });
  });

  // 保留原有环境变量
  const { WEBSITE_URL, USERNAME, PASSWORD, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  
  // 校验必要环境变量
  if (!WEBSITE_URL || !USERNAME || !PASSWORD) {
    throw new Error('缺少必要环境变量：WEBSITE_URL / USERNAME / PASSWORD');
  }

  try {
    console.log(`🚀 访问登录页面: ${WEBSITE_URL}`);
    
    // 参考 Python uc_open_with_reconnect 逻辑，增加重连/等待机制
    await page.goto(WEBSITE_URL, { 
      waitUntil: 'networkidle2', 
      timeout: 30000,
      referer: WEBSITE_URL
    });
    await page.waitForTimeout(2000); // 页面加载后等待

    // 填写账号密码（清空输入框，模拟人工输入）
    await page.waitForSelector('#email', { timeout: 25000, visible: true });
    await page.waitForSelector('#password', { timeout: 25000, visible: true });
    
    await page.$eval('#email', el => el.value = '');
    await page.type('#email', USERNAME, { delay: 100 }); // 模拟人工输入速度
    
    await page.$eval('#password', el => el.value = '');
    await page.type('#password', PASSWORD, { delay: 120 });

    // 提交前尝试点击验证码（参考 Python 提交前 click captcha 逻辑）
    await tryClickCaptcha(page, '提交前');

    // 提交登录表单
    await page.waitForSelector('button[type="submit"], .submit-btn', { timeout: 25000 });
    await page.click('button[type="submit"], .submit-btn');
    await page.waitForNavigation({ 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    }).catch(() => {
      console.log('⚠️ 登录提交后无页面跳转，检查 AJAX 登录状态');
    });

    // 提交后再次尝试点击验证码（参考 Python 提交后 click captcha 逻辑）
    await tryClickCaptcha(page, '提交后');
    await page.waitForTimeout(2000);

    // 验证登录状态（最多等待 10 秒，参考 Python 循环检查逻辑）
    let loggedIn = false;
    for (let i = 0; i < 10; i++) {
      loggedIn = await isLoggedIn(page);
      if (loggedIn) break;
      await page.waitForTimeout(1000);
    }

    // 登录结果判定
    const currentUrlAfter = page.url();
    const title = await page.title();
    
    if (loggedIn) {
      const successMsg = `*登录成功！*\n时间: ${new Date().toISOString()}\n页面: ${currentUrlAfter}\n标题: ${title}`;
      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, successMsg);
      console.log('🎉 登录成功！当前页面：', currentUrlAfter);
    } else {
      throw new Error(`登录可能失败。当前 URL: ${currentUrlAfter}, 标题: ${title}`);
    }

    console.log('✅ 脚本执行完成。');
  } catch (error) {
    // 错误处理：截图 + 通知
    await page.screenshot({ path: 'login-failure.png', fullPage: true });
    const errorMsg = `*登录失败！*\n时间: ${new Date().toISOString()}\n错误: ${error.message}\n请检查 Artifacts 中的 login-debug`;
    await sendTelegramMessage(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, errorMsg);
    console.error('❌ 登录失败：', error.message);
    console.error('📸 截屏已保存为 login-failure.png');
    throw error;
  } finally {
    console.log('🔌 关闭浏览器');
    await browser.close();
  }
}

// 执行登录逻辑
login().catch(err => {
  console.error('💥 脚本执行失败:', err.message);
  process.exit(1);
});
