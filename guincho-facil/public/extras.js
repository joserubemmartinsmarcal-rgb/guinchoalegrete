'use strict';
// GF · Recursos do atendimento: link de acompanhamento sem login, código de chegada,
// chat cliente ↔ guincheiro e a conta "vale a pena?" do guincheiro.
// Usa as utilidades globais do app.js ($, V, S, sb, rpc, ok, esc, toast...).

const linkAcompanhar = token => `${location.origin}/acompanhar?t=${token}`;

// ───────── acompanhamento + código de chegada ─────────
async function blocoAcompanhamento(p, papel) {
  if (!p.prestador_id || !['aceito', 'a_caminho', 'no_local', 'em_transporte', 'concluido'].includes(p.status)) return '';
  let a = null; try { a = await rpc('gf_meu_acompanhamento', { p_pedido: p.id }); } catch { return ''; }
  if (!a) return '';
  const ativo = p.status !== 'concluido';
  const confirmada = a.chegada_confirmada_em;
  let html = '<div class="acomp">';
  if (papel === 'cliente') {
    if (ativo && !confirmada) html += `<div class="cod-chegada"><span>Código de chegada</span><b aria-label="Código ${a.codigo.split('').join(' ')}">${esc(a.codigo)}</b>
      <small>Passe este código ao guincheiro só quando ele chegar. É a prova de que o atendimento aconteceu.</small></div>`;
  } else if (ativo && !confirmada && ['aceito', 'a_caminho', 'no_local'].includes(p.status)) {
    html += `<form class="cod-form" id="fCod" novalidate><label for="codIn">Chegou? Peça o código de 4 números ao cliente</label>
      <div class="cod-linha"><input id="codIn" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="0000" aria-describedby="codAj">
      <button class="btn">Confirmar chegada</button></div>
      <small id="codAj">Confirma sua chegada no horário certo e protege você em caso de reclamação.</small></form>`;
  }
  if (confirmada) html += `<div class="cod-ok">✓ Chegada confirmada pelo código às ${hora(confirmada)}</div>`;
  if (ativo) html += `<button class="btn fant full" id="btLinkAc" type="button">Mandar link de acompanhamento</button>
    <small class="acomp-aj">Quem recebe o link vê as etapas e onde está o guincho, sem precisar de conta. ${papel === 'cliente' ? 'Mande para quem vai receber o veículo.' : 'Mande para o dono do veículo ou a oficina.'}</small>`;
  return html + '</div>';
}
function hora(t) { return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function ligaAcompanhamento(p) {
  const f = $('#fCod');
  if (f) {
    $('#codIn').oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); };
    f.onsubmit = e => {
      e.preventDefault(); const c = $('#codIn').value;
      if (c.length !== 4) { $('#codIn').focus(); return toast('O código tem 4 números.', true); }
      comBotao(f.querySelector('button'), async () => {
        try { await rpc('gf_confirmar_chegada', { p_pedido: p.id, p_codigo: c }); toast('Chegada confirmada.'); rota(); }
        catch (er) { falha(er); }
      });
    };
  }
  const b = $('#btLinkAc');
  if (b) b.onclick = () => comBotao(b, async () => {
    try {
      const a = await rpc('gf_meu_acompanhamento', { p_pedido: p.id });
      const link = linkAcompanhar(a.token);
      const msg = `Acompanhe o transporte do ${p.veiculo} (${p.origem} › ${p.destino}) pelo GF: ${link}`;
      if (navigator.share) { try { await navigator.share({ title: 'Acompanhar transporte · GF', text: msg }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      const w = window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank'); if (w) w.opener = null;
      else { try { await navigator.clipboard.writeText(link); toast('Link copiado.'); } catch { toast(link); } }
    } catch (er) { falha(er); }
  });
}

// ───────── chat do atendimento ─────────
async function blocoChat(p) {
  if (!p.prestador_id || p.status === 'cancelado') return '';
  if (p.status === 'concluido' && p.concluido_em && Date.now() - new Date(p.concluido_em) > 7 * 864e5) return '';
  return `<h3 class="sec-t">Conversa</h3><div class="chat" id="chat" aria-live="polite"><div class="chat-lista" id="chatLista"><div class="vs-dica">Carregando…</div></div>
    <form class="chat-form" id="fChat" novalidate><label for="chatIn" class="sr">Mensagem</label>
    <input id="chatIn" maxlength="1000" autocomplete="off" placeholder="Escreva uma mensagem">
    <button class="btn" aria-label="Enviar">Enviar</button></form>
    <div class="chat-rapidas">${['Estou a caminho', 'Chego em 10 min', 'Cheguei no local', 'Veículo carregado'].map(t => `<button type="button" data-rap="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
}
async function carregaChat(pedidoId) {
  const el = $('#chatLista'); if (!el) return;
  try {
    const m = ok(await sb.from('gf_mensagens').select('id,autor_id,texto,criado_em').eq('pedido_id', pedidoId).order('criado_em').limit(200));
    const perto = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const ant = el.dataset.n;
    el.innerHTML = m.length ? m.map(x => `<div class="msg ${x.autor_id === S.user.id ? 'eu' : ''}"><p>${esc(x.texto)}</p><time>${hora(x.criado_em)}</time></div>`).join('')
      : '<div class="vs-dica">Nenhuma mensagem ainda. Combine detalhes aqui: endereço exato, horário, chave do veículo.</div>';
    el.dataset.n = m.length;
    if (perto || ant !== String(m.length)) el.scrollTop = el.scrollHeight;
  } catch { /* tabela ainda não publicada */ }
}
function ligaChat(p) {
  const f = $('#fChat'); if (!f) return;
  carregaChat(p.id);
  clearInterval(S.timerChat);
  const h = location.hash;
  S.timerChat = setInterval(() => { if (location.hash !== h || !$('#chatLista')) return clearInterval(S.timerChat); if (!document.hidden) carregaChat(p.id); }, 8000);
  const envia = async texto => {
    try { await rpc('gf_enviar_mensagem', { p_pedido: p.id, p_texto: texto }); $('#chatIn').value = ''; await carregaChat(p.id); }
    catch (er) { falha(er); }
  };
  f.onsubmit = e => {
    e.preventDefault(); const t = $('#chatIn').value.trim(); if (!t) return;
    comBotao(f.querySelector('button'), () => envia(t));
  };
  V.querySelectorAll('[data-rap]').forEach(b => b.onclick = () => comBotao(b, () => envia(b.dataset.rap)));
}

// ───────── "vale a pena?" — conta só do guincheiro, fica no aparelho ─────────
const CUSTO_PADRAO = { consumo: 4.5, diesel: 6.3, desgaste: 0.6 };
function custoCfg() { try { return { ...CUSTO_PADRAO, ...JSON.parse(localStorage.getItem('gf-custo') || '{}') }; } catch { return { ...CUSTO_PADRAO }; } }
function blocoCusto(p) {
  if (p.status !== 'aberto' || !S.perfil?.cidade) return '';
  const base = S.perfil.cidade;
  const ida = GF_GEO.km(base, p.origem), viagem = GF_GEO.km(p.origem, p.destino), volta = GF_GEO.km(p.destino, base);
  if (ida == null || viagem == null || volta == null) return '';
  return `<details class="custo" id="custo"><summary><b>Vale a pena?</b> <span id="custoResumo"></span></summary>
    <div class="custo-corpo"><p class="vs-dica">Conta aproximada, só você vê. Saindo de ${esc(base)}: ${kmTxt(ida)} até a retirada, ${kmTxt(viagem)} de transporte e ${kmTxt(volta)} de volta.</p>
    <div class="custo-cfg"><label>Consumo (km/l)<input id="cuCons" inputmode="decimal"></label><label>Diesel (R$/l)<input id="cuDies" inputmode="decimal"></label><label>Desgaste (R$/km)<input id="cuDesg" inputmode="decimal"></label></div>
    <dl class="custo-res" id="custoRes"></dl></div></details>`;
}
function ligaCusto(p) {
  if (!$('#custo')) return;
  const base = S.perfil.cidade, total = GF_GEO.km(base, p.origem) + GF_GEO.km(p.origem, p.destino) + GF_GEO.km(p.destino, base);
  const c = custoCfg(); const num = v => Number(String(v).replace(',', '.'));
  $('#cuCons').value = String(c.consumo).replace('.', ','); $('#cuDies').value = String(c.diesel).replace('.', ','); $('#cuDesg').value = String(c.desgaste).replace('.', ',');
  const calc = () => {
    const cfg = { consumo: num($('#cuCons').value) || CUSTO_PADRAO.consumo, diesel: num($('#cuDies').value) || 0, desgaste: num($('#cuDesg').value) || 0 };
    try { localStorage.setItem('gf-custo', JSON.stringify(cfg)); } catch { /* sem armazenamento */ }
    const custo = total / cfg.consumo * cfg.diesel + total * cfg.desgaste;
    const v = Number(p.valor_oferecido) || 0;
    const sobra = v - custo;
    $('#custoRes').innerHTML = `<div><dt>Rodagem total</dt><dd>${kmTxt(total)}</dd></div><div><dt>Custo estimado</dt><dd>${brl(custo)}</dd></div>
      ${v ? `<div class="${sobra >= 0 ? 'pos' : 'neg'}"><dt>Sobra com ${brl(v)}</dt><dd>${brl(sobra)}</dd></div>` : `<div><dt>Para não ter prejuízo, cobre acima de</dt><dd>${brl(custo)}</dd></div>`}`;
    $('#custoResumo').textContent = v ? (sobra >= 0 ? `sobra ~${brl(sobra)}` : `prejuízo ~${brl(-sobra)}`) : `custo ~${brl(custo)}`;
    $('#custoResumo').className = v ? (sobra >= 0 ? 'pos' : 'neg') : '';
  };
  ['#cuCons', '#cuDies', '#cuDesg'].forEach(s => $(s).oninput = calc);
  calc();
}
