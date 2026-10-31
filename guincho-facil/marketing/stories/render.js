const { chromium } = require('playwright'); const path = require('path');
const nomes = ['story-1-sobre', 'story-2-como-funciona', 'story-3-antecipe', 'story-4-guincheiro', 'story-5-motorista', 'story-6-contato'];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + path.resolve(__dirname, 'stories.html')); await p.waitForTimeout(500);
  const s = await p.$$('section');
  for (let i = 0; i < s.length; i++) {
    await p.evaluate(k => document.querySelectorAll('section').forEach((x, j) => x.style.display = j === k ? '' : 'none'), i);
    await s[i].screenshot({ path: path.join(__dirname, nomes[i] + '.png') });
  }
  await b.close();
})();
