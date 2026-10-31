const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
  await p.goto('file://' + path.resolve(__dirname, 'carrossel.html'));
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
  const s = await p.$$('section');
  for (let i = 0; i < s.length; i++) await s[i].screenshot({ path: path.join(__dirname, `gf-antecipacao-${i + 1}.png`) });
  console.log('fonte:', await p.evaluate(() => document.fonts.check('800 40px "Inter Tight"')));
  await b.close();
})();
