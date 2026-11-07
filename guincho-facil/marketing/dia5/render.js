const {chromium}=require('playwright');const path=require('path');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+path.resolve(__dirname,'dia5.html'));await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(800);
for(const [id,n] of [['post','dia5-post-frota'],['s1','dia5-story-1'],['s2','dia5-story-2'],['s3','dia5-story-3']]){
 await p.evaluate(id=>document.querySelectorAll('.p,.s').forEach(e=>e.style.display=e.id==id?'block':'none'),id);await p.waitForTimeout(300);
 await p.locator('#'+id).screenshot({path:path.join(__dirname,n+'.png')});}await b.close()})();
