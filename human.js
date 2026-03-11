function sleep(ms){
return new Promise(r=>setTimeout(r,ms))
}

function rand(min,max){
return Math.floor(Math.random()*(max-min)+min)
}

async function humanType(page,selector,text){

for(const c of text){

await page.type(selector,c)

await sleep(rand(80,180))

}

}

async function randomMouse(page){

for(let i=0;i<12;i++){

await page.mouse.move(
rand(0,1200),
rand(0,800),
{steps:rand(10,40)}
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
