const {chromium}=require('playwright');const path=require('path');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+path.resolve(__dirname,'dia7.html'));await p.evaluate(()=>document.fonts.ready);
for(const [id,n] of [['post','dia7-post-repasse'],['s1','dia7-story-1'],['s2','dia7-story-2']]){await p.evaluate(id=>document.querySelectorAll('.p,.s').forEach(e=>e.style.display=e.id==id?'block':'none'),id);await p.waitForTimeout(400);
await p.locator('#'+id).screenshot({path:path.join(__dirname,n+'.png')});}await b.close()})();
