// Grava um vídeo de demonstração do app (dados de exemplo, backend simulado).
// Uso: node marketing/stories-app/grava.js  (a partir de guincho-facil/)
const fs = require('fs'); const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');
const { chromium, devices } = require(require.resolve('playwright', { paths: [raiz] }));
const { criar } = require(path.join(raiz, 'tests', 'servidor.js'));
const src = fs.readFileSync(path.join(raiz, 'tests', 'e2e.test.js'), 'utf8');
const cab = src.slice(src.indexOf("const SB ="), src.indexOf('let servidor'));
const { backend, SB, UID, UMD } = new Function('path', '__dirname', cab + '\nreturn { backend, SB, UID, UMD };')(path, path.join(raiz, 'tests'));

const espera = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const srv = criar(); await new Promise(r => srv.listen(0, r)); const base = `http://localhost:${srv.address().port}`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', serviceWorkers: 'block', recordVideo: { dir: __dirname, size: { width: 390, height: 664 } } });
  const api = backend();
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(UMD, 'supabase.js')) }));
  await ctx.route(SB + '/**', api.trata);
  await ctx.route(/unpkg\.com|openstreetmap/, r => r.abort());
  const agora = new Date().toISOString(), OUTRO = '44444444-4444-4444-8444-444444444444';
  api.db.perfil = { id: UID, tipo: 'guincheiro', nome: 'João Guincho', cidade: 'Santa Maria', whatsapp: '55999990002', equipamento: 'Plataforma', raio_km: 150, placa: 'ABC1D23', aprovacao: 'aprovado', disponivel: true, is_admin: false, criado_em: agora };
  api.db.pedidos = [
    { id: '81111111-1111-4111-8111-111111111111', autor_id: OUTRO, status: 'aberto', tipo: 'cliente', origem: 'São Pedro do Sul', destino: 'Alegrete', veiculo: 'Gol 2015', veiculo_tipo: 'carro', condicao: 'nao_anda', data_servico: agora.slice(0, 10), criado_em: agora, valor_oferecido: 380 },
    { id: '83333333-3333-4333-8333-333333333333', autor_id: OUTRO, prestador_id: UID, status: 'concluido', tipo: 'cliente', origem: 'Alegrete', destino: 'Uruguaiana', veiculo: 'Onix 2020', valor_combinado: 620, nota: 5, concluido_em: agora, criado_em: agora }];
  api.db.retornos = [{ id: '84444444-4444-4444-8444-444444444444', guincheiro_id: UID, sentido: 'retorno', origem: 'Alegrete', destino: 'Santa Maria', saida: new Date(Date.now() + 4 * 36e5).toISOString(), equipamento: 'Plataforma', vagas: 1, status: 'ativo' }];
  const p = await ctx.newPage();
  const legenda = t => p.evaluate(t => { let d = document.getElementById('leg'); if (!d) { d = document.createElement('div'); d.id = 'leg';
    d.style.cssText = 'position:fixed;left:12px;right:12px;top:70px;z-index:999;background:#1E40AF;color:#fff;font:800 20px Inter Tight,sans-serif;padding:12px 14px;border-radius:14px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.35)'; document.body.appendChild(d); }
    d.textContent = t; d.style.display = t ? '' : 'none'; }, t);
  await p.goto(base + '/app'); await espera(800);
  await p.locator('#em').pressSequentially('joao@guincho.com', { delay: 40 }); await p.locator('#se').pressSequentially('segredo123', { delay: 40 });
  await p.locator('#btL').click(); await p.locator('.novo-pedido').waitFor(); await legenda('Frete perto de você, com o valor'); await espera(2500);
  await p.mouse.wheel(0, 500); await legenda('Sua volta, seu mês, a rede'); await espera(2500); await p.mouse.wheel(0, -500); await espera(600);
  // chamado urgente
  api.db.pedidos.push({ id: 'a1111111-1111-4111-8111-111111111111', autor_id: OUTRO, status: 'aberto', tipo: 'cliente', origem: 'Alegrete', destino: 'Uruguaiana', veiculo: 'S10 2019', veiculo_tipo: 'caminhonete', condicao: 'nao_anda', valor_oferecido: 300, despacho_ate: new Date(Date.now() + 170e3).toISOString(), criado_em: agora });
  await legenda(''); await p.evaluate(() => despVerificar()); await p.locator('#chamado').waitFor(); await espera(2600);
  await p.locator('#chOk').click(); await p.waitForURL(/#pedido\//); await legenda('Chamado aceito em 1 toque'); await espera(2200);
  // vistoria
  await p.goto(base + '/app#vistoria/nova/a1111111-1111-4111-8111-111111111111'); await p.locator('.vs-fotos').waitFor(); await legenda('Vistoria com fotos'); await espera(800);
  const img = fs.readFileSync(path.join(raiz, 'public', 'assets', 'rota-sol.jpg'));
  for (const s of ['frente', 'traseira', 'esquerda', 'direita']) { await p.locator(`.vs-foto[data-slot=${s}] input`).setInputFiles({ name: s + '.jpg', mimeType: 'image/jpeg', buffer: img }); await espera(350); }
  await espera(900); await p.locator('#vsCarro').scrollIntoViewIfNeeded(); await legenda('Marque as avarias no desenho'); await espera(700);
  const c = await p.locator('#vsCarro').boundingBox();
  await p.mouse.click(c.x + c.width * .3, c.y + c.height * .22); await espera(500); await p.mouse.click(c.x + c.width * .72, c.y + c.height * .7); await espera(1200);
  await p.locator('#vsNome').scrollIntoViewIfNeeded(); await p.locator('#vsNome').pressSequentially('Maria Silva', { delay: 50 });
  await p.locator('#vsCanvas').scrollIntoViewIfNeeded(); await legenda('Cliente assina com o dedo'); await espera(500);
  const a = await p.locator('#vsCanvas').boundingBox();
  await p.mouse.move(a.x + 30, a.y + 120); await p.mouse.down(); await p.mouse.move(a.x + 120, a.y + 60, { steps: 15 }); await p.mouse.move(a.x + 200, a.y + 130, { steps: 15 }); await p.mouse.move(a.x + 290, a.y + 70, { steps: 15 }); await p.mouse.up();
  await espera(1800); await legenda('GF · O seu caminhão nunca mais volta vazio'); await espera(2500);
  const v = p.video(); await ctx.close(); fs.renameSync(await v.path(), path.join(__dirname, 'gravacao.webm'));
  await b.close(); srv.close();
})();
