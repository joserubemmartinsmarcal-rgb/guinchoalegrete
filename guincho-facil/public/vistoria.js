'use strict';
// GF · Vistoria digital (termo de constatação) na retirada do veículo.
// Fotos comprimidas no celular, avarias marcadas no desenho do carro,
// checklist, assinatura com o dedo. Funciona sem sinal: a vistoria fica
// guardada no aparelho (IndexedDB) e é enviada quando a conexão volta.
// Usa as utilidades globais do app.js ($, V, S, sb, rpc, esc, toast...).

const VIST_FOTOS = [['frente', 'Frente', true], ['traseira', 'Traseira', true], ['esquerda', 'Lateral esquerda', true], ['direita', 'Lateral direita', true],
  ['painel', 'Painel (km e combustível)', false], ['avaria1', 'Avaria 1', false], ['avaria2', 'Avaria 2', false], ['avaria3', 'Avaria 3', false]];
const VIST_AVARIA = { risco: 'Risco', amassado: 'Amassado', quebrado: 'Quebrado', outro: 'Outro' };
const VIST_ITENS = [['estepe', 'Estepe'], ['macaco', 'Macaco e chave de roda'], ['triangulo', 'Triângulo'], ['documento', 'Documento do veículo'],
  ['chave', 'Chave do veículo'], ['som', 'Rádio / som'], ['tapetes', 'Tapetes']];
const VIST_COMBUSTIVEL = ['Reserva', '1/4', '1/2', '3/4', 'Cheio'];
const VIST_RELACAO = { proprietario: 'Proprietário', condutor: 'Condutor', terceiro: 'Seguradora / terceiro', ausente: 'Ninguém no local' };
const VIST_TERMO = 'Declaro que o veículo descrito foi vistoriado no momento da retirada e que o seu estado é o registrado neste termo, ' +
  'nas fotos, nas avarias marcadas no desenho e no checklist. As avarias marcadas já existiam antes do recolhimento.';

// desenho do carro visto de cima (frente para cima); coordenadas 0–1 relativas a 200×400
const CARRO_SVG = `<rect x="34" y="18" width="132" height="364" rx="56" fill="var(--ap-card)" stroke="var(--gf-ink)" stroke-width="4"/>
  <path d="M52 112 Q100 86 148 112 L140 150 Q100 136 60 150Z" fill="var(--ap-soft)" stroke="var(--gf-ink)" stroke-width="3"/>
  <path d="M60 290 Q100 302 140 290 L148 322 Q100 344 52 322Z" fill="var(--ap-soft)" stroke="var(--gf-ink)" stroke-width="3"/>
  <rect x="60" y="160" width="80" height="120" rx="12" fill="none" stroke="var(--gf-muted)" stroke-width="2" stroke-dasharray="5 5"/>
  <rect x="22" y="70" width="14" height="50" rx="6" fill="var(--gf-ink)"/><rect x="164" y="70" width="14" height="50" rx="6" fill="var(--gf-ink)"/>
  <rect x="22" y="280" width="14" height="50" rx="6" fill="var(--gf-ink)"/><rect x="164" y="280" width="14" height="50" rx="6" fill="var(--gf-ink)"/>
  <text x="100" y="12" text-anchor="middle" font-size="12" font-weight="700" fill="var(--gf-muted)">FRENTE</text>
  <text x="100" y="398" text-anchor="middle" font-size="12" font-weight="700" fill="var(--gf-muted)">TRASEIRA</text>`;
const pinsSvg = av => av.map((a, i) => `<g class="pin" data-i="${i}" transform="translate(${(a.x * 200).toFixed(1)} ${(a.y * 400).toFixed(1)})">
  <circle r="13" fill="#dc2626" stroke="#fff" stroke-width="3"/><text y="5" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">${i + 1}</text></g>`).join('');

// ───────── fila sem sinal (IndexedDB) ─────────
function vistDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('gf-vistoria', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function vistFila(modo, fn) {
  const db = await vistDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('fila', modo); const st = tx.objectStore('fila'); let out;
    Promise.resolve(fn(st)).then(v => { out = v; });
    tx.oncomplete = () => { db.close(); res(out); }; tx.onerror = () => { db.close(); rej(tx.error); };
  });
}
const vistPedidoReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function vistGuardar(item) { return vistFila('readwrite', st => { st.put(item); }); }
async function vistPendentes() { try { return await vistFila('readonly', st => vistPedidoReq(st.getAll())); } catch { return []; } }
async function vistRemover(id) { return vistFila('readwrite', st => { st.delete(id); }); }

let vistSincronizando = false;
async function sincronizarVistorias(silencioso = true) {
  if (vistSincronizando || !S.user || !navigator.onLine) return 0;
  vistSincronizando = true; let enviadas = 0;
  try {
    for (const it of await vistPendentes()) {
      try {
        const pasta = `${it.pedido_id}/${it.id}/`;
        const arquivos = [...it.fotos.map(f => [pasta + f.slot + '.jpg', f.blob, 'image/jpeg']),
          ...(it.assinatura ? [[pasta + 'assinatura.png', it.assinatura, 'image/png']] : [])];
        for (const [path, blob, tipo] of arquivos) {
          const { error } = await sb.storage.from('gf-vistorias').upload(path, blob, { upsert: true, contentType: tipo });
          if (error && !/already exists|Duplicate/i.test(error.message || '')) throw error;
        }
        await rpc('gf_salvar_vistoria', { p: { ...it.dados, id: it.id, pedido_id: it.pedido_id,
          fotos: it.fotos.map(f => ({ slot: f.slot, path: pasta + f.slot + '.jpg' })),
          assinatura_path: it.assinatura ? pasta + 'assinatura.png' : null } });
        await vistRemover(it.id); enviadas++;
      } catch (e) {
        const msg = mensagemErro(e);
        if (/já tem vistoria|A vistoria é feita durante/.test(msg)) { await vistRemover(it.id); if (!silencioso) toast(msg, true); continue; }
        if (!silencioso) toast('A vistoria continua salva no celular. ' + msg, true);
        break; // sem sinal ou erro: tenta de novo depois
      }
    }
  } finally { vistSincronizando = false; }
  if (enviadas) toast(enviadas > 1 ? `${enviadas} vistorias enviadas.` : 'Vistoria enviada ao servidor.');
  return enviadas;
}
window.addEventListener('online', () => sincronizarVistorias());

// ───────── compressão das fotos no celular ─────────
async function comprimirFoto(arquivo, max = 1280, qualidade = 0.72) {
  let img;
  try { img = await createImageBitmap(arquivo, { imageOrientation: 'from-image' }); }
  catch {
    img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(arquivo); });
  }
  const esc_ = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * esc_); c.height = Math.round(img.height * esc_);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', qualidade));
}

// ───────── tela: nova vistoria ─────────
async function telaVistoriaNova(pedidoId) {
  titulo('Vistoria de retirada');
  const p = ok(await sb.from('gf_pedidos').select('id,origem,destino,veiculo,veiculo_tipo,placa,status,prestador_id').eq('id', pedidoId).maybeSingle());
  if (!p || p.prestador_id !== S.user.id) { V.innerHTML = '<div class="vazio"><h2>Atendimento não encontrado</h2><a href="#servicos">Voltar</a></div>'; return; }
  const ja = ok(await sb.from('gf_vistorias').select('id').eq('pedido_id', pedidoId).maybeSingle());
  if (ja) { location.hash = 'vistoria/' + ja.id; return; }
  if ((await vistPendentes()).some(x => x.pedido_id === pedidoId)) {
    V.innerHTML = `<div class="aviso"><b>Vistoria salva no celular.</b> Ela é enviada sozinha quando o sinal voltar.</div>
      <button class="btn full grande" id="btSinc">Enviar agora</button>`;
    $('#btSinc').onclick = e => comBotao(e.currentTarget, async () => { if (await sincronizarVistorias(false)) rota(); });
    return;
  }
  const R = (S.vistoria && S.vistoria.pedido === pedidoId) ? S.vistoria
    : (S.vistoria = { pedido: pedidoId, id: crypto.randomUUID(), fotos: {}, avarias: [], tipoAvaria: 'risco', itens: {}, combustivel: '', km: '', obs: '', relacao: 'proprietario', nome: '', assinatura: null });
  V.innerHTML = `<div class="item destaque">${trajeto(p.origem, p.destino)}<div class="meta">${esc(p.veiculo)}${p.placa ? ' · ' + esc(p.placa) : ''}</div></div>
    ${!navigator.onLine ? '<div class="aviso am"><b>Sem sinal.</b> Pode fazer a vistoria normalmente: ela fica salva no celular e é enviada quando o sinal voltar.</div>' : ''}
    <h3 class="sec-t">1. Fotos <small class="vs-dica">mínimo 4, até 8</small></h3>
    <div class="vs-fotos">${VIST_FOTOS.map(([k, t, obr]) => `<label class="vs-foto ${R.fotos[k] ? 'ok' : ''}" data-slot="${k}">
      <input type="file" accept="image/*" capture="environment" hidden>
      ${R.fotos[k] ? `<img src="${R.fotos[k].url}" alt="">` : `<span class="vs-mais">+</span>`}<b>${t}${obr ? ' *' : ''}</b></label>`).join('')}</div>
    <h3 class="sec-t">2. Avarias que já existem</h3>
    <p class="vs-dica">Escolha o tipo e toque no desenho onde está a avaria. Toque na marca para tirar.</p>
    <div class="seg c4 vs-tipo" role="radiogroup" aria-label="Tipo de avaria">${Object.entries(VIST_AVARIA).map(([v, t]) =>
      `<label><input type="radio" name="tipoAv" value="${v}" ${R.tipoAvaria === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
    <div class="vs-carro"><svg id="vsCarro" viewBox="0 0 200 400" role="img" aria-label="Desenho do carro visto de cima">${CARRO_SVG}<g id="vsPins">${pinsSvg(R.avarias)}</g></svg>
      <ol id="vsLista" class="vs-lista"></ol></div>
    <label class="vs-sem"><input type="checkbox" id="vsSemAv" ${R.semAvaria ? 'checked' : ''}> Veículo sem avarias aparentes</label>
    <h3 class="sec-t">3. Checklist</h3>
    <div class="vs-itens">${VIST_ITENS.map(([k, t]) => `<button type="button" class="vs-item" data-item="${k}" aria-pressed="${!!R.itens[k]}">${t}</button>`).join('')}</div>
    <label>Combustível</label>
    <div class="seg c5" role="radiogroup" aria-label="Combustível">${VIST_COMBUSTIVEL.map(v =>
      `<label><input type="radio" name="comb" value="${v}" ${R.combustivel === v ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
    <label for="vsKm">Quilometragem (opcional)</label><input id="vsKm" inputmode="numeric" maxlength="7" value="${esc(R.km)}" placeholder="Ex.: 123456">
    <label for="vsObs">Observação (opcional)</label><textarea id="vsObs" maxlength="1000" placeholder="Ex.: para-choque solto, pneu dianteiro furado">${esc(R.obs)}</textarea>
    <h3 class="sec-t">4. Quem acompanha a retirada</h3>
    <div class="seg c2 vs-rel" role="radiogroup" aria-label="Quem assina">${Object.entries(VIST_RELACAO).map(([v, t]) =>
      `<label><input type="radio" name="rel" value="${v}" ${R.relacao === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
    <div id="vsAss" ${R.relacao === 'ausente' ? 'hidden' : ''}>
      <label for="vsNome">Nome de quem assina</label><input id="vsNome" maxlength="80" value="${esc(R.nome)}" autocomplete="off">
      <p class="vs-termo">${esc(VIST_TERMO)}</p>
      <div class="vs-assina"><canvas id="vsCanvas" aria-label="Assine aqui com o dedo"></canvas><span>Assine aqui com o dedo</span></div>
      <button type="button" class="btn fant" id="vsLimpar" style="margin-top:8px">Limpar assinatura</button></div>
    <p class="vs-dica" id="vsAusente" ${R.relacao === 'ausente' ? '' : 'hidden'}>Sem ninguém no local, o termo fica registrado com as fotos, a hora e o seu nome como responsável pela vistoria.</p>
    <button class="btn full grande" id="vsConcluir" style="margin-top:18px">Concluir vistoria</button>`;

  // fotos
  V.querySelectorAll('.vs-foto input').forEach(inp => inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return; const slot = inp.closest('.vs-foto').dataset.slot;
    try {
      const blob = await comprimirFoto(f);
      if (R.fotos[slot]) URL.revokeObjectURL(R.fotos[slot].url);
      R.fotos[slot] = { blob, url: URL.createObjectURL(blob) };
      const el = inp.closest('.vs-foto'); el.classList.add('ok');
      el.querySelector('.vs-mais, img')?.remove(); el.insertAdjacentHTML('afterbegin', `<img src="${R.fotos[slot].url}" alt="">`);
      el.prepend(inp);
    } catch { toast('Não foi possível ler esta foto. Tente de novo.', true); }
  });
  // avarias
  const desenhaPins = () => {
    $('#vsPins').innerHTML = pinsSvg(R.avarias);
    $('#vsLista').innerHTML = R.avarias.map((a, i) => `<li><b>${i + 1}</b> ${VIST_AVARIA[a.tipo]}</li>`).join('');
    if (R.avarias.length) { R.semAvaria = false; $('#vsSemAv').checked = false; }
  };
  desenhaPins();
  V.querySelectorAll('input[name=tipoAv]').forEach(r => r.onchange = () => { R.tipoAvaria = r.value; });
  $('#vsCarro').addEventListener('click', e => {
    const pin = e.target.closest('.pin');
    if (pin) { R.avarias.splice(Number(pin.dataset.i), 1); return desenhaPins(); }
    if (R.avarias.length >= 40) return toast('Máximo de 40 marcas.', true);
    const r = e.currentTarget.getBoundingClientRect();
    R.avarias.push({ x: +((e.clientX - r.left) / r.width).toFixed(3), y: +((e.clientY - r.top) / r.height).toFixed(3), tipo: R.tipoAvaria });
    desenhaPins();
  });
  $('#vsSemAv').onchange = e => { R.semAvaria = e.target.checked; if (R.semAvaria) { R.avarias = []; desenhaPins(); R.semAvaria = true; $('#vsSemAv').checked = true; } };
  // checklist
  V.querySelectorAll('.vs-item').forEach(b => b.onclick = () => { R.itens[b.dataset.item] = !R.itens[b.dataset.item]; b.setAttribute('aria-pressed', R.itens[b.dataset.item]); });
  V.querySelectorAll('input[name=comb]').forEach(r => r.onchange = () => { R.combustivel = r.value; });
  $('#vsKm').oninput = e => { e.target.value = e.target.value.replace(/\D/g, ''); R.km = e.target.value; };
  $('#vsObs').oninput = e => { R.obs = e.target.value; };
  $('#vsNome').oninput = e => { R.nome = e.target.value; };
  V.querySelectorAll('input[name=rel]').forEach(r => r.onchange = () => {
    R.relacao = r.value; $('#vsAss').hidden = r.value === 'ausente'; $('#vsAusente').hidden = r.value !== 'ausente';
    if (r.value !== 'ausente') prepararAssinatura();
  });
  // assinatura
  const cv = $('#vsCanvas'); let desenhando = false, ctx;
  function prepararAssinatura() {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr; ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0F172A';
    if (R.assinaturaImg) { const i = new Image(); i.onload = () => ctx.drawImage(i, 0, 0, w, h); i.src = R.assinaturaImg; }
  }
  prepararAssinatura();
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.onpointerdown = e => { if (!ctx) prepararAssinatura(); desenhando = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); cv.parentElement.classList.add('assinado'); };
  cv.onpointermove = e => { if (!desenhando) return; ctx.lineTo(...pos(e)); ctx.stroke(); };
  cv.onpointerup = cv.onpointercancel = () => { if (!desenhando) return; desenhando = false; R.assinou = true; R.assinaturaImg = cv.toDataURL('image/png'); };
  $('#vsLimpar').onclick = () => { ctx?.clearRect(0, 0, cv.width, cv.height); R.assinou = false; R.assinaturaImg = null; cv.parentElement.classList.remove('assinado'); };

  // concluir
  $('#vsConcluir').onclick = e => comBotao(e.currentTarget, async () => {
    const obrig = VIST_FOTOS.filter(([, , o]) => o).map(([k]) => k);
    const faltam = obrig.filter(k => !R.fotos[k]);
    if (faltam.length) return toast('Tire as fotos: ' + faltam.map(k => VIST_FOTOS.find(f => f[0] === k)[1]).join(', ') + '.', true);
    if (!R.avarias.length && !R.semAvaria) return toast('Marque as avarias no desenho ou confirme "Veículo sem avarias aparentes".', true);
    if (!R.combustivel) return toast('Informe o nível de combustível.', true);
    if (R.relacao !== 'ausente') {
      if (R.nome.trim().length < 2) { $('#vsNome').focus(); return toast('Informe o nome de quem assina.', true); }
      if (!R.assinou) return toast('Peça para o responsável assinar no quadro.', true);
    }
    const assinatura = R.relacao !== 'ausente' ? await new Promise(res => cv.toBlob(res, 'image/png')) : null;
    const item = { id: R.id, pedido_id: pedidoId, criado: Date.now(),
      fotos: Object.entries(R.fotos).map(([slot, f]) => ({ slot, blob: f.blob })), assinatura,
      dados: { avarias: R.avarias, checklist: { ...Object.fromEntries(VIST_ITENS.map(([k]) => [k, !!R.itens[k]])), combustivel: R.combustivel, km: R.km ? Number(R.km) : null, sem_avarias: !!R.semAvaria },
        obs: R.obs.trim() || null, responsavel_relacao: R.relacao, responsavel_nome: R.relacao === 'ausente' ? null : R.nome.trim(), feita_em: new Date().toISOString() } };
    try { await vistGuardar(item); } catch { return toast('Não foi possível salvar no celular. Libere espaço e tente de novo.', true); }
    Object.values(R.fotos).forEach(f => URL.revokeObjectURL(f.url)); S.vistoria = null;
    if (!navigator.onLine) { toast('Vistoria salva no celular. Enviamos quando o sinal voltar.'); location.hash = 'pedido/' + pedidoId; return; }
    const n = await sincronizarVistorias(false);
    location.hash = n ? 'vistoria/' + item.id : 'pedido/' + pedidoId;
  });
}

// ───────── tela: termo de vistoria ─────────
async function telaVistoria(id) {
  titulo('Termo de vistoria');
  const v = ok(await sb.from('gf_vistorias').select('*').eq('id', id).maybeSingle());
  if (!v) { V.innerHTML = '<div class="vazio"><h2>Vistoria não encontrada</h2><a href="#inicio">Voltar</a></div>'; return; }
  const [p, g] = await Promise.all([
    sb.from('gf_pedidos').select('id,origem,destino,veiculo,veiculo_tipo,placa,autor_id,prestador_id').eq('id', v.pedido_id).maybeSingle().then(ok),
    sb.from('gf_perfis').select('nome,empresa').eq('id', v.guincheiro_id).maybeSingle().then(ok)]);
  const paths = [...v.fotos.map(f => f.path), ...(v.assinatura_path ? [v.assinatura_path] : [])];
  const { data: urls } = paths.length ? await sb.storage.from('gf-vistorias').createSignedUrls(paths, 3600) : { data: [] };
  const url = path => (urls || []).find(u => u.path === path)?.signedUrl || '';
  const ck = v.checklist || {};
  const nomeFoto = s => (VIST_FOTOS.find(f => f[0] === s) || [s, s])[1];
  V.innerHTML = `<div class="vs-termo-doc">
    <div class="item destaque">${p ? trajeto(p.origem, p.destino) : ''}
      <div class="meta">${p ? esc(p.veiculo) + (p.placa ? ' · ' + esc(p.placa) : '') : ''}</div>
      <div class="meta">Vistoria de retirada · ${dataHora(v.feita_em)}${g ? ' · por ' + esc(g.nome) + (g.empresa ? ' (' + esc(g.empresa) + ')' : '') : ''}</div></div>
    <h3 class="sec-t">Fotos (${v.fotos.length})</h3>
    <div class="vs-galeria">${v.fotos.map(f => `<a href="${url(f.path)}" target="_blank" rel="noopener"><img src="${url(f.path)}" alt="${esc(nomeFoto(f.slot))}" loading="lazy"><span>${esc(nomeFoto(f.slot))}</span></a>`).join('')}</div>
    <h3 class="sec-t">Avarias (${v.avarias.length})</h3>
    ${v.avarias.length ? `<div class="vs-carro"><svg viewBox="0 0 200 400" role="img" aria-label="Avarias marcadas">${CARRO_SVG}<g>${pinsSvg(v.avarias)}</g></svg>
      <ol class="vs-lista">${v.avarias.map((a, i) => `<li><b>${i + 1}</b> ${VIST_AVARIA[a.tipo] || a.tipo}</li>`).join('')}</ol></div>`
      : '<p class="vs-dica">Veículo sem avarias aparentes na retirada.</p>'}
    <h3 class="sec-t">Checklist</h3>
    <ul class="vs-check">${VIST_ITENS.map(([k, t]) => `<li class="${ck[k] ? 'sim' : 'nao'}">${ck[k] ? '✓' : '✕'} ${t}</li>`).join('')}
      <li class="sim">Combustível: <b>${esc(ck.combustivel || '–')}</b></li>${ck.km ? `<li class="sim">Quilometragem: <b>${Number(ck.km).toLocaleString('pt-BR')} km</b></li>` : ''}</ul>
    ${v.obs ? `<p><b>Observação:</b> ${esc(v.obs)}</p>` : ''}
    <h3 class="sec-t">Termo</h3>
    <p class="vs-termo">${esc(VIST_TERMO)}</p>
    ${v.responsavel_relacao === 'ausente' ? '<p class="vs-dica">Sem responsável no local na retirada. Registro feito pelo guincheiro com fotos e horário.</p>'
      : `<div class="vs-assinatura"><img src="${url(v.assinatura_path)}" alt="Assinatura"><span>${esc(v.responsavel_nome || '')} · ${esc(VIST_RELACAO[v.responsavel_relacao] || '')}</span></div>`}
    <p class="vs-dica">Registro nº ${esc(v.id.slice(0, 8).toUpperCase())} · feito em ${dataHora(v.feita_em)} · recebido pelo GF em ${dataHora(v.recebida_em)}.</p>
    <div class="acoes nao-imprime">
      ${p && p.prestador_id === S.user.id ? '<button class="btn zap full" id="vsZap">Enviar ao cliente no WhatsApp</button>' : ''}
      <button class="btn fant full" id="vsPdf">Imprimir ou salvar em PDF</button>
      ${p ? `<a class="btn fant full" href="#pedido/${p.id}">Voltar ao atendimento</a>` : ''}</div></div>`;
  $('#vsPdf').onclick = () => window.print();
  if ($('#vsZap')) $('#vsZap').onclick = e => comBotao(e.currentTarget, async () => {
    try {
      const c = await rpc('gf_contato', { p_pedido: p.id });
      const link = `${location.origin}/app#vistoria/${v.id}`;
      const msg = `Olá ${c.nome.split(' ')[0]}! Segue o termo de vistoria do seu veículo (${p.veiculo}), feito na retirada em ${dataHora(v.feita_em)}: ${link}`;
      const w = window.open(linkZap(c.whatsapp, msg), '_blank'); if (w) w.opener = null; else location.href = linkZap(c.whatsapp, msg);
    } catch (er) { falha(er); }
  });
}
