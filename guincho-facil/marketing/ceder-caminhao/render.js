const { chromium } = require('playwright'); const path = require('path');
const nomes = ['ceder-1','ceder-2','ceder-3','ceder-4','ceder-5'];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
  await p.goto('file://' + path.resolve(__dirname, 'carrossel.html')); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
  const s = await p.$$('section');
  for (let i = 0; i < s.length; i++) {
    await p.evaluate(k => document.querySelectorAll('section').forEach((x, j) => x.style.display = j === k ? '' : 'none'), i);
    await s[i].screenshot({ path: path.join(__dirname, nomes[i] + '.png') });
  }
  await b.close();
})();
