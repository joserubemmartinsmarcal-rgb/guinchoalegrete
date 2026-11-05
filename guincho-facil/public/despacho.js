'use strict';
// GF · Despacho: chamado urgente para a rede toda. Com o app aberto, o guincheiro
// disponível vê um alarme em tela cheia (som e vibração) até aceitar ou recusar.
// O primeiro que aceitar leva pelo valor oferecido (função gf_pegar_chamado).
// Com o app fechado, chega o aviso no celular ("CHAMADO URGENTE").

const DESP_RECUSADOS = 'gf-chamados-recusados';
let despTimer = null, despAtual = null, despSom = null, despRelogio = null;

function despRecusados() { try { return JSON.parse(sessionStorage.getItem(DESP_RECUSADOS) || '[]'); } catch { return []; } }
function despRecusar(id) { try { sessionStorage.setItem(DESP_RECUSADOS, JSON.stringify([...despRecusados(), id].slice(-50))); } catch { /* sem armazenamento */ } }

// bipe repetido com Web Audio (sem arquivo de som)
function despTocar() {
  despParar();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const bipe = () => {
      [0, 0.22].forEach(t => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.18;
        o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.15);
      });
      navigator.vibrate?.([300, 120, 300]);
    };
    bipe(); despSom = { ctx, timer: setInterval(bipe, 1200) };
  } catch { navigator.vibrate?.([400, 150, 400, 150, 400]); }
}
function despParar() {
  if (despSom) { clearInterval(despSom.timer); despSom.ctx.close?.(); despSom = null; }
  navigator.vibrate?.(0);
}
function despFechar() {
  despParar(); clearInterval(despRelogio); despAtual = null;
  document.getElementById('chamado')?.remove();
}

function despMostrar(p) {
  despAtual = p.id;
  const km = GF_GEO.km(S.perfil.cidade, p.origem);
  const el = document.createElement('div');
  el.id = 'chamado'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'chT');
  el.innerHTML = `<div class="ch-caixa">
    <div class="ch-pulso" aria-hidden="true"></div>
    <p class="ch-t" id="chT">Chamado urgente</p>
    <div class="ch-r">${esc(p.origem)} › ${esc(p.destino)}</div>
    <div class="ch-m">${esc(p.veiculo)}${km != null ? ` · ${km} km de você` : ''}</div>
    <div class="ch-v">${reais(p.valor_oferecido)}</div>
    <div class="ch-tempo">O primeiro que aceitar leva · <b id="chRel">--:--</b></div>
    <button class="ch-ok" id="chOk">Aceitar por ${reais(p.valor_oferecido)}</button>
    <button class="ch-nao" id="chNao">Recusar</button></div>`;
  document.body.appendChild(el);
  const fim = new Date(p.despacho_ate).getTime();
  const tick = () => {
    const s = Math.max(0, Math.round((fim - Date.now()) / 1000));
    const r = document.getElementById('chRel'); if (r) r.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (!s) { despFechar(); toast('O prazo do chamado acabou. Ele segue aberto para propostas.'); }
  };
  tick(); despRelogio = setInterval(tick, 1000);
  despTocar();
  $('#chNao').onclick = () => { despRecusar(p.id); despFechar(); };
  $('#chOk').onclick = e => comBotao(e.currentTarget, async () => {
    despParar();
    try { await rpc('gf_pegar_chamado', { p_pedido: p.id }); despFechar(); toast('Chamado é seu! Combine com o cliente pelo WhatsApp.'); location.hash = 'pedido/' + p.id; contadores(); }
    catch (er) { despRecusar(p.id); despFechar(); falha(er); }
  });
  $('#chOk').focus();
}

async function despVerificar() {
  if (despAtual || !S.user || !ehGuincho() || !aprovado() || !S.perfil?.disponivel || document.hidden) return;
  try {
    const d = ok(await sb.from('gf_pedidos').select('id,origem,destino,veiculo,valor_oferecido,despacho_ate')
      .eq('status', 'aberto').neq('autor_id', S.user.id).gt('despacho_ate', new Date().toISOString()).order('despacho_ate').limit(10));
    const rec = despRecusados();
    const p = d.find(x => !rec.includes(x.id) && new Date(x.despacho_ate) > Date.now());
    if (p && !despAtual) despMostrar(p);
  } catch { /* sem sinal: tenta de novo no próximo ciclo */ }
}
function despIniciar() { clearInterval(despTimer); despTimer = setInterval(despVerificar, 8000); despVerificar(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) despVerificar(); });
