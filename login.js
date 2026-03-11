const puppeteer=require("puppeteer-extra")
const Stealth=require("puppeteer-extra-plugin-stealth")

const UA=require("./user_agents")
const sendTG=require("./telegram")
const {sleep,rand,humanType,randomMouse}=require("./human")

puppeteer.use(Stealth())

const LOGIN_URL="https://betadash.lunes.host/login?next=/"
const HOME_URL="https://betadash.lunes.host/"

function randomUA(){

return UA[Math.floor(Math.random()*UA.length)]

}

function parseAccounts(){

const raw=process.env.ACCOUNTS_BATCH||""

if(!raw.trim()){

throw new Error("缺少 ACCOUNTS_BATCH")

}

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

async function detectTurnstile(page){

try{

await page.waitForSelector(
"iframe[src*='turnstile']",
{timeout:8000}
)

return true

}catch{

return false
}

}

async function waitTurnstile(page){

for(let i=0;i<40;i++){

const exist=await page.evaluate(()=>{

return !!document.querySelector("iframe[src*='turnstile']")

})

if(!exist){

return true

}

await sleep(2000)

}

return false
}

async function extractServer(page){

try{

const el=await page.$("a.server-card")

if(!el)return null

const href=await page.evaluate(e=>e.href,el)

const m=href.match(/servers\/(\d+)/)

if(m)return m[1]

}catch{}

return null
}

async function screenshot(page,name){

try{

await page.screenshot({

path:`debug_${name}.png`

})

}catch{}
}

async function launchBrowser(){

return await puppeteer.launch({

headless:true,

args:[

"--no-sandbox",
"--disable-setuid-sandbox",
"--disable-dev-shm-usage",
"--disable-blink-features=AutomationControlled"

]

})

}

async function loginOne(acc){

const browser=await launchBrowser()

const page=await browser.newPage()

await page.setUserAgent(randomUA())

await page.setViewport({
width:1280,
height:800
})

await page.goto(LOGIN_URL,{
waitUntil:"networkidle2"
})

await randomMouse(page)

await page.waitForSelector("#email")

await humanType(page,"#email",acc.email)

await humanType(page,"#password",acc.pass)

await sleep(rand(1000,3000))

await page.click("button[type=submit]")

if(await detectTurnstile(page)){

console.log("检测到 Turnstile")

const ok=await waitTurnstile(page)

if(!ok){

await screenshot(page,"turnstile_fail")

await browser.close()

return{
ok:false
}

}

}

await sleep(5000)

let success=false

try{

await page.waitForSelector(
"a[href='/logout']",
{timeout:10000}
)

success=true

}catch{}

if(!success){

await screenshot(page,"login_fail")

await browser.close()

return{
ok:false
}

}

const server=await extractServer(page)

if(server){

await page.goto(
`https://betadash.lunes.host/servers/${server}`
)

await sleep(4000)

}

await page.goto(HOME_URL)

await sleep(3000)

try{

await page.click("a[href='/logout']")

await sleep(2000)

}catch{}

await browser.close()

return{
ok:true,
server
}

}

async function main(){

const accounts=parseAccounts()

let ok=0
let fail=0

for(const acc of accounts){

console.log("处理账号",acc.email)

let result=null

for(let i=0;i<3;i++){

try{

result=await loginOne(acc)

if(result.ok)break

}catch(e){

console.log("异常",e.message)

}

await sleep(5000)

}

if(result&&result.ok){

ok++

const msg=`✅ 登录成功
账号:${acc.email}
Server:${result.server||"none"}`

console.log(msg)

await sendTG(msg)

}else{

fail++

const msg=`❌ 登录失败
账号:${acc.email}`

console.log(msg)

await sendTG(msg)

}

await sleep(rand(4000,8000))

}

console.log(`完成 成功:${ok} 失败:${fail}`)

}

main()
