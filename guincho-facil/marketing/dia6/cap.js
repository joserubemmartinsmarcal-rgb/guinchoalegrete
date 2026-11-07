const {chromium,devices}=require('playwright');(async()=>{const b=await chromium.launch();const c=await b.newContext({...devices['iPhone 13']});const p=await c.newPage();
await p.goto('https://appdoguincheiro.com/app');await p.waitForTimeout(3000);await p.screenshot({path:'login.png'});await b.close()})();
