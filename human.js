function sleep(ms){
return new Promise(r=>setTimeout(r,ms))
}

function rand(min,max){
return Math.floor(Math.random()*(max-min)+min)
}

async function humanType(page,selector,text){

for(const ch of text){

await page.type(selector,ch)

await sleep(rand(80,180))
}

}

async function randomMouse(page){

const width=1200
const height=800

for(let i=0;i<10;i++){

await page.mouse.move(
rand(0,width),
rand(0,height),
{steps:rand(5,25)}
)

await sleep(rand(50,200))
}

}

module.exports={
sleep,
rand,
humanType,
randomMouse
}
