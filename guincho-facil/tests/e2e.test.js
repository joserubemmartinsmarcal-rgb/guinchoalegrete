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
    let corpo = null; try { corpo = req.postData() ? JSON.parse(req.postData()) : null; } catch { corpo = null; } // arquivos (fotos) não são JSON
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
    if (url.pathname === '/rest/v1/rpc/gf_pedir_antecipacao') {
      (db.antec ||= []).push({ ...corpo.p, id: 'a' + db.antec.length, status: 'recebido', guincheiro_id: UID, criado_em: new Date().toISOString() });
      return json(route, 200, 'a0');
    }
    if (url.pathname === '/rest/v1/gf_antecipacoes') return json(route, 200, db.antec || []);
    if (url.pathname === '/rest/v1/gf_avisos') {
      const avisos = db.avisos || [];
      const n = avisos.filter(a => !a.lido_em).length;
      if (m === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `*/${n}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
      return json(route, 200, avisos);
    }
    if (url.pathname === '/rest/v1/rpc/gf_marcar_avisos_lidos') { (db.avisos || []).forEach(a => a.lido_em ||= new Date().toISOString()); return json(route, 200, 1); }
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
      const id = url.searchParams.get('id'), st = url.searchParams.get('status'); let rows = db.pedidos;
      if (id) rows = rows.filter(p => `eq.${p.id}` === id);
      if (st && st.startsWith('eq.')) rows = rows.filter(p => (p.status || 'aberto') === st.slice(3));
      return json(route, 200, objeto ? rows[0] || null : rows);
    }
    if (url.pathname === '/rest/v1/gf_retornos' || url.pathname === '/rest/v1/gf_caminhoes') {
      const tab = url.pathname.endsWith('retornos') ? (db.retornos ||= []) : (db.caminhoes ||= []);
      if (m === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `*/${tab.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
      if (m === 'POST') {
        const x = { ...corpo, id: '33333333-3333-4333-8333-33333333333' + tab.length, status: 'ativo', criado_em: new Date().toISOString() };
        tab.push(x); return json(route, 201, objeto ? { id: x.id } : [{ id: x.id }]);
      }
      const id = url.searchParams.get('id'), dono = url.searchParams.get('guincheiro_id');
      let rows = tab;
      if (id) rows = rows.filter(x => `eq.${x.id}` === id);
      if (dono) rows = rows.filter(x => dono === `eq.${x.guincheiro_id}` || (dono.startsWith('neq.') && dono !== `neq.${x.guincheiro_id}`));
      return json(route, 200, objeto ? rows[0] || null : rows);
    }
    if (url.pathname === '/rest/v1/rpc/gf_atualizar_status') { const p = db.pedidos.find(x => x.id === corpo.p_pedido); if (p) p.status = corpo.p_status; return json(route, 200, null); }
    if (url.pathname.startsWith('/storage/v1/object/sign/gf-vistorias')) {
      if (m === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' },
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAp1BYVYAAAAASUVORK5CYII=', 'base64') });
      return json(route, 200, corpo.paths.map(p => ({ path: p, signedURL: '/object/sign/gf-vistorias/' + p + '?token=t', error: null })));
    }
    if (url.pathname.startsWith('/storage/v1/object/gf-vistorias/')) {
      (db.arquivos ||= []).push(decodeURIComponent(url.pathname.replace('/storage/v1/object/gf-vistorias/', '')));
      return json(route, 200, { Key: 'gf-vistorias/x', Id: 'x' });
    }
    if (url.pathname === '/rest/v1/rpc/gf_salvar_vistoria') {
      const v = { ...corpo.p, guincheiro_id: UID, tipo: 'retirada', recebida_em: new Date().toISOString() };
      db.vistorias = [v]; return json(route, 200, v.id);
    }
    if (url.pathname === '/rest/v1/gf_vistorias') {
      const id = url.searchParams.get('id'), ped = url.searchParams.get('pedido_id');
      const rows = (db.vistorias || []).filter(v => (!id || id === 'eq.' + v.id) && (!ped || ped === 'eq.' + v.pedido_id));
      return json(route, 200, objeto ? rows[0] || null : rows);
    }
    if (url.pathname === '/rest/v1/rpc/gf_enviar_proposta') { (db.propostas ||= []).push(corpo); return json(route, 200, 'p' + db.propostas.length); }
    if (url.pathname === '/rest/v1/rpc/gf_pegar_chamado') { const p = db.pedidos.find(x => x.id === corpo.p_pedido); p.status = 'aceito'; p.prestador_id = UID; p.valor_combinado = p.valor_oferecido; return json(route, 200, null); }
    if (url.pathname === '/rest/v1/rpc/gf_rede_numeros') return json(route, 200, { guincheiros: 42, disponiveis: 17, rotas_ativas: 18, caminhoes: 3, pedidos_7d: 26 });
    if (url.pathname === '/rest/v1/rpc/gf_alcance_pedido') return json(route, 200, { avisados: 12, propostas: 0, minutos_tipicos: 18 });
    if (url.pathname === '/rest/v1/rpc/gf_falar_com_parceiro') { db.contatos = (db.contatos || 0) + 1; return json(route, 200, { nome: 'Pedro Parceiro', whatsapp: '55999991002' }); }
    if (url.pathname === '/rest/v1/rpc/gf_meu_acompanhamento') return json(route, 200, db.acomp || null);
    if (url.pathname === '/rest/v1/rpc/gf_confirmar_chegada') {
      if (corpo.p_codigo !== '4821') return json(route, 400, { code: 'P0001', message: 'Código incorreto. Confira com o cliente.' });
      const p = db.pedidos.find(x => x.id === corpo.p_pedido); p.status = 'no_local'; p.chegada_confirmada_em = new Date().toISOString();
      db.acomp = { ...db.acomp, chegada_confirmada_em: p.chegada_confirmada_em }; return json(route, 200, null);
    }
    if (url.pathname === '/rest/v1/gf_mensagens') return json(route, 200, db.mensagens || []);
    if (url.pathname === '/rest/v1/rpc/gf_enviar_mensagem') {
      (db.mensagens ||= []).push({ id: 'm' + db.mensagens.length, autor_id: UID, texto: corpo.p_texto, criado_em: new Date().toISOString() });
      return json(route, 200, 'm');
    }
    if (url.pathname === '/rest/v1/rpc/gf_contato') return json(route, 200, { nome: 'Carla Cliente', whatsapp: '55999991001' });
    if (url.pathname === '/rest/v1/rpc/gf_gerar_contas_mes') return json(route, 200, 0);
    if (url.pathname === '/rest/v1/gf_contas') {
      const tab = (db.contas ||= []);
      if (m === 'POST') { const x = { ...(Array.isArray(corpo) ? corpo[0] : corpo), id: 'ct' + tab.length, criado_em: new Date().toISOString() }; tab.push(x); return json(route, 201, objeto ? x : [x]); }
      const id = url.searchParams.get('id');
      if (m === 'PATCH') { const x = tab.find(o => 'eq.' + o.id === id); Object.assign(x, corpo); return json(route, 200, objeto ? x : [x]); }
      const st = url.searchParams.get('status');
      const rows = tab.filter(o => (!id || 'eq.' + o.id === id) && (!st || 'eq.' + o.status === st));
      return json(route, 200, objeto ? rows[0] || null : rows);
    }
    if (url.pathname === '/rest/v1/gf_os') {
      const tab = (db.os ||= []);
      if (m === 'POST') { const x = { ...(Array.isArray(corpo) ? corpo[0] : corpo), id: 'os' + tab.length, numero: tab.length + 1, guincheiro_id: UID, pedido_id: null,
        criado_em: new Date().toISOString() }; tab.push(x); return json(route, 201, objeto ? x : [x]); }
      const id = url.searchParams.get('id');
      if (m === 'PATCH') { const x = tab.find(o => 'eq.' + o.id === id); Object.assign(x, corpo); if (x.status === 'pago' && !x.pago_em) x.pago_em = x.data; return json(route, 200, objeto ? x : [x]); }
      if (m === 'DELETE') { db.os = tab.filter(o => 'eq.' + o.id !== id); return json(route, 200, []); }
      const st = url.searchParams.get('status');
      const rows = tab.filter(o => (!id || 'eq.' + o.id === id) && (!st || 'eq.' + o.status === st));
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
  const ctx = await navegador.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
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
  assert.match(await page.locator('#antecipe h2').innerText(), /Receba na hora/);
  assert.equal(await page.locator('a.novo[href="#antecipe"]').isVisible(), true, 'antecipação visível no topo');
  assert.equal(await page.locator('#antecipe a[href="/app#servicos/antecipar"]').count(), 1);
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
  assert.deepEqual(await page.locator('#fP .seg span').allInnerTexts(), ['Preciso transportar', 'Sou guincheiro']);
  await page.fill('#pn', 'Maria Cliente'); await page.fill('#pc', 'Alegrete'); await page.fill('#pz', '55999990001');
  await page.locator('#fP button').click();
  await page.waitForFunction(() => /privacidade/.test(document.querySelector('#toast').textContent));
  await page.check('input[name=lgpd]'); await page.locator('#fP button').click();

  await page.getByRole('link', { name: 'Pedir transporte de veículo' }).waitFor();
  assert.match(await page.locator('#titulo').innerText(), /Olá, Maria/);
  assert.equal(await page.locator('#nav a').count(), 4);
  await foto(page, '4-inicio-cliente');
  // tom escuro: troca no botão do topo e continua depois de recarregar
  assert.equal(await page.evaluate(() => document.body.dataset.tema), 'claro');
  await page.locator('#btTema').click();
  assert.equal(await page.evaluate(() => document.body.dataset.tema), 'escuro');
  await page.reload(); await page.locator('.chamada').waitFor();
  assert.equal(await page.evaluate(() => document.body.dataset.tema), 'escuro');
  await foto(page, '4b-inicio-cliente-escuro');
  await page.locator('#btTema').click();
  assert.equal(await page.evaluate(() => document.body.dataset.tema), 'claro');
  assert.ok(await semRolagemLateral(page));

  await page.getByRole('link', { name: 'Pedir transporte de veículo' }).click();
  await page.locator('#fN').waitFor();
  await page.fill('#nd', 'Alegrete'); await page.fill('#nv', 'Gol 2015'); await page.fill('#nvo', '380');
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
  assert.match(await page.locator('.trajeto').innerText(), /Alegrete\s*Santa Maria/);
  await page.locator('.radar').waitFor();
  assert.match(await page.locator('.radar').innerText(), /Procurando guincheiros/);
  assert.match(await page.locator('.radar').innerText(), /Avisamos 12 guincheiros/);
  assert.match(await page.locator('.radar').innerText(), /~18 min/);
  assert.match(await page.locator('.passos li.atual').innerText(), /Aguardando propostas/);
  await foto(page, '6-pedido');
  const enviado = api.db.pedidos[0];
  assert.equal(enviado.veiculo, 'Gol 2015'); assert.equal(enviado.condicao, 'nao_anda');
  for (const campo of ['status', 'prestador_id', 'valor_combinado', 'autor_id']) assert.ok(!(campo in api.db.ultimoInsert), `app não envia ${campo}`);
  assert.equal(api.db.ultimoInsert.placa, 'iyz-1234', 'placa vai como digitada; o banco normaliza');
  assert.equal(api.db.ultimoInsert.valor_oferecido, 380, 'preço lançado por quem pede');

  await page.reload();
  await page.locator('.trajeto').waitFor();
  assert.match(await page.locator('.trajeto').innerText(), /Alegrete\s*Santa Maria/, 'pedido continua após recarregar');
  await page.locator('#nav a[data-r=pedidos]').click();
  await page.locator('.item .trajeto').waitFor();
  assert.match(await page.locator('.resumo').innerText(), /1\s*no período/);
  await foto(page, '7-meus-pedidos');
  assert.ok(await semRolagemLateral(page));
  // pedido mostra rota no Google Maps
  await page.locator('.item .trajeto').first().click();
  await page.getByRole('link', { name: 'Ver rota no Google Maps' }).waitFor();
  assert.match(await page.getByRole('link', { name: 'Ver rota no Google Maps' }).getAttribute('href'), /google\.com\/maps\/dir\/\?api=1.*origin=Alegrete.*destination=Santa%20Maria/);
  // avisos: sininho com contador, lista e marcar como lidos
  api.db.avisos = [{ id: 'a1', titulo: 'Nova proposta para Alegrete › Santa Maria', corpo: 'Proposta de R$ 450,00', url: '#pedido/' + enviado.id, criado_em: new Date().toISOString(), lido_em: null }];
  await page.evaluate(() => contadores());
  await page.waitForFunction(() => !document.querySelector('#avBadge').hidden && document.querySelector('#avBadge').textContent === '1');
  await page.locator('#btAvisos').click();
  await page.locator('.aviso-item').waitFor();
  assert.match(await page.locator('.aviso-item').innerText(), /Nova proposta/);
  assert.match(await page.locator('#v .aviso').first().innerText(), /avisos/i, 'cartão para ligar os avisos no celular');
  await page.waitForFunction(() => document.querySelector('#avBadge').hidden);
  assert.ok(api.db.chamadas.includes('POST /rest/v1/rpc/gf_marcar_avisos_lidos'));
  await foto(page, '7b-avisos');
  await page.locator('.aviso-item').click();
  await page.waitForURL(/#pedido\//);
  await page.locator('#nav a[data-r=perfil]').click();
  await page.locator('.menu-lista').waitFor();
  assert.match(await page.locator('.menu-lista').innerText(), /Sair da conta/);
  await foto(page, '7c-perfil');
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
  assert.equal(await page.locator('[data-chips=aba] button[data-v=quanto]').count(), 0, 'sem a aba Quanto sobra?');
  assert.ok(!api.db.chamadas.some(c => c.startsWith('POST /rest/v1/rpc/gf_enviar_proposta')));
  // antecipação de recebíveis
  await page.locator('[data-chips=aba] button[data-v=antecipar]').click();
  await page.locator('#fA').waitFor();
  assert.match(await page.locator('.aviso').first().innerText(), /TED/);
  await page.fill('#av', '1.500,00'); await page.fill('#apn', 'Assistência Exemplo');
  await page.fill('#avc', new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10));
  await page.locator('#fA button').click();
  await page.waitForFunction(() => /autorização/.test(document.querySelector('#toast').textContent));
  assert.equal(api.db.antec, undefined, 'sem consentimento não envia');
  await page.check('#fA input[name=consentimento]');
  await page.locator('#fA button').click();
  await page.waitForFunction(() => /Recebido pelo GF/.test(document.querySelector('#v').textContent));
  assert.equal(api.db.antec[0].valor, 1500);
  assert.equal(api.db.antec[0].consentimento, true);
  assert.equal(api.db.antec[0].forma, 'boleto');
  await foto(page, '10-antecipar');
  assert.deepEqual(erros, []);
  await ctx.close();
});

test('app guincheiro aprovado: vaga na rota e caminhão cedido', async () => {
  const api = backend(); const { ctx, page, erros } = await abrir(api);
  const OUTRO = '44444444-4444-4444-8444-444444444444';
  api.db.perfil = { id: UID, tipo: 'guincheiro', nome: 'João Guincho', cidade: 'Santa Maria', whatsapp: '55999990002', equipamento: 'Plataforma',
    raio_km: 100, placa: 'ABC1D23', aprovacao: 'aprovado', disponivel: true, is_admin: false, criado_em: new Date().toISOString() };
  const amanha = new Date(Date.now() + 864e5).toISOString();
  api.db.retornos = [{ id: '55555555-5555-4555-8555-555555555555', guincheiro_id: OUTRO, sentido: 'ida', origem: 'Santa Maria', destino: 'Alegrete',
    saida: amanha, equipamento: 'Plataforma', vagas: 2, status: 'ativo', obs: null, g: { nome: 'Pedro Parceiro', cidade: 'Santa Maria', empresa: null } }];
  api.db.caminhoes = [{ id: '66666666-6666-4666-8666-666666666666', guincheiro_id: OUTRO, cidade: 'Cacequi', raio_km: 200, equipamento: 'Asa-delta',
    com_motorista: true, disponivel_de: amanha.slice(0, 10), disponivel_ate: null, valor: 700, cobranca: 'dia', status: 'ativo', obs: null,
    g: { nome: 'Pedro Parceiro', cidade: 'Cacequi', empresa: null } }];
  await page.goto(base + '/app');
  await page.fill('#em', 'g@teste.dev'); await page.fill('#se', 'segredo123'); await page.locator('#btL').click();
  await page.locator('.menu-lista.duas').waitFor();
  assert.deepEqual(await page.locator('.menu-lista.duas b').allInnerTexts(), ['Tenho vaga no caminhão', 'Ceder meu caminhão', 'Ver vagas e caminhões', 'Repassar um serviço', 'Convidar um colega']);
  assert.match(await page.locator('.anunciar').innerText(), /Anunciar minha volta de hoje/, 'sem rota própria: convite para anunciar');
  assert.match(await page.locator('.rede-faixa').innerText(), /42\s*guincheiros na rede/);
  assert.match(await page.locator('.mes').innerText(), /no mês/);
  await foto(page, '11-inicio-parceiros');
  await page.locator('#btTema').click(); await foto(page, '11b-inicio-guincheiro-escuro'); await page.locator('#btTema').click();
  // vaga de colega: mandar veículo abre repasse preenchido
  await page.locator('.menu-lista.duas a[href="#rotas"]').click();
  await page.locator('[data-chips=parc]').waitFor();
  await foto(page, '12-rotas-vagas');
  await page.locator('a.item[href^="#rota/"]').click();
  await page.locator('#btMandar').waitFor();
  await foto(page, '13-vaga-colega');
  await page.locator('#btMandar').click();
  await page.locator('#fN').waitFor();
  assert.equal(await page.inputValue('#no'), 'Santa Maria');
  assert.equal(await page.inputValue('#nd'), 'Alegrete');
  assert.match(await page.inputValue('#nb'), /vaga de Pedro Parceiro/);
  assert.match(await page.locator('.aviso').first().innerText(), /Repasse para a vaga/);
  await page.goBack();
  await page.locator('#btZapParc').click();
  await page.waitForFunction(() => document.querySelector('#v a.btn.zap'));
  assert.match(await page.evaluate(() => window.__aberto), /wa\.me\/5555999991002/);
  assert.equal(api.db.contatos, 1);
  // caminhões: rede e ceder o meu
  await page.goto(base + '/app#caminhoes');
  await page.locator('a.item[href^="#caminhao/"]').first().waitFor();
  assert.match(await page.locator('#v').innerText(), /Asa-delta em Cacequi/);
  await foto(page, '14-caminhoes');
  await page.locator('a.btn[href="#caminhoes/novo"]').click();
  await page.locator('#fC').waitFor();
  await page.locator('#fC .seg').getByText('Só o caminhão').click();
  await page.fill('#cv', '600'); await page.selectOption('#cb', 'dia');
  await page.fill('#ca', new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  await foto(page, '15-ceder-caminhao');
  await page.locator('#fC button').click();
  await page.waitForURL(/#caminhao\//);
  await page.locator('#btEnc').waitFor();
  const c = api.db.caminhoes.at(-1);
  assert.equal(c.com_motorista, false); assert.equal(c.valor, 600); assert.equal(c.cobranca, 'dia'); assert.equal(c.cidade, 'Santa Maria');
  assert.match(await page.locator('#v').innerText(), /Só o caminhão/);
  // serviço em andamento: avançar etapa com confirmação
  api.db.pedidos.push({ id: '77777777-7777-4777-8777-777777777777', autor_id: OUTRO, prestador_id: UID, status: 'aceito', tipo: 'cliente',
    origem: 'Cacequi', destino: 'Santa Maria', veiculo: 'S10 2019', valor_combinado: 450, criado_em: new Date().toISOString() });
  await page.goto(base + '/app#servicos');
  await page.locator('[data-av]').click();
  await page.locator('#dlg button[value=ok]').click();
  await page.waitForFunction(() => /Atualizado/.test(document.querySelector('#toast').textContent));
  assert.equal(api.db.pedidos.at(-1).status, 'a_caminho');
  assert.deepEqual(erros, []);
  await ctx.close();
});

test('app guincheiro: início com pedido em destaque, serviço em andamento, rota e mês', async () => {
  const api = backend(); const { ctx, page, erros } = await abrir(api);
  const OUTRO = '44444444-4444-4444-8444-444444444444', agora = new Date().toISOString();
  api.db.perfil = { id: UID, tipo: 'guincheiro', nome: 'João Guincho', cidade: 'Santa Maria', whatsapp: '55999990002', equipamento: 'Plataforma',
    raio_km: 150, placa: 'ABC1D23', aprovacao: 'aprovado', disponivel: true, is_admin: false, criado_em: agora };
  api.db.pedidos = [
    { id: '81111111-1111-4111-8111-111111111111', autor_id: OUTRO, status: 'aberto', tipo: 'cliente', origem: 'São Pedro do Sul', destino: 'Alegrete',
      veiculo: 'Gol 2015', veiculo_tipo: 'carro', condicao: 'nao_anda', data_servico: agora.slice(0, 10), criado_em: agora, valor_oferecido: 380 },
    { id: '82222222-2222-4222-8222-222222222222', autor_id: OUTRO, prestador_id: UID, status: 'a_caminho', tipo: 'cliente', origem: 'Cacequi', destino: 'Santa Maria',
      veiculo: 'S10 2019', valor_combinado: 450, criado_em: agora },
    { id: '83333333-3333-4333-8333-333333333333', autor_id: OUTRO, prestador_id: UID, status: 'concluido', tipo: 'cliente', origem: 'Alegrete', destino: 'Uruguaiana',
      veiculo: 'Onix 2020', valor_combinado: 620, nota: 5, concluido_em: agora, criado_em: agora }];
  api.db.retornos = [{ id: '84444444-4444-4444-8444-444444444444', guincheiro_id: UID, sentido: 'retorno', origem: 'Alegrete', destino: 'Santa Maria',
    saida: new Date(Date.now() + 4 * 36e5).toISOString(), equipamento: 'Plataforma', vagas: 1, status: 'ativo' }];
  await page.goto(base + '/app');
  await page.fill('#em', 'g@teste.dev'); await page.fill('#se', 'segredo123'); await page.locator('#btL').click();
  await page.locator('.novo-pedido').waitFor();
  assert.match(await page.locator('.novo-pedido').innerText(), /São Pedro do Sul › Alegrete/);
  assert.match(await page.locator('.novo-pedido .np-b b').innerText(), /R\$\s*380/);
  assert.match(await page.locator('.andamento').innerText(), /etapa 2 de 4/i);
  assert.match(await page.locator('.andamento button').innerText(), /Cheguei no local/);
  assert.match(await page.locator('.sec-l').innerText(), /No meu caminho/);
  assert.match(await page.locator('.mes').innerText(), /R\$\s*620/);
  await foto(page, '12-inicio-guincheiro-cheio');
  await page.locator('#btTema').click(); await foto(page, '12b-inicio-guincheiro-cheio-escuro');
  await page.locator('.andamento button').click();
  await page.locator('#dlg button[value=ok]').click();
  await page.waitForFunction(() => /Atualizado/.test(document.querySelector('#toast').textContent));
  assert.equal(api.db.pedidos[1].status, 'no_local');
  // aceitar pelo valor oferecido em um toque
  await page.goto(base + '/app#pedido/81111111-1111-4111-8111-111111111111');
  await page.locator('#btAceitaValor').waitFor();
  assert.match(await page.locator('#btAceitaValor').innerText(), /Aceitar por R\$\s*380/);
  await page.locator('#btAceitaValor').click();
  await page.fill('#dlgCampo', 'hoje até 16h');
  await page.locator('#dlg button[value=ok]').click();
  await page.waitForFunction(() => /valor oferecido/.test(document.querySelector('#toast').textContent));
  assert.deepEqual(api.db.propostas[0], { p_pedido: '81111111-1111-4111-8111-111111111111', p_valor: 380, p_prazo: 'hoje até 16h', p_mensagem: null });
  assert.deepEqual(erros, []);
  await ctx.close();
});

test('vistoria: fotos, avarias, assinatura, sem sinal e termo', async () => {
  const api = backend(); const { ctx, page, erros } = await abrir(api);
  const OUTRO = '44444444-4444-4444-8444-444444444444', PED = '91111111-1111-4111-8111-111111111111', agora = new Date().toISOString();
  api.db.perfil = { id: UID, tipo: 'guincheiro', nome: 'João Guincho', cidade: 'Santa Maria', whatsapp: '55999990002', equipamento: 'Plataforma',
    raio_km: 150, placa: 'ABC1D23', aprovacao: 'aprovado', disponivel: true, is_admin: false, criado_em: agora };
  api.db.pedidos = [{ id: PED, autor_id: OUTRO, prestador_id: UID, status: 'no_local', tipo: 'cliente', origem: 'Cacequi', destino: 'Santa Maria',
    veiculo: 'S10 2019', veiculo_tipo: 'caminhonete', placa: 'IYZ1234', valor_combinado: 450, condicao: 'nao_anda', criado_em: agora }];
  await page.goto(base + '/app');
  await page.fill('#em', 'g@teste.dev'); await page.fill('#se', 'segredo123'); await page.locator('#btL').click();
  await page.locator('.andamento').waitFor();
  await page.locator('.andamento a[href^="#vistoria/nova/"]').click();
  await page.locator('.vs-fotos').waitFor();
  // sem fotos não conclui
  await page.locator('#vsConcluir').click();
  await page.waitForFunction(() => /Tire as fotos/.test(document.querySelector('#toast').textContent));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAp1BYVYAAAAASUVORK5CYII=', 'base64');
  for (const slot of ['frente', 'traseira', 'esquerda', 'direita']) {
    await page.locator(`.vs-foto[data-slot=${slot}] input`).setInputFiles({ name: slot + '.png', mimeType: 'image/png', buffer: png });
    await page.locator(`.vs-foto[data-slot=${slot}].ok img`).waitFor();
  }
  // avaria no desenho e checklist
  await page.locator('#vsCarro').scrollIntoViewIfNeeded();
  const carro = await page.locator('#vsCarro').boundingBox();
  await page.mouse.click(carro.x + carro.width * 0.3, carro.y + carro.height * 0.2);
  assert.equal(await page.locator('#vsPins .pin').count(), 1);
  await page.locator('.vs-item[data-item=estepe]').click();
  await page.locator('.seg span', { hasText: '1/2' }).click();
  await page.fill('#vsNome', 'Maria Silva');
  // assinatura com o dedo
  await page.locator('#vsCanvas').scrollIntoViewIfNeeded();
  const ass = await page.locator('#vsCanvas').boundingBox();
  await page.mouse.move(ass.x + 20, ass.y + 40); await page.mouse.down();
  await page.mouse.move(ass.x + 120, ass.y + 90, { steps: 8 }); await page.mouse.move(ass.x + 200, ass.y + 50, { steps: 8 }); await page.mouse.up();
  await foto(page, '13-vistoria');
  // sem sinal: fica salva no celular
  await ctx.setOffline(true);
  await page.locator('#vsConcluir').click();
  await page.waitForFunction(() => /salva no celular/.test(document.querySelector('#toast').textContent));
  assert.equal(api.db.vistorias, undefined, 'nada enviado sem sinal');
  assert.equal(await page.evaluate(async () => (await vistPendentes()).length), 1);
  // sinal volta: envia sozinha
  await ctx.setOffline(false);
  await page.waitForFunction(() => /Vistoria enviada/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 });
  const v = api.db.vistorias[0];
  assert.equal(v.pedido_id, PED); assert.equal(v.fotos.length, 4); assert.equal(v.avarias.length, 1);
  assert.equal(v.responsavel_nome, 'Maria Silva'); assert.equal(v.checklist.estepe, true); assert.equal(v.checklist.combustivel, '1/2');
  assert.ok(api.db.arquivos.includes(`${PED}/${v.id}/assinatura.png`) && api.db.arquivos.includes(`${PED}/${v.id}/frente.jpg`), 'fotos e assinatura enviadas');
  assert.equal(await page.evaluate(async () => (await vistPendentes()).length), 0);
  // termo
  await page.goto(base + '/app#vistoria/' + v.id);
  await page.locator('.vs-galeria img').first().waitFor();
  assert.equal(await page.locator('.vs-galeria img').count(), 4);
  assert.match(await page.locator('#v').innerText(), /Maria Silva/);
  assert.match(await page.locator('#v').innerText(), /Estepe/);
  await foto(page, '14-termo-vistoria');
  assert.deepEqual(erros.filter(e => !/Failed to fetch|NetworkError/.test(e)), []);
  await ctx.close();
});

test('despacho: chamado urgente toca alarme e o guincheiro pega', async () => {
  const api = backend(); const { ctx, page, erros } = await abrir(api);
  const OUTRO = '44444444-4444-4444-8444-444444444444', PED = 'a1111111-1111-4111-8111-111111111111', agora = new Date().toISOString();
  api.db.perfil = { id: UID, tipo: 'guincheiro', nome: 'João Guincho', cidade: 'Alegrete', whatsapp: '55999990002', equipamento: 'Plataforma',
    raio_km: 150, placa: 'ABC1D23', aprovacao: 'aprovado', disponivel: true, is_admin: false, criado_em: agora };
  api.db.pedidos = [{ id: PED, autor_id: OUTRO, status: 'aberto', tipo: 'cliente', origem: 'Alegrete', destino: 'Uruguaiana', veiculo: 'Gol 2015',
    veiculo_tipo: 'carro', condicao: 'nao_anda', valor_oferecido: 300, despacho_ate: new Date(Date.now() + 150e3).toISOString(), criado_em: agora }];
  await page.goto(base + '/app');
  await page.fill('#em', 'g@teste.dev'); await page.fill('#se', 'segredo123'); await page.locator('#btL').click();
  await page.locator('#chamado').waitFor({ timeout: 12000 });
  assert.match(await page.locator('#chamado').innerText(), /Alegrete › Uruguaiana/);
  assert.match(await page.locator('#chOk').innerText(), /Aceitar por R\$\s*300/);
  await foto(page, '15-chamado-urgente');
  await page.locator('#chOk').click();
  await page.waitForURL(/#pedido\//);
  assert.equal(api.db.pedidos[0].status, 'aceito');
  assert.equal(await page.locator('#chamado').count(), 0);
  assert.ok(api.db.chamadas.includes('POST /rest/v1/rpc/gf_pegar_chamado'));
  assert.deepEqual(erros, []);
  await ctx.close();
});

test('atendimento: código de chegada, chat e conta "vale a pena?"', async () => {
  const api = backend(); const { ctx, page, erros } = await abrir(api);
  const OUTRO = '44444444-4444-4444-8444-444444444444', PED = 'b1111111-1111-4111-8111-111111111111', ABERTO = 'c1111111-1111-4111-8111-111111111111', agora = new Date().toISOString();
  api.db.perfil = { id: UID, tipo: 'guincheiro', nome: 'João Guincho', cidade: 'Cacequi', whatsapp: '55999990002', equipamento: 'Plataforma',
    raio_km: 150, placa: 'ABC1D23', aprovacao: 'aprovado', disponivel: true, is_admin: false, criado_em: agora };
  api.db.pedidos = [
    { id: PED, autor_id: OUTRO, prestador_id: UID, status: 'a_caminho', tipo: 'cliente', origem: 'Santa Maria', destino: 'Porto Alegre', veiculo: 'Gol 2015',
      veiculo_tipo: 'carro', condicao: 'nao_anda', valor_combinado: 600, criado_em: agora },
    { id: ABERTO, autor_id: OUTRO, status: 'aberto', tipo: 'cliente', origem: 'Santa Maria', destino: 'Porto Alegre', veiculo: 'Onix 2020',
      veiculo_tipo: 'carro', condicao: 'anda', valor_oferecido: 900, criado_em: agora }];
  api.db.acomp = { token: '99999999-9999-4999-8999-999999999999', codigo: null, chegada_confirmada_em: null };
  await page.goto(base + '/app');
  await page.fill('#em', 'g@teste.dev'); await page.fill('#se', 'segredo123'); await page.locator('#btL').click();
  await page.locator('.novo-pedido').waitFor();
  await page.goto(base + '/app#pedido/' + PED);
  await page.locator('#fCod').waitFor();
  await page.fill('#codIn', '1111'); await page.locator('#fCod button').click();
  await page.getByText('Código incorreto').waitFor();
  await page.fill('#codIn', '4821'); await page.locator('#fCod button').click();
  await page.locator('.cod-ok').waitFor();
  assert.equal(api.db.pedidos[0].status, 'no_local');
  await page.locator('#chatIn').fill('Chego em 5 minutos');
  await page.locator('#fChat button').click();
  await page.locator('.msg.eu', { hasText: 'Chego em 5 minutos' }).waitFor();
  await page.locator('[data-rap="Veículo carregado"]').click();
  await page.locator('.msg.eu', { hasText: 'Veículo carregado' }).waitFor();
  assert.equal(api.db.mensagens.length, 2);
  await foto(page, '17-codigo-chat');
  await page.goto(base + '/app#pedido/' + ABERTO);
  await page.locator('#custo').waitFor();
  await page.locator('#custo summary').click();
  assert.match(await page.locator('#custoRes').innerText(), /Rodagem total/);
  assert.match(await page.locator('#custoResumo').innerText(), /sobra|prejuízo/);
  assert.ok(await semRolagemLateral(page));
  await foto(page, '18-vale-a-pena');
  assert.deepEqual(erros, []);
  await ctx.close();
});

test('financeiro: nova OS, resumo do mês e marcar como pago', async () => {
  const api = backend(); const { ctx, page, erros } = await abrir(api);
  const agora = new Date().toISOString(), hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  api.db.perfil = { id: UID, tipo: 'guincheiro', nome: 'João Guincho', cidade: 'Santa Maria', whatsapp: '55999990002', equipamento: 'Plataforma',
    raio_km: 150, placa: 'ABC1D23', aprovacao: 'aprovado', disponivel: true, is_admin: false, criado_em: agora };
  api.db.os = [{ id: 'os0', numero: 1, guincheiro_id: UID, pedido_id: 'p1', data: hoje, cliente: 'Carla Cliente', pagador_tipo: 'particular', origem: 'Santa Maria',
    destino: 'Porto Alegre', veiculo: 'Gol 2015', valor: 600, forma: 'pix', status: 'a_receber', custo_diesel: 0, custo_pedagio: 0, custo_outros: 0, comissao: 0, criado_em: agora }];
  await page.goto(base + '/app');
  await page.fill('#em', 'g@teste.dev'); await page.fill('#se', 'segredo123'); await page.locator('#btL').click();
  await page.locator('#nav').waitFor();
  await page.goto(base + '/app#servicos/financeiro');
  await page.locator('.fin-cards').waitFor();
  assert.match(await page.locator('.fin-cards').innerText(), /R\$\s*600/);
  await page.locator('a[href="#os/nova"]').click();
  await page.locator('#fOS').waitFor();
  await page.fill('#oC', 'Seguradora Azul'); await page.selectOption('#oPt', 'seguradora');
  await page.fill('#oVal', '450'); await page.fill('#oCd', '120'); await page.fill('#oCp', '30');
  assert.match(await page.locator('#osLucro').innerText(), /Lucro R\$\s*300/);
  await page.locator('#fOS button').click();
  await page.locator('.fin-cards').waitFor();
  assert.equal(api.db.os.length, 2);
  assert.match(await page.locator('.fin-cards').innerText(), /R\$\s*1\.050/);
  await page.locator('a[href="#conta/nova"]').click();
  await page.locator('#fCt').waitFor();
  await page.fill('#cDs', 'Parcela do caminhão'); await page.selectOption('#cCat', 'caminhao'); await page.fill('#cVal', '3.500');
  await page.locator('#fCt input[name=recorrente]').check();
  await page.locator('#fCt button').click();
  await page.locator('[data-pagar]').waitFor();
  assert.equal(api.db.contas.length, 1); assert.equal(api.db.contas[0].recorrente, true); assert.equal(api.db.contas[0].valor, 3500);
  await page.locator('[data-pagar]').click();
  await page.locator('.os-item .tag.vd').waitFor();
  assert.equal(api.db.contas[0].status, 'pago');
  await page.locator('[data-v="resumo"]').click();
  await page.locator('.fin-res').waitFor();
  assert.match(await page.locator('.fin-res').innerText(), /−\s*R\$\s*2\.600|-R\$\s*2\.600/);
  await foto(page, '19-financeiro');
  await page.locator('[data-v="os"]').click();
  await page.locator('a[href="#os/os1"]').click();
  await page.locator('#osPago').click();
  await page.locator('.os-top .tag.vd').waitFor();
  assert.equal(api.db.os[1].status, 'pago');
  await page.locator('a[href="#recibo/os1"]').click();
  await page.locator('.recibo').waitFor();
  assert.match(await page.locator('.recibo').innerText(), /quatrocentos e cinquenta reais/);
  assert.match(await page.locator('.recibo').innerText(), /Seguradora Azul/);
  await foto(page, '20-recibo');
  assert.ok(await semRolagemLateral(page));
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
