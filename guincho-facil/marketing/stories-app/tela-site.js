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
  const ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', serviceWorkers: 'block', viewport: { width: 390, height: 815 } });
  const api = backend();
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(UMD, 'supabase.js')) }));
  await ctx.route(SB + '/**', api.trata);
  await ctx.route(/unpkg\.com|openstreetmap/, r => r.abort());
  const agora = new Date().toISOString(), OUTRO = '44444444-4444-4444-8444-444444444444';
  api.db.perfil = { id: UID, tipo: 'guincheiro', nome: 'João Guincho', cidade: 'Cacequi', whatsapp: '55999990002', equipamento: 'Plataforma', raio_km: 150, placa: 'ABC1D23', aprovacao: 'aprovado', disponivel: true, is_admin: false, criado_em: agora };
  api.db.pedidos = [
    { id: '81111111-1111-4111-8111-111111111111', autor_id: OUTRO, status: 'aberto', tipo: 'cliente', origem: 'Santa Maria', destino: 'Porto Alegre', veiculo: 'Gol 2015', veiculo_tipo: 'carro', condicao: 'nao_anda', data_servico: agora.slice(0, 10), criado_em: agora, valor_oferecido: 600 },
    { id: '83333333-3333-4333-8333-333333333333', autor_id: OUTRO, prestador_id: UID, status: 'concluido', tipo: 'cliente', origem: 'Alegrete', destino: 'Uruguaiana', veiculo: 'Onix 2020', valor_combinado: 620, nota: 5, concluido_em: agora, criado_em: agora }];
  api.db.retornos = [{ id: '84444444-4444-4444-8444-444444444444', guincheiro_id: UID, sentido: 'retorno', origem: 'Alegrete', destino: 'Santa Maria', saida: new Date(Date.now() + 4 * 36e5).toISOString(), equipamento: 'Plataforma', vagas: 1, status: 'ativo' }];
  const p = await ctx.newPage();
  await p.goto(base + '/app'); await espera(800);
  await p.locator('#em').fill('joao@guincho.com'); await p.locator('#se').fill('segredo123');
  await p.locator('#btL').click(); await p.locator('.novo-pedido').waitFor(); await espera(1500);
  await p.screenshot({ path: path.join(raiz, 'public', 'assets', 'app-inicio.jpg'), type: 'jpeg', quality: 88 });
  await b.close(); srv.close();
})();
