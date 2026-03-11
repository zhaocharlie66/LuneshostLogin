const puppeteer=require("puppeteer-extra")
const Stealth=require("puppeteer-extra-plugin-stealth")

const {sleep,rand,humanType,randomMouse}=require("./human")
const UA=require("./user_agents")
const sendTG=require("./telegram")

puppeteer.use(Stealth())

const LOGIN_URL="https://betadash.lunes.host/login?next=/"

function log(tag,msg){

console.log(`[${tag}] ${msg}`)

}

function randomUA(){

return UA[Math.floor(Math.random()*UA.length)]

}

function parseAccounts(){

const raw=process.env.ACCOUNTS_BATCH||""

if(!raw.trim())throw new Error("缺少 ACCOUNTS_BATCH")

const arr=[]

for(const line of raw.split("\n")){

const l=line.trim()

if(!l||l.startsWith("#"))continue

const p=l.split(",")

arr.push({

email:p[0],
pass:p[1]

})

}

return arr
}

async function saveHTML(page,name){

const html=await page.content()

require("fs").writeFileSync(
`debug_${name}.html`,
html
)

}

async function screenshot(page,name){

await page.screenshot({

path:`debug_${name}.png`,
fullPage:true

})

}

async function detectCloudflare(page){

const title=await page.title()

if(title.includes("Just a moment")){

log("CF","Cloudflare challenge")

return true

}

return false
}

async function detectTurnstile(page){

try{

await page.waitForSelector(
"iframe[src*='turnstile']",
{timeout:5000}
)

log("TURNSTILE","发现 Turnstile")

return true

}catch{

return false
}

}

async function waitTurnstile(page){

log("TURNSTILE","等待验证")

for(let i=0;i<30;i++){

const exist=await page.evaluate(()=>{

return !!document.querySelector(
"iframe[src*='turnstile']"
)

})

if(!exist){

log("TURNSTILE","验证通过")

return true

}

await sleep(2000)

}

log("TURNSTILE","验证失败")

return false
}

async function launch(){

log("INFO","启动浏览器")

return await puppeteer.launch({

headless:true,

args:[

"--no-sandbox",
"--disable-setuid-sandbox",
"--disable-dev-shm-usage"

]

})

}

async function loginOne(acc){

const browser=await launch()

const page=await browser.newPage()

page.on("console",msg=>{
console.log("[PAGE]",msg.text())
})

page.on("requestfailed",req=>{
console.log("[REQUEST_FAIL]",req.url())
})

await page.setUserAgent(randomUA())

await page.goto(LOGIN_URL,{
waitUntil:"networkidle2",
timeout:60000
})

log("INFO","当前URL "+page.url())

if(await detectCloudflare(page)){

await screenshot(page,"cloudflare")

await saveHTML(page,"cloudflare")

}

await page.waitForSelector("#email")

log("INFO","输入账号")

await humanType(page,"#email",acc.email)

log("INFO","输入密码")

await humanType(page,"#password",acc.pass)

await sleep(rand(1000,3000))

log("INFO","点击登录")

await page.click("button[type=submit]")

await sleep(3000)

if(await detectTurnstile(page)){

const ok=await waitTurnstile(page)

if(!ok){

await screenshot(page,"turnstile_fail")

await saveHTML(page,"turnstile_fail")

await browser.close()

return{ok:false}

}

}

await sleep(5000)

log("INFO","检测登录状态")

try{

await page.waitForSelector(
"a[href='/logout']",
{timeout:15000}
)

log("SUCCESS","登录成功")

}catch{

log("ERROR","未检测到 logout")

await screenshot(page,"login_fail")

await saveHTML(page,"login_fail")

await browser.close()

return{ok:false}

}

await browser.close()

return{ok:true}

}

async function main(){

const accounts=parseAccounts()

let ok=0
let fail=0

for(const acc of accounts){

log("INFO","处理账号 "+acc.email)

let result=null

for(let i=0;i<3;i++){

try{

result=await loginOne(acc)

if(result.ok)break

}catch(e){

log("ERROR",e.message)

}

await sleep(5000)

}

if(result&&result.ok){

ok++

await sendTG("登录成功 "+acc.email)

}else{

fail++

await sendTG("登录失败 "+acc.email)

}

}

log("INFO",`完成 成功:${ok} 失败:${fail}`)

}

main()
