const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
  await p.goto('file://' + path.resolve(__dirname, 'fluxo.html')); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
  await p.locator('.p').screenshot({ path: path.join(__dirname, 'fluxo-atendimento.png') });
  await b.close();
})();
