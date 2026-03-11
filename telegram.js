const axios=require("axios")

async function sendTG(text){

const token=process.env.TG_TOKEN
const chat=process.env.TG_CHAT

if(!token||!chat)return

try{

await axios.post(
`https://api.telegram.org/bot${token}/sendMessage`,
{
chat_id:chat,
text:text,
disable_web_page_preview:true
}
)

}catch(e){

console.log("TG发送失败")

}

}

module.exports=sendTG
