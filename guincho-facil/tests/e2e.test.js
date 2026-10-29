// Testes de navegador (Playwright, tela de celular) do site e do app.
// O Supabase é simulado em memória pela interceptação de rede: as regras de
// permissão reais são cobertas por tests/sql/fluxo.sql no banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium, devices } = require('playwright');
const { criar } = require('./servidor.js');

const SB = 'https://rubzloqnfcuumaejfuuz.supabase.co';
const UMD = path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd');
const UID = '11111111-1111-4111-8111-111111111111';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp: 4102444800, email: 'cliente@teste.dev' })}.assinatura`;

// backend falso: guarda perfil e pedidos; registra chamadas para conferência
function backend() {
  const db = { perfil: null, pedidos: [], lista: [], chamadas: [], falharPedidos: false };
  const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) });
  async function trata(route) {
    const req = route.request(); const url = new URL(req.url()); const m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const corpo = req.postData() ? JSON.parse(req.postData()) : null;
    db.chamadas.push(`${m} ${url.pathname}`);
    const objeto = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (url.pathname === '/auth/v1/token') {
      if (corpo.password !== 'segredo123') return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return json(route, 200, { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r',
        user: { id: UID, aud: 'authenticated', role: 'authenticated', email: corpo.email } });
    }
    if (url.pathname === '/auth/v1/user') return json(route, 200, { id: UID, aud: 'authenticated', role: 'authenticated', email: 'cliente@teste.dev' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (url.pathname === '/rest/v1/rpc/gf_meu_perfil') return json(route, 200, db.perfil);
    if (url.pathname === '/rest/v1/rpc/gf_salvar_perfil') {
      const p = corpo.p;
      db.perfil = { id: UID, ...p, whatsapp: String(p.whatsapp), raio_km: Number(p.raio_km || 100), placa: p.placa ? p.placa.toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
        aprovacao: p.tipo === 'guincheiro' ? 'pendente' : 'aprovado', disponivel: false, is_admin: false, criado_em: new Date().toISOString() };
      return json(route, 200, db.perfil);
    }
    if (url.pathname === '/rest/v1/rpc/gf_reputacao') return json(route, 200, []);
    if (url.pathname === '/rest/v1/gf_pedidos') {
      if (db.falharPedidos) return json(route, 500, { message: 'falha simulada' });
      if (m === 'POST') {
        db.ultimoInsert = corpo;
        const p ={ ...(Array.isArray(corpo) ? corpo[0] : corpo), id: '22222222-2222-4222-8222-22222222222' + db.pedidos.length, autor_id: UID, status: 'aberto',
          prestador_id: null, valor_combinado: null, criado_em: new Date().toISOString(), gf_propostas: [], autor: { nome: db.perfil.nome }, prestador: null };
        db.pedidos.push(p);
        return json(route, 201, objeto ? { id: p.id } : [{ id: p.id }]);
      }
      if (m === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '*/0', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
      const id = url.searchParams.get('id'); let rows = db.pedidos;
      if (id) rows = rows.filter(p => `eq.${p.id}` === id);
      return json(route, 200, objeto ? rows[0] || null : rows);
    }
    if (url.pathname === '/rest/v1/gf_lista_espera') { db.lista.push(corpo); return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } }); }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (m === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '*/0', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
      return json(route, 200, objeto ? null : []);
    }
    return json(route, 404, { message: 'rota não simulada: ' + url.pathname });
  }
  return { db, trata };
}

let servidor, base, navegador;
test.before(async () => {
  servidor = criar(); await new Promise(r => servidor.listen(0, r));
  base = `http://localhost:${servidor.address().port}`;
  navegador = await chromium.launch();
});
test.after(async () => { await navegador?.close(); servidor?.close(); });

async function abrir(api) {
  const ctx = await navegador.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/*', route => {
    const nome = path.basename(new URL(route.request().url()).pathname).replace('supabase.min.js', 'supabase.js');
    route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(UMD, nome)) });
  });
  await ctx.route(SB + '/**', api.trata);
  await ctx.route(/fonts\.googleapis|fonts\.gstatic|unpkg\.com|openstreetmap/, route => route.abort());
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.addInitScript(() => { window.open = (u) => { window.__aberto = u; return null; }; });
  return { ctx, page, erros };
}
const semRolagemLateral = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const toast = page => page.locator('#toast');
// GF_PRINTS=<pasta> salva capturas de tela para revisão visual
const foto = (page, nome) => process.env.GF_PRINTS ? page.screenshot({ path: path.join(process.env.GF_PRINTS, nome + '.png'), fullPage: true }) : null;

test('site: slogan, caminhos e lista de espera com validação', async () => {
  const api = backend(); const { ctx, page, erros } = await abrir(api);
  await page.goto(base + '/');
  assert.match(await page.locator('h1').innerText(), /nunca mais volta vazio/);
  assert.equal(await page.locator('a[href="/app#pedido/novo"]').first().isVisible(), true);
  assert.ok(await semRolagemLateral(page), 'sem rolagem lateral no celular');
  await foto(page, '1-site');
  await page.locator('#fLista button[type=submit]').click();
  assert.match(await page.locator('#lErro').innerText(), /nome e cidade/);
  await page.fill('#lNome', 'João Guincheiro'); await page.fill('#lCidade', 'Alegrete'); await page.fill('#lZap', '55999990001');
  await page.locator('#fLista button[type=submit]').click();
  assert.match(await page.locator('#lErro').innerText(), /autorização/);
  await page.check('input[name=lgpd]');
  await page.locator('#fLista button[type=submit]').click();
  await page.locator('#lOk').waitFor({ state: 'visible' });
  assert.equal(api.db.lista.length, 1);
  assert.equal(api.db.lista[0].whatsapp, '55999990001');
  assert.equal(api.db.lista[0].aceite_lgpd, true);
  assert.match(await page.evaluate(() => window.__aberto), /^https:\/\/wa\.me\/5555997118847/);
  await page.goto(base + '/privacidade');
  assert.match(await page.locator('h1').innerText(), /Privacidade/);
  assert.deepEqual(erros, []);
  await ctx.close();
});

test('app cliente: login, perfil, pedido e persistência após recarregar', async () => {
  const api = backend(); const { ctx, page, erros } = await abrir(api);
  await page.goto(base + '/app');
  await page.locator('#fL').waitFor();
  await foto(page, '2-login');
  assert.match(await page.locator('h2').innerText(), /nunca mais volta vazio/);
  await page.fill('#em', 'nao-e-email'); await page.locator('#btL').click();
  await page.waitForFunction(() => /e-mail válido/.test(document.querySelector('#toast').textContent));
  await page.fill('#em', 'cliente@teste.dev'); await page.fill('#se', 'errada1'); await page.locator('#btL').click();
  await page.waitForFunction(() => /incorretos/.test(document.querySelector('#toast').textContent));
  await page.fill('#se', 'segredo123'); await page.locator('#btL').click();

  await page.locator('#fP').waitFor();
  assert.equal(await page.locator('#bG').isHidden(), true, 'campos de guincheiro escondidos para cliente');
  await foto(page, '3-perfil');
  await page.fill('#pn', 'Maria Cliente'); await page.fill('#pc', 'Alegrete'); await page.fill('#pz', '55999990001');
  await page.locator('#fP button').click();
  await page.waitForFunction(() => /privacidade/.test(document.querySelector('#toast').textContent));
  await page.check('input[name=lgpd]'); await page.locator('#fP button').click();

  await page.getByRole('link', { name: 'Pedir transporte de veículo' }).waitFor();
  assert.match(await page.locator('#titulo').innerText(), /Olá, Maria/);
  assert.equal(await page.locator('#nav a').count(), 4);
  await foto(page, '4-inicio-cliente');
  assert.ok(await semRolagemLateral(page));

  await page.getByRole('link', { name: 'Pedir transporte de veículo' }).click();
  await page.locator('#fN').waitFor();
  await page.fill('#nd', 'Alegrete'); await page.fill('#nv', 'Gol 2015');
  await page.locator('#fN button').click();
  await page.waitForFunction(() => /diferentes/.test(document.querySelector('#toast').textContent));
  await page.fill('#nd', 'Santa Maria'); await page.fill('#npl', 'xx'); await page.locator('#fN button').click();
  await page.waitForFunction(() => /Placa inválida/.test(document.querySelector('#toast').textContent));
  await page.fill('#npl', 'iyz-1234');
  await foto(page, '5-novo-pedido');
  assert.match(await page.locator('#nkm').innerText(), /Distância estimada/);
  await page.locator('#fN button').click();

  await page.waitForURL(/#pedido\//);
  await page.locator('.trajeto').waitFor();
  assert.match(await page.locator('.trajeto').innerText(), /Alegrete › Santa Maria/);
  assert.match(await page.locator('#v').innerText(), /Ainda sem propostas/);
  assert.match(await page.locator('.passos li.atual').innerText(), /Aguardando propostas/);
  await foto(page, '6-pedido');
  const enviado = api.db.pedidos[0];
  assert.equal(enviado.veiculo, 'Gol 2015'); assert.equal(enviado.condicao, 'nao_anda');
  for (const campo of ['status', 'prestador_id', 'valor_combinado', 'autor_id']) assert.ok(!(campo in api.db.ultimoInsert), `app não envia ${campo}`);
  assert.equal(api.db.ultimoInsert.placa, 'iyz-1234', 'placa vai como digitada; o banco normaliza');

  await page.reload();
  await page.locator('.trajeto').waitFor();
  assert.match(await page.locator('.trajeto').innerText(), /Alegrete › Santa Maria/, 'pedido continua após recarregar');
  await page.locator('#nav a[data-r=pedidos]').click();
  await page.locator('.item .trajeto').waitFor();
  assert.match(await page.locator('.resumo').innerText(), /1\s*no período/);
  await foto(page, '7-meus-pedidos');
  assert.ok(await semRolagemLateral(page));
  assert.deepEqual(erros, []);
  await ctx.close();
});

test('app guincheiro: validação de placa e cadastro em análise', async () => {
  const api = backend(); const { ctx, page, erros } = await abrir(api);
  await page.goto(base + '/app');
  await page.fill('#em', 'g@teste.dev'); await page.fill('#se', 'segredo123'); await page.locator('#btL').click();
  await page.locator('#fP').waitFor();
  await page.locator('#fP .seg').getByText('Sou guincheiro').click();
  assert.equal(await page.locator('#bG').isVisible(), true);
  await page.fill('#pn', 'João Guincho'); await page.fill('#pc', 'Santa Maria'); await page.fill('#pz', '55999990002');
  await page.fill('#pl', '12345'); await page.check('input[name=lgpd]');
  await page.locator('#fP button').click();
  await page.waitForFunction(() => /Placa inválida/.test(document.querySelector('#toast').textContent));
  await page.fill('#pl', 'abc1d23'); await page.selectOption('#pk', 'leve');
  await page.locator('#fP button').click();
  await page.locator('.aviso.am').waitFor();
  assert.match(await page.locator('.aviso.am').innerText(), /Em análise/);
  assert.match(await page.locator('.barra-prog').getAttribute('aria-label'), /80%/);
  assert.equal(await page.locator('#nav a').count(), 5);
  await foto(page, '8-guincheiro-analise');
  await page.locator('#nav a[data-r=buscar]').click();
  await page.locator('.aviso.am').waitFor();
  await page.locator('#nav a[data-r=servicos]').click();
  await page.locator('[data-chips=aba] button[data-v=quanto]').click();
  await page.locator('#fC').waitFor();
  await page.fill('#cv', '850'); await page.fill('#ck', '320');
  await page.waitForFunction(() => /R\$\s*111,00/.test(document.querySelector('#cRes').textContent));
  assert.match(await page.locator('#cRes').innerText(), /sobra estimada/);
  await foto(page, '9-calculadora');
  assert.ok(!api.db.chamadas.some(c => c.startsWith('POST /rest/v1/rpc/gf_enviar_proposta')));
  assert.deepEqual(erros, []);
  await ctx.close();
});

test('app: erro do servidor mostra tela de erro com "Tentar de novo"', async () => {
  const api = backend();
  api.db.perfil = { id: UID, tipo: 'cliente', nome: 'Maria', cidade: 'Alegrete', whatsapp: '55999990001', aprovacao: 'aprovado', is_admin: false };
  const { ctx, page } = await abrir(api);
  await page.goto(base + '/app');
  await page.fill('#em', 'cliente@teste.dev'); await page.fill('#se', 'segredo123'); await page.locator('#btL').click();
  await page.getByRole('link', { name: 'Pedir transporte de veículo' }).waitFor();
  api.db.falharPedidos = true;
  await page.locator('#nav a[data-r=pedidos]').click();
  await page.locator('#btRetry').waitFor();
  assert.match(await page.locator('.erro-tela').innerText(), /Não foi possível carregar/);
  api.db.falharPedidos = false;
  await page.locator('#btRetry').click();
  await page.locator('.resumo').waitFor();
  await ctx.close();
});
