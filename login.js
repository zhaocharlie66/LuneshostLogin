const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 确保截图目录存在（匹配 Python 逻辑）
const SCREENSHOT_DIR = "screenshots";
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/**
 * 替代 page.waitForTimeout (新版 Puppeteer 废弃该方法)
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 发送 Telegram 消息（匹配 Python 逻辑）
 */
async function sendTelegramMessage(botToken, chatId, message) {
  if (!botToken || !chatId) return;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    }, { timeout: 15 });
  } catch (error) {
    console.error('⚠️ Telegram 通知失败:', error.message);
  }
}

/**
 * 截图方法（匹配 Python 逻辑）
 */
async function screenshot(page, name) {
  const screenshotPath = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 截图已保存: ${screenshotPath}`);
}

/**
 * 掩码邮箱（匹配 Python 的 mask_email_keep_domain）
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***';
  const [name, domain] = email.split('@', 2);
  let maskedName = name;
  if (name.length > 2) {
    maskedName = name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
  }
  return `${maskedName}@${domain}`;
}

/**
 * 尝试点击验证码（匹配 Python 的 _try_click_captcha）
 */
async function tryClickCaptcha(page, stage) {
  try {
    console.log(`🔍 尝试点击 ${stage} 的 Turnstile 验证...`);
    
    // 等待 Turnstile 验证框加载
    const iframe = await page.waitForSelector(
      'iframe[src*="turnstile"], .cf-turnstile iframe',
      { timeout: 5000, visible: true }
    ).catch(() => null);

    if (iframe) {
      const frame = await iframe.contentFrame();
      if (frame) {
        // 点击 Turnstile 复选框
        const checkbox = await frame.waitForSelector(
          'input[type="checkbox"], div[role="checkbox"]',
          { timeout: 3000, visible: true }
        ).catch(() => null);
        if (checkbox) {
          await checkbox.click({ delay: 100 });
          console.log(`✅ ${stage} 点击 Turnstile 复选框成功`);
          await wait(3000); // 等待验证完成
          return;
        }
      }
    }

    // 兼容其他验证码样式
    const captchaBtn = await page.waitForSelector(
      '.g-recaptcha > div, .cf-turnstile > button',
      { timeout: 3000, visible: true }
    ).catch(() => null);
    
    if (captchaBtn) {
      await captchaBtn.click({ delay: 150 });
      console.log(`✅ ${stage} 点击验证码按钮成功`);
      await wait(3000);
      return;
    }

    console.log(`⚠️ ${stage} 未找到可点击的验证元素`);
  } catch (e) {
    console.log(`⚠️ ${stage} 点击验证码异常：${e.message}`);
  }
}

/**
 * 检查是否登录成功（匹配 Python 的 _is_logged_in）
 */
async function isLoggedIn(page) {
  // 判定1：退出按钮可见
  try {
    const logoutBtn = await page.$('a[href="/logout"].action-btn.ghost');
    if (logoutBtn) return true;
  } catch (e) {}

  // 判定2：欢迎语包含 Welcome back
  try {
    const welcomeText = await page.$eval('h1.hero-title', el => el.textContent.toLowerCase());
    if (welcomeText.includes('welcome back')) return true;
  } catch (e) {}

  // 判定3：URL 不包含 login 且标题不含 Login
  try {
    const url = page.url().toLowerCase();
    const title = (await page.title()).toLowerCase();
    if (!url.includes('login') && !title.includes('login')) return true;
  } catch (e) {}

  return false;
}

/**
 * 提取 server_id 并进入服务器页面（匹配 Python 的 _find_server_id_and_go_server_page）
 */
async function extractServerIdAndGo(page) {
  try {
    // 等待服务器卡片加载
    await page.waitForSelector('a.server-card[href^="/servers/"]', { timeout: 25000 });
    
    // 提取 href 中的 server_id
    const href = await page.$eval('a.server-card[href^="/servers/"]', el => el.getAttribute('href'));
    const serverIdMatch = href.match(/\/servers\/(\d+)/);
    if (!serverIdMatch) {
      await screenshot(page, `server_id_extract_failed_${Date.now()}.png`);
      return { serverId: null, enteredOk: false };
    }
    const serverId = serverIdMatch[1];
    console.log(`🧭 提取到 server_id: ${serverId}`);

    // 点击服务器卡片进入详情页
    await page.click('a.server-card[href^="/servers/"]');
    // 等待 "Now managing" 出现
    await page.waitForXPath('//p[contains(normalize-space(.), "Now managing")]', { timeout: 30000 });
    return { serverId, enteredOk: true };
  } catch (e) {
    // 兜底：直接拼接 URL 打开
    try {
      const href = await page.$eval('a.server-card[href^="/servers/"]', el => el.getAttribute('href'));
      const serverIdMatch = href.match(/\/servers\/(\d+)/);
      if (serverIdMatch) {
        const serverId = serverIdMatch[1];
        const serverUrl = `https://betadash.lunes.host/servers/${serverId}`;
        console.log(`⚠️ 点击跳转失败，直接打开: ${serverUrl}`);
        await page.goto(serverUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForXPath('//p[contains(normalize-space(.), "Now managing")]', { timeout: 30000 });
        return { serverId, enteredOk: true };
      }
    } catch (innerE) {
      console.error(`❌ 进入服务器页面失败: ${innerE.message}`);
      await screenshot(page, `goto_server_failed_${Date.now()}.png`);
      return { serverId: null, enteredOk: false };
    }
    await screenshot(page, `server_id_extract_failed_${Date.now()}.png`);
    return { serverId: null, enteredOk: false };
  }
}

/**
 * 登录后流程：服务器页停留 → 返回首页 → 退出（匹配 Python 的 _post_login_visit_then_logout）
 */
async function postLoginFlow(page) {
  // 1. 提取 server_id 并进入服务器页
  const { serverId, enteredOk } = await extractServerIdAndGo(page);
  if (!enteredOk) {
    return { serverId, logoutOk: false };
  }

  // 2. 服务器页停留 4-6 秒
  const stayServer = Math.floor(Math.random() * 3) + 4; // 4-6 秒
  console.log(`⏳ 服务器页停留 ${stayServer} 秒...`);
  await wait(stayServer * 1000);

  // 3. 返回首页并停留 3-5 秒
  try {
    console.log(`↩️ 返回首页: https://betadash.lunes.host/`);
    await page.goto('https://betadash.lunes.host/', { waitUntil: 'networkidle2', timeout: 30000 });
    const stayHome = Math.floor(Math.random() * 3) + 3; // 3-5 秒
    console.log(`⏳ 首页停留 ${stayHome} 秒...`);
    await wait(stayHome * 1000);
  } catch (e) {
    console.error(`❌ 返回首页失败: ${e.message}`);
    await screenshot(page, `back_home_failed_${Date.now()}.png`);
    return { serverId, logoutOk: false };
  }

  // 4. 点击退出按钮
  try {
    await page.waitForSelector('a[href="/logout"].action-btn.ghost', { timeout: 15000 });
    await page.click('a[href="/logout"].action-btn.ghost');
    await wait(1000);
  } catch (e) {
    console.error(`❌ 点击退出按钮失败: ${e.message}`);
    await screenshot(page, `logout_click_failed_${Date.now()}.png`);
    return { serverId, logoutOk: false };
  }

  // 验证退出是否成功
  try {
    const currentUrl = page.url().toLowerCase();
    // 退出成功判定：URL 包含 login 或 登录表单可见
    if (currentUrl.includes('/login')) {
      return { serverId, logoutOk: true };
    }
    await page.waitForSelector('#email', { timeout: 5000 });
    await page.waitForSelector('#password', { timeout: 5000 });
    return { serverId, logoutOk: true };
  } catch (e) {
    console.error(`❌ 退出验证失败: ${e.message}`);
    await screenshot(page, `logout_verify_failed_${Date.now()}.png`);
    return { serverId, logoutOk: false };
  }
}

/**
 * 解析环境变量中的账号批量配置（匹配 Python 的 build_accounts_from_env）
 */
function parseAccountsFromEnv() {
  const batch = process.env.ACCOUNTS_BATCH || '';
  const lines = batch.trim().split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
  
  if (lines.length === 0) {
    throw new Error('❌ 环境变量 ACCOUNTS_BATCH 为空或无有效账号');
  }

  const accounts = [];
  lines.forEach((line, idx) => {
    const parts = line.trim().split(',').map(p => p.trim());
    if (parts.length !== 2 && parts.length !== 4) {
      throw new Error(`❌ ACCOUNTS_BATCH 第 ${idx+1} 行格式错误：必须是 email,password 或 email,password,tg_bot_token,tg_chat_id`);
    }
    const [email, password, tgToken = '', tgChat = ''] = parts;
    if (!email || !password) {
      throw new Error(`❌ ACCOUNTS_BATCH 第 ${idx+1} 行邮箱/密码为空`);
    }
    accounts.push({ email, password, tgToken, tgChat });
  });
  return accounts;
}

/**
 * 单账号登录流程（匹配 Python 的 login_then_flow_one_account）
 */
async function loginOneAccount(account) {
  const { email, password, tgToken, tgChat } = account;
  const safeEmail = maskEmail(email);
  let browser;

  try {
    // 启动浏览器（匹配 Python 的 UC 模式反爬）
    browser = await puppeteer.launch({
      headless: 'new', // 新版无头模式
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: { width: 1920, height: 1080 }
    });

    const page = await browser.newPage();

    // 移除自动化特征（模拟真实浏览器）
    await page.evaluateOnNewDocument(() => {
      delete window.navigator.webdriver;
      Object.defineProperty(window.navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(window.navigator, 'plugins', { get: () => [1, 2, 3] });
    });

    console.log(`🚀 访问登录页面: https://betadash.lunes.host/login?next=/`);
    // 重试机制（匹配 Python 的 uc_open_with_reconnect）
    let pageLoaded = false;
    for (let i = 0; i < 3; i++) {
      try {
        await page.goto('https://betadash.lunes.host/login?next=/', { 
          waitUntil: 'networkidle2', 
          timeout: 30000 
        });
        pageLoaded = true;
        break;
      } catch (e) {
        console.log(`⚠️ 页面加载失败（第 ${i+1} 次），重试中...`);
        await wait(5000);
      }
    }

    if (!pageLoaded) {
      throw new Error('页面加载超时（3次重试失败）');
    }

    await wait(2000);

    // 填写登录表单
    await page.waitForSelector('#email', { timeout: 25000 });
    await page.waitForSelector('#password', { timeout: 25000 });
    await page.waitForSelector('button.submit-btn[type="submit"]', { timeout: 25000 });

    await page.$eval('#email', el => el.value = '');
    await page.type('#email', email, { delay: 100 });
    await page.$eval('#password', el => el.value = '');
    await page.type('#password', password, { delay: 120 });

    // 提交前点击验证码
    await tryClickCaptcha(page, '提交前');

    // 提交登录
    await page.click('button.submit-btn[type="submit"]');
    await wait(2000);

    // 提交后再次尝试点击验证码
    await tryClickCaptcha(page, '提交后');

    // 检查登录状态（最多等待 10 秒）
    let loggedIn = false;
    for (let i = 0; i < 10; i++) {
      loggedIn = await isLoggedIn(page);
      if (loggedIn) break;
      await wait(1000);
    }

    if (!loggedIn) {
      throw new Error('登录状态验证失败（未找到登录成功特征）');
    }

    console.log(`✅ ${safeEmail} 登录成功`);

    // 登录后流程：服务器页 → 首页 → 退出
    const { serverId, logoutOk } = await postLoginFlow(page);

    // 发送成功通知
    const successMsg = [
      `✅ Lunes BetaDash 登录成功`,
      `账号：${safeEmail}`,
      `server_id：${serverId || '未提取到'}`,
      `退出：${logoutOk ? '✅ 成功' : '❌ 失败'}`,
      `时间：${new Date().toISOString()}`
    ].join('\n');
    
    await sendTelegramMessage(tgToken, tgChat, successMsg);
    return { success: true, email: safeEmail, serverId, logoutOk };

  } catch (error) {
    console.error(`❌ ${safeEmail} 登录失败: ${error.message}`);
    // 失败截图
    if (browser) {
      const page = (await browser.pages())[0];
      await screenshot(page, `login_failed_${safeEmail.replace(/[@*.]/g, '_')}_${Date.now()}.png`);
    }
    // 发送失败通知
    const failMsg = [
      `❌ Lunes BetaDash 登录失败`,
      `账号：${safeEmail}`,
      `错误：${error.message}`,
      `时间：${new Date().toISOString()}`
    ].join('\n');
    await sendTelegramMessage(tgToken, tgChat, failMsg);
    return { success: false, email: safeEmail, error: error.message };
  } finally {
    if (browser) {
      await browser.close();
      console.log(`🔌 浏览器已关闭（账号：${safeEmail}）`);
    }
  }
}

/**
 * 主流程（匹配 Python 的 main）
 */
async function main() {
  try {
    const accounts = parseAccountsFromEnv();
    console.log(`📋 共解析到 ${accounts.length} 个账号待处理`);

    let successCount = 0;
    let failCount = 0;
    let logoutOkCount = 0;

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      console.log(`\n==================================================`);
      console.log(`👤 处理账号 ${i+1}/${accounts.length}: ${maskEmail(account.email)}`);
      console.log(`==================================================`);

      const result = await loginOneAccount(account);
      if (result.success) {
        successCount++;
        if (result.logoutOk) logoutOkCount++;
      } else {
        failCount++;
      }

      // 账号间冷却（匹配 Python 的 5 秒冷却）
      if (i < accounts.length - 1) {
        console.log(`⏳ 账号间冷却 5 秒...`);
        await wait(5000);
      }
    }

    // 汇总结果
    const summary = [
      `📌 批量登录完成汇总`,
      `总账号数：${accounts.length}`,
      `登录成功：${successCount}`,
      `登录失败：${failCount}`,
      `退出成功：${logoutOkCount}/${successCount}`
    ].join('\n');
    
    console.log(`\n${summary}`);

    // 发送汇总通知（所有有 TG 配置的账号）
    const tgDests = new Set();
    accounts.forEach(acc => {
      if (acc.tgToken && acc.tgChat) {
        tgDests.add(JSON.stringify([acc.tgToken, acc.tgChat]));
      }
    });

    for (const destStr of tgDests) {
      const [token, chatId] = JSON.parse(destStr);
      await sendTelegramMessage(token, chatId, summary);
    }

  } catch (error) {
    console.error(`💥 主流程异常: ${error.message}`);
    process.exit(1);
  }
}

// 执行主流程
main();
