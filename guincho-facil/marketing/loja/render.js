const {chromium}=require('playwright');const path=require('path');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+path.resolve(__dirname,'loja.html'));await p.evaluate(()=>document.fonts.ready);
for(const id of ['s1','s2','s3','s4','s5','fg']){await p.evaluate(id=>document.querySelectorAll('.s,.f').forEach(e=>e.style.display=e.id==id?'block':'none'),id);await p.waitForTimeout(300);
await p.locator('#'+id).screenshot({path:path.join(__dirname,(id=='fg'?'destaque-1024x500':'print-'+id.slice(1))+'.png')});}await b.close()})();
