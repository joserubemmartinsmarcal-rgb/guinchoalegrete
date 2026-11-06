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

// ───────── localização aproximada durante o atendimento ─────────
// Com o app aberto, a cada minuto o guincheiro com serviço em andamento envia a
// posição; o cliente vê "onde está o guincho" com link para o Google Maps.
let locTimer = null;
async function locEnviar() {
  if (!S.user || !ehGuincho() || !navigator.geolocation || document.hidden) return;
  try {
    const d = ok(await sb.from('gf_pedidos').select('id').eq('prestador_id', S.user.id).in('status', ['aceito', 'a_caminho', 'no_local', 'em_transporte']).limit(5));
    if (!d.length) return;
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 }));
    for (const p of d) await rpc('gf_atualizar_local', { p_pedido: p.id, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude });
  } catch { /* sem permissão ou sem sinal: tenta no próximo minuto */ }
}
function locIniciar() { clearInterval(locTimer); locTimer = setInterval(locEnviar, 60000); locEnviar(); }
async function blocoLocal(p) {
  try {
    const l = ok(await sb.from('gf_localizacoes').select('lat,lng,atualizado_em').eq('pedido_id', p.id).maybeSingle());
    if (!l) return `<div class="local"><b>Localização do guincho</b><span>Aparece aqui quando o guincheiro estiver com o app aberto a caminho.</span></div>`;
    const min = Math.max(0, Math.round((Date.now() - new Date(l.atualizado_em)) / 6e4));
    return `<a class="local on" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${l.lat},${l.lng}"><b>Onde está o guincho</b>
      <span>Atualizado ${min ? `há ${min} min` : 'agora'} · toque para ver no Google Maps</span></a>`;
  } catch { return ''; }
}
