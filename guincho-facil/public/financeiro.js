'use strict';
// GF · Financeiro do guincheiro: controle de ordens de serviço (OS), contas a receber,
// custos e lucro do mês. Só o dono vê as próprias OS (regras do banco).
// Usa as utilidades globais do app.js ($, V, S, sb, ok, esc, brl, toast, chips...).

const OS_PAGADOR = { particular: 'Particular', seguradora: 'Seguradora', assistencia: 'Assistência 24h', empresa: 'Empresa', colega: 'Colega guincheiro', outro: 'Outro' };
const OS_FORMA = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão', boleto: 'Boleto', faturado: 'Faturado', transferencia: 'Transferência', outro: 'Outro' };
const OS_STATUS = { a_receber: 'A receber', pago: 'Pago', cancelada: 'Cancelada' };
const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const mesISO = d => (d || hojeISO()).slice(0, 7);
const dataBR = d => d ? d.split('-').reverse().join('/') : '';
const custoOS = o => Number(o.custo_diesel || 0) + Number(o.custo_pedagio || 0) + Number(o.custo_outros || 0) + Number(o.comissao || 0);
const vencida = o => o.status === 'a_receber' && o.vencimento && o.vencimento < hojeISO();
const numOS = n => 'OS ' + String(n).padStart(4, '0');
function tagOS(o) {
  if (o.status === 'pago') return '<span class="tag vd">Pago</span>';
  if (o.status === 'cancelada') return '<span class="tag vm">Cancelada</span>';
  return vencida(o) ? '<span class="tag vm">Vencida</span>' : '<span class="tag am">A receber</span>';
}
function nomeMes(m) { const [a, b] = m.split('-').map(Number); const t = new Date(a, b - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); }
function somaMes(m, d) { const [a, b] = m.split('-').map(Number); const x = new Date(a, b - 1 + d, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; }

async function telaFinanceiro() {
  titulo('Financeiro');
  const f = S.filtros.fin ||= { mes: mesISO(), ver: 'todas' };
  const ini = f.mes + '-01', fim = somaMes(f.mes, 1) + '-01';
  const [doMes, abertas] = await Promise.all([
    sb.from('gf_os').select('*').gte('data', ini).lt('data', fim).order('data', { ascending: false }).order('numero', { ascending: false }).limit(500).then(ok),
    sb.from('gf_os').select('id,valor,vencimento,status').eq('status', 'a_receber').limit(1000).then(ok)]);
  const validas = doMes.filter(o => o.status !== 'cancelada');
  const fat = validas.reduce((s, o) => s + Number(o.valor), 0);
  const custos = validas.reduce((s, o) => s + custoOS(o), 0);
  const recebido = validas.filter(o => o.status === 'pago').reduce((s, o) => s + Number(o.valor), 0);
  const aReceber = abertas.reduce((s, o) => s + Number(o.valor), 0);
  const vencido = abertas.filter(vencida).reduce((s, o) => s + Number(o.valor), 0);
  const lista = doMes.filter(o => f.ver === 'todas' || (f.ver === 'receber' && o.status === 'a_receber') || (f.ver === 'vencidas' && vencida(o)) || (f.ver === 'pagas' && o.status === 'pago'));
  const porPagador = Object.entries(validas.reduce((m, o) => (m[o.pagador_tipo] = (m[o.pagador_tipo] || 0) + Number(o.valor), m), {})).sort((a, b) => b[1] - a[1]);

  V.innerHTML = `${chips('aba', ABAS_SERV, 'financeiro')}
  <div class="fin-mes"><button class="btn fant peq" id="mAnt" aria-label="Mês anterior">‹</button><b>${esc(nomeMes(f.mes))}</b>
    <button class="btn fant peq" id="mProx" aria-label="Próximo mês" ${f.mes >= mesISO() ? 'disabled' : ''}>›</button></div>
  <div class="fin-cards">
    <div class="fin-card"><span>Faturado no mês</span><b>${brl(fat)}</b><small>${validas.length} OS</small></div>
    <div class="fin-card"><span>Lucro no mês</span><b class="${fat - custos >= 0 ? 'pos' : 'neg'}">${brl(fat - custos)}</b><small>custos ${brl(custos)}</small></div>
    <div class="fin-card"><span>Recebido no mês</span><b>${brl(recebido)}</b><small>das OS do mês</small></div>
    <div class="fin-card ${vencido ? 'alerta' : ''}"><span>A receber (todas)</span><b>${brl(aReceber)}</b><small>${vencido ? `${brl(vencido)} vencido` : 'nada vencido'}</small></div>
  </div>
  ${aReceber ? `<a class="item quente antecipa" href="#servicos/antecipar"><div class="tit">Tem ${brl(aReceber)} a receber?</div>
    <div class="meta">Antecipe com a ${esc(ANTECIPACAO.parceira)} e receba em até 3 horas após a aprovação.</div></a>` : ''}
  ${porPagador.length > 1 ? `<div class="fin-pag">${porPagador.map(([k, v]) => `<div><span>${esc(OS_PAGADOR[k] || k)}</span><i style="width:${Math.max(4, Math.round(v / fat * 100))}%"></i><b>${brl(v)}</b></div>`).join('')}</div>` : ''}
  <a class="btn full grande" href="#os/nova" style="margin:14px 0">+ Nova OS</a>
  ${chips('ver', [['todas', 'Todas'], ['receber', 'A receber'], ['vencidas', 'Vencidas'], ['pagas', 'Pagas']], f.ver)}
  ${lista.length ? lista.map(o => `<a class="item os-item" href="#os/${o.id}">
      <div class="os-top"><b>${numOS(o.numero)}</b>${tagOS(o)}</div>
      <div class="os-meio"><span>${esc(o.cliente)}</span><b class="valor">${brl(o.valor)}</b></div>
      <div class="meta">${dataBR(o.data)} · ${esc(OS_PAGADOR[o.pagador_tipo] || '')}${o.origem && o.destino ? ' · ' + esc(o.origem) + ' › ' + esc(o.destino) : ''}${o.pedido_id ? ' · pelo GF' : ''}</div>
      ${o.status === 'a_receber' && o.vencimento ? `<div class="meta">Vence ${dataBR(o.vencimento)}</div>` : ''}</a>`).join('')
    : `<div class="vazio">Nenhuma OS ${f.ver === 'todas' ? 'neste mês' : 'neste filtro'}.<br>Atendimentos concluídos pelo GF entram sozinhos. Serviços de fora, lance em "Nova OS".</div>`}
  ${doMes.length ? '<button class="btn fant full" id="finCsv" style="margin-top:14px">Exportar planilha do mês (CSV)</button>' : ''}`;
  ligaChips('aba', v => location.hash = 'servicos/' + v);
  ligaChips('ver', v => { f.ver = v; rota(); });
  $('#mAnt').onclick = () => { f.mes = somaMes(f.mes, -1); rota(); };
  $('#mProx').onclick = () => { if (f.mes < mesISO()) { f.mes = somaMes(f.mes, 1); rota(); } };
  if ($('#finCsv')) $('#finCsv').onclick = () => csv(doMes.map(o => ({ OS: o.numero, Data: dataBR(o.data), Cliente: o.cliente, Pagador: OS_PAGADOR[o.pagador_tipo],
    Origem: o.origem || '', Destino: o.destino || '', Veiculo: o.veiculo || '', Placa: o.placa || '', Valor: String(o.valor).replace('.', ','),
    Forma: OS_FORMA[o.forma], Status: OS_STATUS[o.status], Vencimento: dataBR(o.vencimento), Pago_em: dataBR(o.pago_em),
    Diesel: String(o.custo_diesel).replace('.', ','), Pedagio: String(o.custo_pedagio).replace('.', ','), Outros: String(o.custo_outros).replace('.', ','),
    Comissao: String(o.comissao).replace('.', ','), Motorista: o.motorista || '', Lucro: String((Number(o.valor) - custoOS(o)).toFixed(2)).replace('.', ',') })), `gf-financeiro-${f.mes}.csv`);
}

async function telaOS(id) {
  const nova = id === 'nova';
  const o = nova ? { data: hojeISO(), pagador_tipo: 'particular', forma: 'pix', status: 'a_receber', custo_diesel: 0, custo_pedagio: 0, custo_outros: 0, comissao: 0 }
    : ok(await sb.from('gf_os').select('*').eq('id', id).maybeSingle());
  if (!o) { titulo('OS'); V.innerHTML = '<div class="vazio"><h2>OS não encontrada</h2><a href="#servicos/financeiro">Voltar ao financeiro</a></div>'; return; }
  titulo(nova ? 'Nova OS' : numOS(o.numero));
  const op = (obj, at) => Object.entries(obj).map(([v, t]) => `<option value="${v}" ${v === at ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const din = v => v == null || Number(v) === 0 ? '' : String(v).replace('.', ',');
  const gf = !!o.pedido_id;
  V.innerHTML = `${!nova ? `<div class="item destaque"><div class="os-top"><b style="font-size:20px">${numOS(o.numero)}</b>${tagOS(o)}</div>
      <div class="meta">${gf ? `Atendimento pelo GF · <a href="#pedido/${o.pedido_id}">ver atendimento</a>` : 'Lançada à mão'} · criada ${dataHora(o.criado_em)}</div>
      ${o.status === 'a_receber' ? '<button class="btn vd full" id="osPago" style="margin-top:12px">Marcar como pago hoje</button>' : ''}</div>` : ''}
  <form id="fOS" novalidate>
    <h3 class="sec-t">Serviço</h3>
    <div class="dupla"><div><label for="oD">Data</label><input id="oD" name="data" type="date" value="${esc(o.data)}" required></div>
      <div><label for="oPt">Quem paga</label><select id="oPt" name="pagador_tipo">${op(OS_PAGADOR, o.pagador_tipo)}</select></div></div>
    <label for="oC">Cliente ou pagador</label><input id="oC" name="cliente" maxlength="120" value="${esc(o.cliente || '')}" placeholder="Ex.: nome da seguradora ou do cliente" required>
    <div class="dupla"><div><label for="oO">Origem</label><input id="oO" name="origem" maxlength="80" value="${esc(o.origem || '')}" ${gf ? 'readonly' : ''}></div>
      <div><label for="oDe">Destino</label><input id="oDe" name="destino" maxlength="80" value="${esc(o.destino || '')}" ${gf ? 'readonly' : ''}></div></div>
    <div class="dupla"><div><label for="oV">Veículo</label><input id="oV" name="veiculo" maxlength="80" value="${esc(o.veiculo || '')}" placeholder="Ex.: Gol 2015"></div>
      <div><label for="oPl">Placa</label><input id="oPl" name="placa" maxlength="8" value="${esc(o.placa || '')}" placeholder="ABC1D23" style="text-transform:uppercase"></div></div>
    <div class="dupla"><div><label for="oKm">Km rodados</label><input id="oKm" name="km" inputmode="decimal" value="${din(o.km)}" placeholder="Ex.: 320"></div>
      <div><label for="oM">Motorista</label><input id="oM" name="motorista" maxlength="80" value="${esc(o.motorista || '')}" placeholder="Opcional"></div></div>
    <h3 class="sec-t">Valor e recebimento</h3>
    <div class="dupla"><div><label for="oVal">Valor (R$)</label><input id="oVal" name="valor" inputmode="decimal" value="${din(o.valor)}" placeholder="Ex.: 600" required></div>
      <div><label for="oF">Forma</label><select id="oF" name="forma">${op(OS_FORMA, o.forma)}</select></div></div>
    <div class="dupla"><div><label for="oS">Situação</label><select id="oS" name="status">${op(OS_STATUS, o.status)}</select></div>
      <div><label for="oVc">Vencimento</label><input id="oVc" name="vencimento" type="date" value="${esc(o.vencimento || '')}"></div></div>
    <h3 class="sec-t">Custos do serviço</h3>
    <div class="dupla"><div><label for="oCd">Diesel (R$)</label><input id="oCd" name="custo_diesel" inputmode="decimal" value="${din(o.custo_diesel)}" placeholder="0"></div>
      <div><label for="oCp">Pedágio (R$)</label><input id="oCp" name="custo_pedagio" inputmode="decimal" value="${din(o.custo_pedagio)}" placeholder="0"></div></div>
    <div class="dupla"><div><label for="oCo">Outros (R$)</label><input id="oCo" name="custo_outros" inputmode="decimal" value="${din(o.custo_outros)}" placeholder="0"></div>
      <div><label for="oCm">Comissão motorista (R$)</label><input id="oCm" name="comissao" inputmode="decimal" value="${din(o.comissao)}" placeholder="0"></div></div>
    <div class="fin-lucro" id="osLucro" aria-live="polite"></div>
    <label for="oOb">Observação</label><textarea id="oOb" name="obs" maxlength="1000" placeholder="Ex.: número do sinistro, nota fiscal">${esc(o.obs || '')}</textarea>
    <button class="btn full grande" style="margin-top:16px">${nova ? 'Salvar OS' : 'Salvar alterações'}</button>
  </form>
  ${!nova && !gf ? '<button class="btn perigo full" id="osDel" style="margin-top:12px">Excluir OS</button>' : ''}
  <a class="btn fant full" href="#servicos/financeiro" style="margin-top:12px">Voltar ao financeiro</a>`;

  const num = v => valorDigitado(v || '0') || 0;
  const lucro = () => {
    const fd = Object.fromEntries(new FormData($('#fOS')));
    const v = num(fd.valor), c = num(fd.custo_diesel) + num(fd.custo_pedagio) + num(fd.custo_outros) + num(fd.comissao);
    $('#osLucro').innerHTML = `<span>Valor ${brl(v)} − custos ${brl(c)}</span><b class="${v - c >= 0 ? 'pos' : 'neg'}">Lucro ${brl(v - c)}</b>`;
  };
  $('#fOS').addEventListener('input', () => { $('#fOS').dataset.sujo = '1'; lucro(); }); lucro();
  $('#fOS').onsubmit = e => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
    if (fd.cliente.trim().length < 2) { $('#oC').focus(); return toast('Informe o cliente ou quem paga.', true); }
    const valor = valorDigitado(fd.valor);
    if (!(valor >= 0) || fd.valor.trim() === '') { $('#oVal').focus(); return toast('Informe o valor do serviço.', true); }
    const dados = { data: fd.data || hojeISO(), cliente: fd.cliente.trim(), pagador_tipo: fd.pagador_tipo, valor, forma: fd.forma, status: fd.status,
      vencimento: fd.vencimento || null, custo_diesel: num(fd.custo_diesel), custo_pedagio: num(fd.custo_pedagio), custo_outros: num(fd.custo_outros),
      comissao: num(fd.comissao), motorista: fd.motorista.trim() || null, obs: fd.obs.trim() || null, veiculo: fd.veiculo.trim() || null,
      placa: fd.placa.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || null, km: fd.km.trim() ? num(fd.km) : null };
    if (!gf) Object.assign(dados, { origem: fd.origem.trim() || null, destino: fd.destino.trim() || null });
    comBotao(e.target.querySelector('button'), async () => {
      try {
        if (nova) { const r = ok(await sb.from('gf_os').insert(dados).select('id,numero').single()); toast(numOS(r.numero) + ' salva.'); location.hash = 'servicos/financeiro'; }
        else { ok(await sb.from('gf_os').update(dados).eq('id', o.id)); toast('OS atualizada.'); delete $('#fOS').dataset.sujo; location.hash = 'servicos/financeiro'; }
      } catch (er) { falha(er); }
    });
  };
  if ($('#osPago')) $('#osPago').onclick = e => comBotao(e.currentTarget, async () => {
    try { ok(await sb.from('gf_os').update({ status: 'pago', pago_em: hojeISO() }).eq('id', o.id)); toast('OS marcada como paga.'); rota(); } catch (er) { falha(er); }
  });
  if ($('#osDel')) $('#osDel').onclick = async () => {
    if (!await perguntar({ titulo: `Excluir ${numOS(o.numero)}?`, texto: 'Ela sai do financeiro e não dá para desfazer.', ok: 'Excluir', perigo: true })) return;
    try { ok(await sb.from('gf_os').delete().eq('id', o.id)); toast('OS excluída.'); location.hash = 'servicos/financeiro'; } catch (er) { falha(er); }
  };
}
