const {chromium}=require('playwright');const path=require('path');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+path.resolve(__dirname,'dia6.html'));await p.evaluate(()=>document.fonts.ready);
for(let i=0;i<6;i++){await p.evaluate(i=>document.querySelectorAll('.s').forEach((e,j)=>e.style.display=j==i?'block':'none'),i);await p.waitForTimeout(400);
 await p.locator('#s'+i).screenshot({path:path.join(__dirname,`dia6-story-${i+1}.png`)});}await b.close()})();
