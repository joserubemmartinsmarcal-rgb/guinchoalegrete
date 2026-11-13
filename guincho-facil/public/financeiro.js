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

const CONTA_CAT = { caminhao: 'Caminhão (parcela/financiamento)', combustivel: 'Combustível', manutencao: 'Manutenção e pneus', seguro: 'Seguro',
  salario: 'Salários e motoristas', impostos: 'Impostos e taxas', aluguel: 'Aluguel e pátio', telefone: 'Telefone e internet', pedagio: 'Pedágio', outros: 'Outros' };
const CONTA_FORMA = { pix: 'Pix', boleto: 'Boleto', debito: 'Débito automático', cartao: 'Cartão', dinheiro: 'Dinheiro', transferencia: 'Transferência', outro: 'Outro' };
const contaVencida = c => c.status === 'a_pagar' && c.vencimento < hojeISO();
const tagConta = c => c.status === 'pago' ? '<span class="tag vd">Paga</span>' : contaVencida(c) ? '<span class="tag vm">Vencida</span>' : '<span class="tag am">A pagar</span>';
const barras = (pares, total, rot) => pares.length ? `<div class="fin-pag">${pares.map(([k, v]) => `<div><span>${esc(rot[k] || k)}</span><i style="width:${Math.max(4, Math.round(v / (total || 1) * 100))}%"></i><b>${brl(v)}</b></div>`).join('')}</div>` : '';
const somaPor = (lista, campo, valor) => Object.entries(lista.reduce((m, x) => (m[x[campo]] = (m[x[campo]] || 0) + valor(x), m), {})).sort((a, b) => b[1] - a[1]);

async function telaFinanceiro() {
  titulo('Financeiro');
  const f = S.filtros.fin ||= { mes: mesISO(), ver: 'todas', sec: 'resumo', verC: 'todas' };
  f.sec ||= 'resumo'; f.verC ||= 'todas'; f.ver ||= 'todas';
  const ini = f.mes + '-01', fim = somaMes(f.mes, 1) + '-01';
  try { await rpc('gf_gerar_contas_mes', { p_mes: ini }); } catch { /* função ainda não publicada */ }
  const [doMes, abertas, contas, contasAbertas] = await Promise.all([
    sb.from('gf_os').select('*').gte('data', ini).lt('data', fim).order('data', { ascending: false }).order('numero', { ascending: false }).limit(500).then(ok),
    sb.from('gf_os').select('id,numero,cliente,valor,vencimento,status').eq('status', 'a_receber').limit(1000).then(ok),
    sb.from('gf_contas').select('*').gte('vencimento', ini).lt('vencimento', fim).order('vencimento').limit(500).then(ok).catch(() => []),
    sb.from('gf_contas').select('id,descricao,valor,vencimento,status').eq('status', 'a_pagar').order('vencimento').limit(1000).then(ok).catch(() => [])]);
  const validas = doMes.filter(o => o.status !== 'cancelada');
  const fat = validas.reduce((s, o) => s + Number(o.valor), 0);
  const custosOS = validas.reduce((s, o) => s + custoOS(o), 0);
  const recebido = validas.filter(o => o.status === 'pago').reduce((s, o) => s + Number(o.valor), 0);
  const aReceber = abertas.reduce((s, o) => s + Number(o.valor), 0);
  const vencido = abertas.filter(vencida).reduce((s, o) => s + Number(o.valor), 0);
  const despesas = contas.reduce((s, c) => s + Number(c.valor), 0);
  const pagas = contas.filter(c => c.status === 'pago').reduce((s, c) => s + Number(c.valor), 0);
  const aPagar = contasAbertas.reduce((s, c) => s + Number(c.valor), 0);
  const pagarVencido = contasAbertas.filter(contaVencida).reduce((s, c) => s + Number(c.valor), 0);
  const resultado = fat - custosOS - despesas;
  let saldos = []; try { saldos = await rpc('gf_saldos'); } catch { /* ainda não publicado */ }
  const saldoTotal = saldos.reduce((t, x) => t + Number(x.saldo), 0);
  const fixasMes = contas.filter(c => c.recorrente || c.serie_id).reduce((s, c) => s + Number(c.valor), 0);

  let html = `${chips('aba', ABAS_SERV, 'financeiro')}
  ${chips('sec', [['resumo', 'Resumo da empresa'], ['os', 'OS · entradas'], ['contas', 'Contas a pagar'], ['fixas', 'Despesas fixas'], ['bancos', 'Contas e caixa']], f.sec)}
  <div class="fin-mes"><button class="btn fant peq" id="mAnt" aria-label="Mês anterior">‹</button><b>${esc(nomeMes(f.mes))}</b>
    <button class="btn fant peq" id="mProx" aria-label="Próximo mês" ${f.mes > mesISO() ? 'disabled' : ''}>›</button></div>`;

  if (f.sec === 'resumo') {
    const em7 = new Date(Date.now() + 7 * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    const prox = [...contasAbertas.filter(c => c.vencimento <= em7).map(c => ({ t: 'pagar', d: c.vencimento, nome: c.descricao, v: c.valor, href: '#conta/' + c.id })),
      ...abertas.filter(o => o.vencimento && o.vencimento <= em7).map(o => ({ t: 'receber', d: o.vencimento, nome: numOS(o.numero) + ' · ' + o.cliente, v: o.valor, href: '#os/' + o.id }))]
      .sort((a, b) => a.d.localeCompare(b.d));
    html += `<div class="fin-res ${resultado >= 0 ? 'pos' : 'neg'}"><span>Resultado do mês</span><b>${brl(resultado)}</b>
        <small>Entradas ${brl(fat)} − custos dos serviços ${brl(custosOS)} − contas ${brl(despesas)}</small></div>
      <div class="fin-cards">
        <div class="fin-card"><span>Entradas (OS)</span><b>${brl(fat)}</b><small>${validas.length} OS · recebido ${brl(recebido)}</small></div>
        <div class="fin-card"><span>Saídas (contas)</span><b>${brl(despesas)}</b><small>pago ${brl(pagas)}</small></div>
        <div class="fin-card ${vencido ? 'alerta' : ''}"><span>A receber</span><b>${brl(aReceber)}</b><small>${vencido ? `${brl(vencido)} vencido` : 'nada vencido'}</small></div>
        <div class="fin-card ${pagarVencido ? 'alerta' : ''}"><span>A pagar</span><b>${brl(aPagar)}</b><small>${pagarVencido ? `${brl(pagarVencido)} vencido` : 'nada vencido'}</small></div>
      </div>
      ${fixasMes ? `<div class="fin-caixa"><span>Despesas fixas do mês</span><b>${brl(fixasMes)}</b></div>
        <div class="fin-meta"><span>Para pagar as fixas, faltam faturar</span><b>${brl(Math.max(0, fixasMes - (fat - custosOS)))}</b>
        <i style="width:${Math.min(100, Math.round(Math.max(0, fat - custosOS) / fixasMes * 100))}%"></i></div>` : `<a class="fin-dica" href="#" data-sec="fixas">Cadastre suas despesas fixas (parcela, seguro, salário) e veja quanto precisa faturar no mês ›</a>`}
      ${saldos.length ? `<div class="fin-caixa"><span>Saldo nas contas e caixa</span><b class="${saldoTotal >= 0 ? 'pos' : 'neg'}">${brl(saldoTotal)}</b></div>` : ''}
      <div class="fin-caixa"><span>Caixa do mês (recebido − pago)</span><b class="${recebido - pagas >= 0 ? 'pos' : 'neg'}">${brl(recebido - pagas)}</b></div>
      <h3 class="sec-t">Vence nos próximos 7 dias</h3>
      ${prox.length ? `<ul class="fin-prox">${prox.map(x => `<li><a href="${x.href}"><span class="tag ${x.t === 'pagar' ? 'vm' : 'vd'}">${x.t === 'pagar' ? 'Pagar' : 'Receber'}</span>
        <span class="n">${esc(x.nome)}</span><time>${dataBR(x.d)}</time><b>${brl(x.v)}</b></a></li>`).join('')}</ul>` : '<div class="vs-dica">Nada vencendo nos próximos 7 dias.</div>'}
      ${despesas ? `<h3 class="sec-t">Para onde foi o dinheiro</h3>${barras(somaPor(contas, 'categoria', c => Number(c.valor)), despesas, CONTA_CAT)}` : ''}
      ${fat ? `<h3 class="sec-t">De onde veio</h3>${barras(somaPor(validas, 'pagador_tipo', o => Number(o.valor)), fat, OS_PAGADOR)}` : ''}
      ${aReceber ? `<a class="item quente antecipa" href="#servicos/antecipar"><div class="tit">Tem ${brl(aReceber)} a receber?</div>
        <div class="meta">Antecipe com a ${esc(ANTECIPACAO.parceira)} e receba em até 3 horas após a aprovação.</div></a>` : ''}
      <div class="dupla" style="margin-top:14px"><a class="btn" href="#os/nova">+ Nova OS</a><a class="btn fant" href="#conta/nova">+ Nova conta</a></div>
      ${doMes.length || contas.length ? '<button class="btn fant full" id="finCsv" style="margin-top:12px">Exportar planilha do mês (CSV)</button>' : ''}`;
  } else if (f.sec === 'os') {
    const lista = doMes.filter(o => f.ver === 'todas' || (f.ver === 'receber' && o.status === 'a_receber') || (f.ver === 'vencidas' && vencida(o)) || (f.ver === 'pagas' && o.status === 'pago'));
    html += `<div class="fin-cards">
        <div class="fin-card"><span>Faturado no mês</span><b>${brl(fat)}</b><small>${validas.length} OS</small></div>
        <div class="fin-card"><span>Lucro dos serviços</span><b class="${fat - custosOS >= 0 ? 'pos' : 'neg'}">${brl(fat - custosOS)}</b><small>custos ${brl(custosOS)}</small></div></div>
      <a class="btn full grande" href="#os/nova" style="margin:14px 0">+ Nova OS</a>
      ${chips('ver', [['todas', 'Todas'], ['receber', 'A receber'], ['vencidas', 'Vencidas'], ['pagas', 'Pagas']], f.ver)}
      ${lista.length ? lista.map(o => `<a class="item os-item" href="#os/${o.id}">
          <div class="os-top"><b>${numOS(o.numero)}</b>${tagOS(o)}</div>
          <div class="os-meio"><span>${esc(o.cliente)}</span><b class="valor">${brl(o.valor)}</b></div>
          <div class="meta">${dataBR(o.data)} · ${esc(OS_PAGADOR[o.pagador_tipo] || '')}${o.origem && o.destino ? ' · ' + esc(o.origem) + ' › ' + esc(o.destino) : ''}${o.pedido_id ? ' · pelo GF' : ''}</div>
          ${o.status === 'a_receber' && o.vencimento ? `<div class="meta">Vence ${dataBR(o.vencimento)}</div>` : ''}</a>`).join('')
        : `<div class="vazio">Nenhuma OS ${f.ver === 'todas' ? 'neste mês' : 'neste filtro'}.<br>Atendimentos concluídos pelo GF entram sozinhos. Serviços de fora, lance em "Nova OS".</div>`}`;
  } else if (f.sec === 'bancos') {
    html += await secaoBancos();
  } else if (f.sec === 'fixas') {
    html += await secaoFixas(contas);
  } else {
    const lista = contas.filter(c => f.verC === 'todas' || (f.verC === 'pagar' && c.status === 'a_pagar') || (f.verC === 'vencidas' && contaVencida(c)) || (f.verC === 'pagas' && c.status === 'pago'));
    html += `<div class="fin-cards">
        <div class="fin-card"><span>Contas do mês</span><b>${brl(despesas)}</b><small>${contas.length} conta${contas.length === 1 ? '' : 's'}</small></div>
        <div class="fin-card ${pagarVencido ? 'alerta' : ''}"><span>Falta pagar (todas)</span><b>${brl(aPagar)}</b><small>${pagarVencido ? `${brl(pagarVencido)} vencido` : 'nada vencido'}</small></div></div>
      <a class="btn full grande" href="#conta/nova" style="margin:14px 0">+ Nova conta</a>
      ${chips('verC', [['todas', 'Todas'], ['pagar', 'A pagar'], ['vencidas', 'Vencidas'], ['pagas', 'Pagas']], f.verC)}
      ${lista.length ? lista.map(c => `<div class="item os-item"><a href="#conta/${c.id}" style="color:inherit;text-decoration:none;display:block">
          <div class="os-top"><b>${esc(CONTA_CAT[c.categoria] || 'Outros')}</b>${tagConta(c)}</div>
          <div class="os-meio"><span>${esc(c.descricao)}</span><b class="valor">${brl(c.valor)}</b></div>
          <div class="meta">Vence ${dataBR(c.vencimento)}${c.fornecedor ? ' · ' + esc(c.fornecedor) : ''}${c.recorrente ? ' · repete todo mês' : ''}${c.pago_em ? ' · paga em ' + dataBR(c.pago_em) : ''}</div></a>
          ${c.status === 'a_pagar' ? `<button class="btn vd peq" style="margin-top:10px" data-pagar="${c.id}">Marcar como paga</button>` : ''}</div>`).join('')
        : `<div class="vazio">Nenhuma conta ${f.verC === 'todas' ? 'neste mês' : 'neste filtro'}.<br>Lance as despesas da empresa: parcela do caminhão, seguro, salários, manutenção. As que repetem todo mês aparecem sozinhas nos meses seguintes.</div>`}`;
  }
  V.innerHTML = html;
  ligaChips('aba', v => location.hash = 'servicos/' + v);
  ligaChips('sec', v => { f.sec = v; rota(); });
  ligaChips('ver', v => { f.ver = v; rota(); });
  ligaChips('verC', v => { f.verC = v; rota(); });
  V.querySelectorAll('[data-sec]').forEach(b => b.onclick = e => { e.preventDefault(); f.sec = b.dataset.sec; rota(); });
  ligaFixas(f);
  $('#mAnt').onclick = () => { f.mes = somaMes(f.mes, -1); rota(); };
  $('#mProx').onclick = () => { if (f.mes <= mesISO()) { f.mes = somaMes(f.mes, 1); rota(); } };
  V.querySelectorAll('[data-pagar]').forEach(b => b.onclick = () => comBotao(b, async () => {
    try { ok(await sb.from('gf_contas').update({ status: 'pago', pago_em: hojeISO() }).eq('id', b.dataset.pagar)); toast('Conta marcada como paga.'); rota(); } catch (er) { falha(er); }
  }));
  const v2 = n => String(Number(n || 0).toFixed(2)).replace('.', ',');
  if ($('#finCsv')) $('#finCsv').onclick = () => csv([
    ...doMes.map(o => ({ Tipo: 'Entrada (OS)', Numero: o.numero, Data: dataBR(o.data), Descricao: o.cliente, Categoria: OS_PAGADOR[o.pagador_tipo], Valor: v2(o.valor),
      Custos: v2(custoOS(o)), Situacao: OS_STATUS[o.status], Vencimento: dataBR(o.vencimento), Pago_em: dataBR(o.pago_em),
      Detalhe: [o.origem && o.destino ? o.origem + ' > ' + o.destino : '', o.veiculo || '', o.placa || ''].filter(Boolean).join(' · ') })),
    ...contas.map(c => ({ Tipo: 'Saída (conta)', Numero: '', Data: dataBR(c.vencimento), Descricao: c.descricao, Categoria: CONTA_CAT[c.categoria], Valor: v2(c.valor),
      Custos: '', Situacao: c.status === 'pago' ? 'Paga' : 'A pagar', Vencimento: dataBR(c.vencimento), Pago_em: dataBR(c.pago_em), Detalhe: c.fornecedor || '' }))], `gf-financeiro-${f.mes}.csv`);
}

async function telaConta(id) {
  const nova = id === 'nova';
  const c = nova ? { vencimento: hojeISO(), categoria: 'outros', status: 'a_pagar', forma: 'pix', recorrente: false }
    : ok(await sb.from('gf_contas').select('*').eq('id', id).maybeSingle());
  if (!c) { titulo('Conta'); V.innerHTML = '<div class="vazio"><h2>Conta não encontrada</h2><a href="#servicos/financeiro">Voltar ao financeiro</a></div>'; return; }
  titulo(nova ? 'Nova conta' : 'Conta');
  const bancos = await listaBancos();
  const op = (obj, at) => Object.entries(obj).map(([v, t]) => `<option value="${v}" ${v === at ? 'selected' : ''}>${esc(t)}</option>`).join('');
  V.innerHTML = `${!nova ? `<div class="item destaque"><div class="os-top"><b style="font-size:18px">${esc(c.descricao)}</b>${tagConta(c)}</div>
      <div class="meta">${esc(CONTA_CAT[c.categoria])}${c.recorrente ? ' · repete todo mês' : ''}</div>
      ${c.status === 'a_pagar' ? '<button class="btn vd full" id="ctPago" style="margin-top:12px">Marcar como paga hoje</button>' : ''}</div>` : ''}
  <form id="fCt" novalidate>
    <label for="cDs">Descrição</label><input id="cDs" name="descricao" maxlength="120" value="${esc(c.descricao || '')}" placeholder="Ex.: parcela do caminhão, seguro, salário do motorista" required>
    <div class="dupla"><div><label for="cCat">Categoria</label><select id="cCat" name="categoria">${op(CONTA_CAT, c.categoria)}</select></div>
      <div><label for="cVal">Valor (R$)</label><input id="cVal" name="valor" inputmode="decimal" value="${c.valor != null ? String(c.valor).replace('.', ',') : ''}" placeholder="Ex.: 3.500" required></div></div>
    <div class="dupla"><div><label for="cVc">Vencimento</label><input id="cVc" name="vencimento" type="date" value="${esc(c.vencimento)}" required></div>
      <div><label for="cSt">Situação</label><select id="cSt" name="status">${op({ a_pagar: 'A pagar', pago: 'Paga' }, c.status)}</select></div></div>
    <div class="dupla"><div><label for="cFo">Para quem (opcional)</label><input id="cFo" name="fornecedor" maxlength="120" value="${esc(c.fornecedor || '')}" placeholder="Ex.: banco, oficina"></div>
      <div><label for="cFm">Forma</label><select id="cFm" name="forma">${op(CONTA_FORMA, c.forma || 'pix')}</select></div></div>
    ${bancos.length ? `<label for="cBc">Pago com</label><select id="cBc" name="banco_id"><option value="">Não informar</option>${bancos.map(x => `<option value="${x.id}" ${x.id === c.banco_id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>` : ''}
    <label class="chk" style="margin-top:14px"><input type="checkbox" name="recorrente" value="1" ${c.recorrente ? 'checked' : ''}><span><b>Repete todo mês</b> no mesmo dia (parcela, seguro, salário, aluguel). Desmarque quando parar.</span></label>
    <label for="cOb">Observação</label><textarea id="cOb" name="obs" maxlength="1000">${esc(c.obs || '')}</textarea>
    <button class="btn full grande" style="margin-top:16px">${nova ? 'Salvar conta' : 'Salvar alterações'}</button>
  </form>
  ${!nova ? '<button class="btn perigo full" id="ctDel" style="margin-top:12px">Excluir conta</button>' : ''}
  <a class="btn fant full" href="#servicos/financeiro" style="margin-top:12px">Voltar ao financeiro</a>`;
  $('#fCt').addEventListener('input', () => { $('#fCt').dataset.sujo = '1'; });
  $('#fCt').onsubmit = e => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
    if (fd.descricao.trim().length < 2) { $('#cDs').focus(); return toast('Descreva a conta.', true); }
    const valor = valorDigitado(fd.valor);
    if (!(valor >= 0)) { $('#cVal').focus(); return toast('Informe o valor da conta.', true); }
    if (!fd.vencimento) return toast('Informe o vencimento.', true);
    const dados = { descricao: fd.descricao.trim(), categoria: fd.categoria, valor, vencimento: fd.vencimento, status: fd.status,
      fornecedor: fd.fornecedor.trim() || null, forma: fd.forma, recorrente: !!fd.recorrente, obs: fd.obs.trim() || null };
    if ('banco_id' in fd) dados.banco_id = fd.banco_id || null;
    comBotao(e.target.querySelector('button'), async () => {
      try {
        if (nova) ok(await sb.from('gf_contas').insert(dados)); else ok(await sb.from('gf_contas').update(dados).eq('id', c.id));
        toast(nova ? 'Conta salva.' : 'Conta atualizada.'); delete $('#fCt').dataset.sujo;
        (S.filtros.fin ||= { mes: mesISO(), ver: 'todas', sec: 'contas', verC: 'todas' }).sec = 'contas';
        location.hash = 'servicos/financeiro';
      } catch (er) { falha(er); }
    });
  };
  if ($('#ctPago')) $('#ctPago').onclick = e => comBotao(e.currentTarget, async () => {
    try { ok(await sb.from('gf_contas').update({ status: 'pago', pago_em: hojeISO() }).eq('id', c.id)); toast('Conta marcada como paga.'); rota(); } catch (er) { falha(er); }
  });
  if ($('#ctDel')) $('#ctDel').onclick = async () => {
    if (!await perguntar({ titulo: 'Excluir esta conta?', texto: c.recorrente ? 'Só este mês é excluído. Para parar de repetir, desmarque "Repete todo mês" na última conta.' : 'Não dá para desfazer.', ok: 'Excluir', perigo: true })) return;
    try { ok(await sb.from('gf_contas').delete().eq('id', c.id)); toast('Conta excluída.'); location.hash = 'servicos/financeiro'; } catch (er) { falha(er); }
  };
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
  const bancos = await listaBancos();
  V.innerHTML = `${!nova ? `<div class="item destaque"><div class="os-top"><b style="font-size:20px">${numOS(o.numero)}</b>${tagOS(o)}</div>
      <div class="meta">${gf ? `Atendimento pelo GF · <a href="#pedido/${o.pedido_id}">ver atendimento</a>` : 'Lançada à mão'} · criada ${dataHora(o.criado_em)}</div>
      ${o.status === 'a_receber' ? '<button class="btn vd full" id="osPago" style="margin-top:12px">Marcar como pago hoje</button>' : ''}
      <a class="btn fant full" href="#recibo/${o.id}" style="margin-top:10px">${o.status === 'pago' ? 'Recibo em PDF' : 'Cobrança em PDF'}</a></div>` : ''}
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
    ${bancos.length ? `<label for="oBc">Recebido em</label><select id="oBc" name="banco_id"><option value="">Não informar</option>${bancos.map(x => `<option value="${x.id}" ${x.id === o.banco_id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>` : ''}
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
    if ('banco_id' in fd) dados.banco_id = fd.banco_id || null;
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

// ───────── despesas fixas: modelos prontos, viram contas que repetem todo mês ─────────
const FIXAS_MODELOS = [
  ['caminhao', 'Parcela do caminhão', 10], ['seguro', 'Seguro do caminhão', 10], ['salario', 'Salário do motorista', 5],
  ['salario', 'Pró-labore (retirada do dono)', 5], ['impostos', 'Contador', 10], ['impostos', 'Simples / DAS / MEI', 20],
  ['telefone', 'Celular e internet', 15], ['outros', 'Rastreador', 10], ['aluguel', 'Aluguel do pátio / garagem', 5],
  ['manutencao', 'Reserva para manutenção e pneus', 25]];
async function secaoFixas(contasMes) {
  const series = ok(await sb.from('gf_contas').select('id,descricao,categoria,valor,vencimento,recorrente,serie_id').not('serie_id', 'is', null)
    .order('vencimento', { ascending: false }).limit(1000));
  const ultima = {}; series.forEach(c => { if (!ultima[c.serie_id]) ultima[c.serie_id] = c; });
  const ativas = Object.values(ultima).filter(c => c.recorrente).sort((a, b) => Number(b.valor) - Number(a.valor));
  const total = ativas.reduce((s, c) => s + Number(c.valor), 0);
  const nomes = new Set(ativas.map(c => c.descricao.toLowerCase()));
  const modelos = FIXAS_MODELOS.filter(([, n]) => !nomes.has(n.toLowerCase()));
  return `<div class="fin-res ${total ? 'neg' : ''}" style="background:#0F172A"><span>Despesas fixas por mês</span><b style="color:#fff">${brl(total)}</b>
      <small>${ativas.length ? `${ativas.length} despesa${ativas.length > 1 ? 's' : ''} que repete${ativas.length > 1 ? 'm' : ''} todo mês. É o mínimo que a empresa precisa faturar (além do diesel e custos de cada serviço).` : 'Nenhuma ainda. Use os modelos abaixo: escolha, coloque o valor e pronto.'}</small></div>
    ${ativas.length ? `<h3 class="sec-t">Suas despesas fixas</h3>${ativas.map(c => `<a class="item os-item" href="#conta/${c.id}">
        <div class="os-top"><b>${esc(CONTA_CAT[c.categoria] || 'Outros')}</b><span class="tag">todo dia ${Number(c.vencimento.slice(8))}</span></div>
        <div class="os-meio"><span>${esc(c.descricao)}</span><b class="valor">${brl(c.valor)}</b></div></a>`).join('')}` : ''}
    ${modelos.length ? `<h3 class="sec-t">Adicionar despesa fixa</h3><p class="vs-dica">Coloque o valor de cada uma que você tem e toque em salvar. As outras ficam em branco. Dá para mudar depois.</p>
    <form id="fFix" novalidate class="fix-lista">${modelos.map(([cat, nome, dia], i) => `<div class="fix-it">
        <label for="fx${i}"><b>${esc(nome)}</b><small>${esc(CONTA_CAT[cat])} · vence dia</small></label>
        <input class="fix-dia" type="number" min="1" max="28" value="${dia}" data-dia="${i}" aria-label="Dia do vencimento de ${esc(nome)}">
        <input id="fx${i}" class="fix-val" inputmode="decimal" placeholder="R$ 0,00" data-i="${i}" data-cat="${cat}" data-nome="${esc(nome)}"></div>`).join('')}
      <button class="btn full grande" style="margin-top:12px">Salvar despesas fixas</button></form>` : ''}
    <a class="btn fant full" href="#conta/nova" style="margin-top:12px">+ Outra despesa (marque "Repete todo mês")</a>`;
}
function ligaFixas(f) {
  const form = $('#fFix'); if (!form) return;
  form.addEventListener('input', () => { form.dataset.sujo = '1'; });
  form.onsubmit = e => {
    e.preventDefault();
    const hoje = hojeISO(), mes = f.mes || mesISO();
    const linhas = [...form.querySelectorAll('.fix-val')].filter(i => i.value.trim()).map(i => {
      const dia = Math.min(28, Math.max(1, Number(form.querySelector(`[data-dia="${i.dataset.i}"]`).value) || 10));
      const venc = `${mes}-${String(dia).padStart(2, '0')}`;
      return { descricao: i.dataset.nome, categoria: i.dataset.cat, valor: valorDigitado(i.value), vencimento: venc, status: 'a_pagar', recorrente: true, forma: 'pix', _ok: venc >= '0' && hoje };
    });
    if (!linhas.length) return toast('Coloque o valor de pelo menos uma despesa.', true);
    if (linhas.some(l => !(l.valor > 0))) return toast('Confira os valores: use só números, ex.: 3.500', true);
    comBotao(form.querySelector('button'), async () => {
      try {
        ok(await sb.from('gf_contas').insert(linhas.map(({ _ok, ...l }) => l)));
        delete form.dataset.sujo; toast(`${linhas.length} despesa${linhas.length > 1 ? 's' : ''} fixa${linhas.length > 1 ? 's' : ''} salva${linhas.length > 1 ? 's' : ''}. Elas aparecem todo mês.`); rota();
      } catch (er) { falha(er); }
    });
  };
}

// ───────── contas bancárias e caixa ─────────
const BANCO_TIPO = { banco: 'Conta no banco', caixa: 'Caixa (dinheiro)', carteira: 'Carteira digital' };
async function listaBancos() { try { return ok(await sb.from('gf_bancos').select('id,nome,tipo').eq('ativo', true).order('criado_em')); } catch { return []; } }
async function secaoBancos() {
  let saldos = []; try { saldos = await rpc('gf_saldos'); } catch { /* ainda não publicado */ }
  const total = saldos.reduce((t, x) => t + Number(x.saldo), 0);
  return `<div class="fin-res ${total >= 0 ? 'pos' : 'neg'}"><span>Saldo total</span><b>${brl(total)}</b>
      <small>${saldos.length ? 'Saldo inicial + o que você recebeu nas OS − o que pagou nas contas, em cada conta.' : 'Cadastre seu banco e o caixa para ver o saldo de cada um.'}</small></div>
    ${saldos.map(x => `<a class="item os-item" href="#banco/${x.banco_id}"><div class="os-top"><b>${esc(BANCO_TIPO[x.tipo] || '')}</b></div>
      <div class="os-meio"><span>${esc(x.nome)}</span><b class="valor ${Number(x.saldo) < 0 ? 'neg' : ''}">${brl(x.saldo)}</b></div>
      <div class="meta">Entrou ${brl(x.entradas)} · saiu ${brl(x.saidas)}</div></a>`).join('')}
    <a class="btn full grande" href="#banco/novo" style="margin-top:12px">+ Nova conta bancária ou caixa</a>
    <p class="vs-dica" style="margin-top:10px">Ao marcar uma OS como paga ou uma conta como paga, escolha em qual conta entrou ou saiu o dinheiro. O saldo atualiza sozinho.</p>`;
}
async function telaBanco(id) {
  const novo = id === 'novo';
  const b = novo ? { tipo: 'banco', saldo_inicial: 0, data_inicial: hojeISO() } : ok(await sb.from('gf_bancos').select('*').eq('id', id).maybeSingle());
  if (!b) { titulo('Conta'); V.innerHTML = '<div class="vazio"><h2>Conta não encontrada</h2><a href="#servicos/financeiro">Voltar</a></div>'; return; }
  titulo(novo ? 'Nova conta bancária' : b.nome);
  V.innerHTML = `<form id="fBc" novalidate>
    <label for="bN">Nome</label><input id="bN" name="nome" maxlength="60" value="${esc(b.nome || '')}" placeholder="Ex.: Sicredi, Nubank, Caixa da empresa" required>
    <label for="bT">Tipo</label><select id="bT" name="tipo">${Object.entries(BANCO_TIPO).map(([v, t]) => `<option value="${v}" ${v === b.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <div class="dupla"><div><label for="bS">Saldo de hoje (R$)</label><input id="bS" name="saldo_inicial" inputmode="decimal" value="${String(b.saldo_inicial ?? 0).replace('.', ',')}"></div>
      <div><label for="bD">Data desse saldo</label><input id="bD" name="data_inicial" type="date" value="${esc(b.data_inicial)}"></div></div>
    <p class="vs-dica">Coloque o saldo que está no extrato hoje. Daí em diante o GF soma o que entra e tira o que sai.</p>
    <button class="btn full grande" style="margin-top:14px">${novo ? 'Salvar conta' : 'Salvar alterações'}</button></form>
    ${!novo ? '<button class="btn perigo full" id="bDel" style="margin-top:12px">Desativar esta conta</button>' : ''}
    <a class="btn fant full" href="#servicos/financeiro" style="margin-top:12px">Voltar ao financeiro</a>`;
  $('#fBc').onsubmit = e => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
    if (fd.nome.trim().length < 2) { $('#bN').focus(); return toast('Dê um nome para a conta.', true); }
    const saldo = fd.saldo_inicial.trim() ? valorDigitado(fd.saldo_inicial.replace('-', '')) * (fd.saldo_inicial.trim().startsWith('-') ? -1 : 1) : 0;
    if (!Number.isFinite(saldo)) return toast('Confira o saldo.', true);
    const dados = { nome: fd.nome.trim(), tipo: fd.tipo, saldo_inicial: saldo, data_inicial: fd.data_inicial || hojeISO() };
    comBotao(e.target.querySelector('button'), async () => {
      try {
        if (novo) ok(await sb.from('gf_bancos').insert(dados)); else ok(await sb.from('gf_bancos').update(dados).eq('id', b.id));
        toast('Conta salva.'); (S.filtros.fin ||= { mes: mesISO() }).sec = 'bancos'; location.hash = 'servicos/financeiro';
      } catch (er) { falha(er); }
    });
  };
  if ($('#bDel')) $('#bDel').onclick = async () => {
    if (!await perguntar({ titulo: `Desativar ${b.nome}?`, texto: 'Ela some da lista e do saldo. As OS e contas ligadas a ela continuam no financeiro.', ok: 'Desativar', perigo: true })) return;
    try { ok(await sb.from('gf_bancos').update({ ativo: false }).eq('id', b.id)); toast('Conta desativada.'); location.hash = 'servicos/financeiro'; } catch (er) { falha(er); }
  };
}

// ───────── recibo / cobrança da OS (imprimir ou salvar em PDF) ─────────
function porExtenso(v) {
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = n => { if (n === 100) return 'cem'; const p = []; if (n >= 100) p.push(c[Math.floor(n / 100)]); n %= 100;
    if (n >= 20) { p.push(d[Math.floor(n / 10)]); if (n % 10) p.push(u[n % 10]); } else if (n) p.push(u[n]); return p.join(' e '); };
  const inteiro = n => { if (!n) return 'zero'; const mi = Math.floor(n / 1e6), mil = Math.floor(n % 1e6 / 1000), r = n % 1000; const p = [];
    if (mi) p.push(mi === 1 ? 'um milhão' : ate999(mi) + ' milhões'); if (mil) p.push(mil === 1 ? 'mil' : ate999(mil) + ' mil'); if (r) p.push(ate999(r));
    return p.length > 1 && r && (r < 100 || r % 100 === 0) ? p.slice(0, -1).join(' ') + ' e ' + p[p.length - 1] : p.join(' '); };
  const reaisN = Math.floor(v + 1e-9), cent = Math.round((v - reaisN) * 100);
  let t = `${inteiro(reaisN)} ${reaisN === 1 ? 'real' : 'reais'}`;
  if (reaisN >= 1e6 && reaisN % 1e6 === 0) t = t.replace(' reais', ' de reais');
  if (cent) t += ` e ${inteiro(cent)} centavo${cent > 1 ? 's' : ''}`;
  return reaisN ? t : `${inteiro(cent)} centavo${cent > 1 ? 's' : ''}`;
}
async function telaRecibo(id) {
  const o = ok(await sb.from('gf_os').select('*').eq('id', id).maybeSingle());
  if (!o) { titulo('Recibo'); V.innerHTML = '<div class="vazio"><h2>OS não encontrada</h2><a href="#servicos/financeiro">Voltar</a></div>'; return; }
  const pago = o.status === 'pago'; const P = S.perfil || {};
  titulo(pago ? 'Recibo' : 'Cobrança');
  V.innerHTML = `<div class="recibo">
    <div class="rc-top"><img src="/assets/gf-mark.png" alt="" class="rc-logo"><div><b>${esc(P.empresa || P.nome || '')}</b>
      <span>${esc(P.empresa ? P.nome : '')}${P.cidade ? (P.empresa ? ' · ' : '') + esc(P.cidade) : ''}${P.whatsapp ? ' · WhatsApp ' + esc(mascaraZap ? mascaraZap(P.whatsapp) : P.whatsapp) : ''}</span></div>
      <div class="rc-num">${pago ? 'RECIBO' : 'COBRANÇA'}<b>${numOS(o.numero)}</b></div></div>
    <div class="rc-valor">${brl(o.valor)}</div>
    <p class="rc-txt">${pago ? `Recebi de <b>${esc(o.cliente)}</b> a importância de <b>${brl(o.valor)}</b> (${esc(porExtenso(Number(o.valor)))}), referente ao serviço de transporte/guincho descrito abaixo.`
      : `Valor a pagar por <b>${esc(o.cliente)}</b>: <b>${brl(o.valor)}</b> (${esc(porExtenso(Number(o.valor)))}), referente ao serviço de transporte/guincho descrito abaixo${o.vencimento ? `, com vencimento em <b>${dataBR(o.vencimento)}</b>` : ''}.`}</p>
    <dl class="rc-dl">
      <div><dt>Data do serviço</dt><dd>${dataBR(o.data)}</dd></div>
      ${o.origem || o.destino ? `<div><dt>Trajeto</dt><dd>${esc(o.origem || '–')} › ${esc(o.destino || '–')}</dd></div>` : ''}
      ${o.veiculo || o.placa ? `<div><dt>Veículo</dt><dd>${esc(o.veiculo || '')}${o.placa ? ' · placa ' + esc(o.placa) : ''}</dd></div>` : ''}
      ${o.km ? `<div><dt>Km rodados</dt><dd>${Number(o.km).toLocaleString('pt-BR')} km</dd></div>` : ''}
      <div><dt>Forma de pagamento</dt><dd>${esc(OS_FORMA[o.forma] || '')}</dd></div>
      ${pago && o.pago_em ? `<div><dt>Pago em</dt><dd>${dataBR(o.pago_em)}</dd></div>` : ''}
      ${o.obs ? `<div><dt>Observação</dt><dd>${esc(o.obs)}</dd></div>` : ''}
    </dl>
    <div class="rc-ass"><i></i><span>${esc(P.nome || '')}${P.empresa ? ' · ' + esc(P.empresa) : ''}</span></div>
    <p class="rc-pe">Emitido pelo GF · Guincho Fácil em ${new Date().toLocaleDateString('pt-BR')} · appdoguincheiro.com</p>
    <div class="acoes nao-imprime"><button class="btn full grande" id="rcPdf">Salvar em PDF ou imprimir</button>
      <a class="btn fant full" href="#os/${o.id}">Voltar à OS</a></div></div>`;
  $('#rcPdf').onclick = () => window.print();
}

// ───────── Ganhos: visão rápida do guincheiro (hoje, semana, a receber, extrato) ─────────
async function telaGanhos() {
  titulo('Ganhos');
  const hoje = hojeISO();
  const d0 = new Date(hoje + 'T12:00:00'); const dow = (d0.getDay() + 6) % 7; // segunda = 0
  const seg = new Date(d0); seg.setDate(d0.getDate() - dow);
  const iso = x => new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const dias = Array.from({ length: 7 }, (_, i) => { const x = new Date(seg); x.setDate(seg.getDate() + i); return iso(x); });
  const ini = [dias[0], mesISO() + '-01'].sort()[0];
  const [recentes, abertas] = await Promise.all([
    sb.from('gf_os').select('id,numero,data,cliente,origem,destino,valor,status,pago_em,pedido_id,vencimento').neq('status', 'cancelada').gte('data', ini).order('data', { ascending: false }).order('numero', { ascending: false }).limit(500).then(ok),
    sb.from('gf_os').select('id,valor,vencimento').eq('status', 'a_receber').limit(1000).then(ok)]);
  const soma = l => l.reduce((t, o) => t + Number(o.valor), 0);
  const aReceber = soma(abertas), vencido = soma(abertas.filter(vencida));
  const doDia = recentes.filter(o => o.data === hoje), daSemana = recentes.filter(o => o.data >= dias[0] && o.data <= dias[6]);
  const recebidoMes = soma(recentes.filter(o => o.status === 'pago' && o.pago_em && o.pago_em.slice(0, 7) === mesISO()));
  const porDia = dias.map(d => soma(daSemana.filter(o => o.data === d)));
  const max = Math.max(...porDia, 1);
  const extrato = await sb.from('gf_os').select('id,numero,data,cliente,origem,destino,valor,status,pedido_id,vencimento').neq('status', 'cancelada')
    .order('data', { ascending: false }).order('numero', { ascending: false }).limit(30).then(ok);
  const n = l => `${l.length} atendimento${l.length === 1 ? '' : 's'}`;
  V.innerHTML = `<div class="gn-top"><span>A receber</span><b>${brl(aReceber)}</b>
      <small>${vencido ? `${brl(vencido)} já venceu · cobre o cliente` : abertas.length ? `${abertas.length} OS em aberto` : 'Nada em aberto'}</small>
      <a class="btn gn-bt ${aReceber ? '' : 'off'}" href="#servicos/antecipar">Antecipar com a ${esc(ANTECIPACAO.parceira)}</a>
      <small class="gn-nota">O cliente paga direto a você. O GF não segura o seu dinheiro.</small></div>
    <div class="fin-cards">
      <div class="fin-card"><span>Recebido no mês</span><b>${brl(recebidoMes)}</b><small>marcado como pago</small></div>
      <div class="fin-card ${vencido ? 'alerta' : ''}"><span>Vencido</span><b>${brl(vencido)}</b><small>${vencido ? 'cobre hoje' : 'nada vencido'}</small></div>
      <div class="fin-card"><span>Hoje</span><b>${brl(soma(doDia))}</b><small>${n(doDia)}</small></div>
      <div class="fin-card"><span>Esta semana</span><b>${brl(soma(daSemana))}</b><small>${n(daSemana)}</small></div></div>
    <div class="gn-sem"><div class="gn-sem-t"><span>Esta semana</span><b>${brl(soma(daSemana))}</b></div>
      <div class="gn-barras" role="img" aria-label="Ganhos por dia da semana">${dias.map((d, i) => `<div class="${d === hoje ? 'hoje' : ''}">
        <i style="height:${Math.max(4, Math.round(porDia[i] / max * 100))}%" title="${brl(porDia[i])}"></i><span>${'STQQSSD'[i]}</span></div>`).join('')}</div></div>
    <h3 class="sec-t">Extrato</h3>
    ${extrato.length ? `<div class="gn-ext">${extrato.map(o => `<a href="#os/${o.id}"><div><b>${esc(o.origem && o.destino ? o.origem + ' › ' + o.destino : o.cliente)}</b>
        <span>${dataBR(o.data)} · ${o.origem && o.destino ? esc(o.cliente) : 'OS nº ' + o.numero}${o.pedido_id ? ' · pelo GF' : ''}</span></div><div class="v"><b>${brl(o.valor)}</b>${tagOS(o)}</div></a>`).join('')}</div>`
      : '<div class="vazio">Seus ganhos aparecem aqui depois do primeiro atendimento concluído.<br>Serviço de fora do GF? Lance em <a href="#os/nova">Nova OS</a>.</div>'}
    <div class="dupla" style="margin-top:14px"><a class="btn fant" href="#os/nova">+ Lançar serviço</a><a class="btn fant" href="#servicos/financeiro">Financeiro completo</a></div>`;
}
