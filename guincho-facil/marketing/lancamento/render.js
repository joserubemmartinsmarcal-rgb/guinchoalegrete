const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch();
  for (const [arq, pref, w, h] of [['04-carrossel.html', '04-carrossel-', 1080, 1350], ['05-folheto-oficinas.html', '05-folheto-oficinas', 1240, 1754]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('file://' + path.resolve(__dirname, arq)); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
    const s = await p.$$('section,.a4');
    for (let i = 0; i < s.length; i++) {
      await p.evaluate(k => document.querySelectorAll('section,.a4').forEach((x, j) => x.style.display = j === k ? '' : 'none'), i);
      await s[i].screenshot({ path: path.join(__dirname, s.length > 1 ? `${pref}${i + 1}.png` : `${pref}.png`) });
    }
  }
  await b.close();
})();
