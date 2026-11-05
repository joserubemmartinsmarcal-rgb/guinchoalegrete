const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1320, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto('file://' + path.resolve(__dirname, 'temas-amarelo.html')); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(__dirname, 'amarelo-lado-a-lado.png'), fullPage: true });
  const t = await p.$$('.tela'); const n = ['amarelo-guincheiro-noite', 'amarelo-guincheiro-dia', 'amarelo-cliente'];
  for (let i = 0; i < t.length; i++) await t[i].screenshot({ path: path.join(__dirname, '' + n[i] + '.png') });
  await b.close();
})();
