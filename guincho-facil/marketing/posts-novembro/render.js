const { chromium } = require('playwright'); const path = require('path');
const nomes = ['post-ida-e-volta', 'repasse-1', 'repasse-2', 'repasse-3', 'repasse-4', 'repasse-5', 'passo-a-passo-1', 'passo-a-passo-2', 'passo-a-passo-3', 'passo-a-passo-4', 'passo-a-passo-5', 'passo-a-passo-6'];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
  await p.goto('file://' + path.resolve(__dirname, 'posts.html')); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
  const s = await p.$$('section');
  for (let i = 0; i < s.length; i++) {
    await p.evaluate(k => document.querySelectorAll('section').forEach((x, j) => x.style.display = j === k ? '' : 'none'), i);
    await s[i].screenshot({ path: path.join(__dirname, nomes[i] + '.png') });
  }
  await b.close();
})();
