const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const WEBSITE = process.env.WEBSITE_URL;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

function sleep(ms){
  return new Promise(r=>setTimeout(r,ms));
}

async function simulateHuman(page){

  console.log("[HUMAN] 模拟用户行为");

  await page.mouse.move(200,200);
  await sleep(500);

  await page.mouse.move(400,400);
  await sleep(500);

  await page.mouse.wheel({deltaY:300});

  await sleep(1000);

}

async function detectTurnstile(page){

  const exist = await page.evaluate(()=>{

    if(document.querySelector('[name="cf-turnstile-response"]'))
      return true;

    if(document.querySelector('label.cb-lb input[type="checkbox"]'))
      return true;

    if(document.querySelector('#success-text'))
      return true;

    return false;

  });

  return exist;

}

async function handleTurnstile(page){

  console.log("[TURNSTILE] 检测 Turnstile");

  const timeout = 60000;
  const start = Date.now();

  while(Date.now() - start < timeout){

    const state = await page.evaluate(()=>{

      const result={
        success:false,
        token:false,
        checkbox:false
      };

      const success=document.querySelector("#success-text");

      if(success && success.innerText.includes("成功")){
        result.success=true;
      }

      const token=document.querySelector('[name="cf-turnstile-response"]');

      if(token && token.value && token.value.length>20){
        result.token=true;
      }

      const checkbox=document.querySelector('label.cb-lb input[type="checkbox"]');

      if(checkbox){
        result.checkbox=true;
      }

      return result;

    });

    if(state.success){
      console.log("[TURNSTILE] success 状态");
      return true;
    }

    if(state.token){
      console.log("[TURNSTILE] token 已生成");
      return true;
    }

    if(state.checkbox){

      console.log("[TURNSTILE] 需要点击 checkbox");

      const checkbox = await page.$('label.cb-lb input[type="checkbox"]');

      if(checkbox){

        await checkbox.click();

        console.log("[TURNSTILE] checkbox 已点击");

        await sleep(3000);

      }

    }

    await sleep(1500);

  }

  throw new Error("Turnstile 验证超时");

}

async function login(){

  const browser = await puppeteer.launch({

    headless:true,

    args:[
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]

  });

  const page = await browser.newPage();

  page.setDefaultTimeout(60000);

  await page.setUserAgent(

    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

  );

  try{

    console.log("[INFO] 打开登录页面");

    await page.goto(WEBSITE,{
      waitUntil:"networkidle2"
    });

    await simulateHuman(page);

    console.log("[INFO] 输入账号密码");

    await page.waitForSelector("#email");

    await page.type("#email",USERNAME,{delay:50});
    await page.type("#password",PASSWORD,{delay:50});

    const hasTurnstile = await detectTurnstile(page);

    if(hasTurnstile){

      console.log("[INFO] 发现 Turnstile");

      await simulateHuman(page);

      await handleTurnstile(page);

    }else{

      console.log("[INFO] 未检测到 Turnstile");

    }

    console.log("[INFO] 点击 Submit");

    await page.click('button[type="submit"]');

    await page.waitForNavigation({
      waitUntil:"networkidle2",
      timeout:30000
    });

    const url=page.url();

    console.log("[INFO] 当前页面:",url);

    if(url.includes("login")){

      await page.screenshot({
        path:"login_failed.png",
        fullPage:true
      });

      throw new Error("仍然停留在登录页");

    }

    console.log("[SUCCESS] 登录成功");

  }catch(err){

    console.error("[ERROR]",err.message);

    await page.screenshot({
      path:"error.png",
      fullPage:true
    });

    throw err;

  }finally{

    await browser.close();

  }

}

login();
