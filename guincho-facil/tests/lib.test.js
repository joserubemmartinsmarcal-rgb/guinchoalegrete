const test = require('node:test');
const assert = require('node:assert/strict');
const GF = require('../public/lib.js');
const { GF_GEO, GF_CIDADES } = require('../public/cidades.js');

test('transições de status espelham o banco', () => {
  assert.equal(GF.transicaoValida('aceito', 'a_caminho', 'prestador'), true);
  assert.equal(GF.transicaoValida('a_caminho', 'no_local', 'prestador'), true);
  assert.equal(GF.transicaoValida('no_local', 'em_transporte', 'prestador'), true);
  assert.equal(GF.transicaoValida('em_transporte', 'concluido', 'prestador'), true);
  assert.equal(GF.transicaoValida('aceito', 'no_local', 'prestador'), false, 'não pula etapa');
  assert.equal(GF.transicaoValida('aberto', 'aceito', 'prestador'), false, 'aceite é do cliente, via proposta');
  assert.equal(GF.transicaoValida('em_transporte', 'concluido', 'cliente'), true);
  assert.equal(GF.transicaoValida('aceito', 'concluido', 'cliente'), false);
  assert.equal(GF.transicaoValida('aceito', 'a_caminho', 'outro'), false);
  for (const s of GF.ATIVOS) assert.ok(GF.ACAO_PRESTADOR[s] && GF.PROXIMO[s], `ação definida para ${s}`);
});

test('WhatsApp: máscara, validação e link', () => {
  assert.equal(GF.mascaraZap('55999990001'), '(55) 99999-0001');
  assert.equal(GF.mascaraZap('5599'), '(55) 99');
  assert.equal(GF.zapValido('(55) 99999-0001'), true);
  assert.equal(GF.zapValido('99999'), false);
  assert.equal(GF.linkZap('55999990001', 'olá'), 'https://wa.me/5555999990001?text=ol%C3%A1');
  assert.equal(GF.linkZap('5555999990001', ''), 'https://wa.me/5555999990001?text=');
  assert.equal(GF.linkMaps('Santa Maria', 'São Gabriel'),
    'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=Santa%20Maria%2C%20RS%2C%20Brasil&destination=S%C3%A3o%20Gabriel%2C%20RS%2C%20Brasil');
});

test('placa: padrões antigo e Mercosul', () => {
  assert.equal(GF.placaNormal('abc-1d23'), 'ABC1D23');
  assert.equal(GF.placaValida('ABC1234'), true);
  assert.equal(GF.placaValida('abc-1d23'), true);
  assert.equal(GF.placaValida(''), true, 'placa é opcional');
  assert.equal(GF.placaValida('AB1234'), false);
  assert.equal(GF.placaValida('ABCD123'), false);
});

test('valor digitado em formato brasileiro', () => {
  assert.equal(GF.valorDigitado('450'), 450);
  assert.equal(GF.valorDigitado('1.234,56'), 1234.56);
  assert.equal(GF.valorDigitado('R$ 1.200'), 1200);
  assert.equal(GF.valorDigitado('99,9'), 99.9);
  assert.equal(GF.valorDigitado('1234.5'), 1234.5);
  assert.ok(Number.isNaN(GF.valorDigitado('')));
  assert.ok(Number.isNaN(GF.valorDigitado('abc')));
});

test('escape de HTML', () => {
  assert.equal(GF.esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.equal(GF.esc(null), '');
});

test('total registrado soma só concluídos com valor', () => {
  const t = GF.totalRegistrado([
    { status: 'concluido', valor_combinado: '450.00' }, { status: 'concluido', valor_combinado: 300 },
    { status: 'em_transporte', valor_combinado: 999 }, { status: 'concluido', valor_combinado: null }]);
  assert.equal(t, 750);
});

test('filtro de período', () => {
  const agora = Date.parse('2026-10-28T12:00:00Z');
  assert.equal(GF.dentroDoPeriodo('2026-10-25T12:00:00Z', 7, agora), true);
  assert.equal(GF.dentroDoPeriodo('2026-10-01T12:00:00Z', 7, agora), false);
  assert.equal(GF.dentroDoPeriodo('2020-01-01T00:00:00Z', 0, agora), true, '0 = tudo');
});

test('progresso do cadastro do guincheiro', () => {
  assert.equal(GF.progressoCadastro(null).pct, 0);
  const p = { nome: 'A', cidade: 'Alegrete', whatsapp: '55999990001', equipamento: 'Plataforma', placa: 'ABC1D23', capacidade: 'leve', raio_km: 100, aprovacao: 'pendente' };
  assert.equal(GF.progressoCadastro(p).pct, 80);
  assert.equal(GF.progressoCadastro({ ...p, aprovacao: 'aprovado' }).pct, 100);
});

test('distâncias e desvio entre cidades', () => {
  assert.ok(Object.keys(GF_CIDADES).length >= 50);
  const sm = GF_GEO.km('Alegrete', 'Santa Maria');
  assert.ok(sm > 230 && sm < 330, `Alegrete–Santa Maria ~260 km por estrada (${sm})`);
  assert.equal(GF_GEO.km('Alegrete', 'Cidade Inexistente'), null);
  const d = GF_GEO.desvio('Santa Maria', 'Alegrete', 'Cacequi', 'Alegrete');
  assert.ok(d >= 0 && d < 40, `Cacequi fica no caminho (${d} km)`);
  assert.ok(GF_GEO.desvio('Santa Maria', 'Alegrete', 'Pelotas', 'Alegrete') > 300, 'Pelotas não fica no caminho');
});

test('calculadora "Quanto sobra?"', () => {
  // 320 km a 4 km/l com diesel a 6,20 = 496; manutenção 0,60/km = 192; impostos 6% de 850 = 51
  const r = GF.calcularResultado({ valor: '850', km: '320', consumo: '4', diesel: '6,20', manutencaoKm: '0,60', impostosPct: '6', pedagios: '', outros: '' });
  assert.equal(r.combustivel, 496);
  assert.equal(r.manutencao, 192);
  assert.equal(r.impostos, 51);
  assert.equal(r.custos, 739);
  assert.equal(r.resultado, 111);
  assert.equal(r.margem, 13.1);
  assert.equal(r.porKm, 0.35);
  const vazio = GF.calcularResultado({});
  assert.equal(vazio.resultado, 0); assert.equal(vazio.margem, null);
  const prejuizo = GF.calcularResultado({ valor: 100, pedagios: '150', impostosPct: '-5' });
  assert.equal(prejuizo.resultado, -50, 'valores negativos são ignorados; pode dar prejuízo');
});
