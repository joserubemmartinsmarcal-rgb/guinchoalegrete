const {chromium}=require('playwright');const path=require('path');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1350}});
await p.goto('file://'+path.resolve(__dirname,'post.html'));await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(800);
await p.locator('#a').screenshot({path:path.join(__dirname,'post-guincheiro-volta-com-frete.png')});
await p.locator('#b').screenshot({path:path.join(__dirname,'post-cliente-voce-diz-quanto-paga.png')});await b.close()})();
