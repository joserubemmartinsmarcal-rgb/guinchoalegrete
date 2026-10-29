'use strict';
// GF · Guincho Fácil — app (PWA). Toda escrita relevante passa por funções do
// banco (rpc gf_*), que validam papel, estado e dados. A tela só orienta.
const { STATUS, ETAPAS, ATIVOS, PROXIMO, ACAO_PRESTADOR, CONDICAO, VEICULO, EQUIPAMENTOS, CAPACIDADE, APROVACAO, OCORRENCIA,
  esc, brl, dataHora, dataCurta, soNum, zapValido, mascaraZap, linkZap, placaValida, valorDigitado,
  dentroDoPeriodo, totalRegistrado, progressoCadastro, calcularResultado } = window.GF;
const CFG = window.GF_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
const $ = s => document.querySelector(s);
const V = $('#v');
const S = { user: null, perfil: null, timer: null, raio: null, filtros: {} };

document.getElementById('dlCidades').innerHTML = Object.keys(GF_CIDADES).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  .map(c => `<option value="${esc(c)}">`).join('');

// ───────────────────────── utilidades de tela ─────────────────────────
function toast(msg, erro) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (erro ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.className = 'toast', erro ? 5000 : 3200);
}
function titulo(t) { $('#titulo').textContent = t; document.title = t + ' · GF'; }
function carregando(msg = 'Carregando…') { V.innerHTML = `<div class="carregando">${esc(msg)}</div>`; }
function mensagemErro(e) {
  const m = String(e?.message || e || '');
  if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(m)) return 'Sem conexão. Confira a internet e tente de novo.';
  if (/permission denied|row-level security/i.test(m)) return 'Você não tem permissão para fazer isso.';
  if (/JWT|session/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  if (e?.code === 'P0001' || /^[A-ZÁÉÍÓÚ]/.test(m)) return m;
  return 'Não deu certo. Tente de novo em instantes.';
}
function falha(e, msg) { console.error('[GF]', e); toast(msg || mensagemErro(e), true); }
function telaErro(e) {
  console.error('[GF]', e);
  V.innerHTML = `<div class="erro-tela"><h2>Não foi possível carregar</h2><p style="color:var(--cinza)">${esc(mensagemErro(e))}</p>
    <button class="btn" id="btRetry">Tentar de novo</button></div>`;
  $('#btRetry').onclick = rota;
}
// resultado do supabase → dados ou exceção
function ok(r) { if (r.error) throw r.error; return r.data; }
async function rpc(nome, args) { return ok(await sb.rpc(nome, args || {})); }
async function comBotao(bt, fn) {
  if (bt) bt.disabled = true;
  try { return await fn(); } finally { if (bt) bt.disabled = false; }
}
const ehGuincho = () => S.perfil?.tipo === 'guincheiro';
const aprovado = () => S.perfil?.aprovacao === 'aprovado';
const cidadeOk = c => !!GF_CIDADES[c];
const kmTxt = n => n == null ? '' : `~${n} km`;
function tagStatus(st) {
  const cls = { aberto: 'am', concluido: 'vd', cancelado: 'vm' }[st] || (ATIVOS.includes(st) ? 'az' : '');
  return `<span class="tag ${cls}">${esc(STATUS[st] || st)}</span>`;
}
function chips(nome, opcoes, atual) {
  return `<div class="chips" role="group" data-chips="${nome}">${opcoes.map(([v, t]) =>
    `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(atual)}">${esc(t)}</button>`).join('')}</div>`;
}
function ligaChips(nome, aoMudar) {
  V.querySelectorAll(`[data-chips="${nome}"] button`).forEach(b => b.onclick = () => aoMudar(b.dataset.v));
}
// diálogo de confirmação, com campo opcional
function perguntar({ titulo: t, texto = '', campo = null, ok: okTxt = 'Confirmar', perigo = false }) {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog"><h2 style="font-size:28px">${esc(t)}</h2>${texto ? `<p style="color:var(--cinza)">${esc(texto)}</p>` : ''}
    ${campo ? `<label for="dlgCampo">${esc(campo.label)}</label><textarea id="dlgCampo" maxlength="500" ${campo.obrigatorio ? 'required minlength="3"' : ''}></textarea>` : ''}
    <div class="acoes"><button class="btn ${perigo ? 'perigo' : ''}" value="ok">${esc(okTxt)}</button><button class="btn fant" value="cancelar" formnovalidate>Voltar</button></div></form>`;
  return new Promise(res => {
    d.onclose = () => res(d.returnValue === 'ok' ? (campo ? $('#dlgCampo').value.trim() : true) : null);
    d.returnValue = ''; d.showModal(); (campo ? $('#dlgCampo') : d.querySelector('button')).focus();
  });
}
function mapaRota(origem, destino) {
  const A = GF_CIDADES[origem], B = GF_CIDADES[destino];
  if (!A || !B) return;
  const desenha = () => {
    const el = document.getElementById('mapa'); if (!el || !window.L) return;
    const m = L.map(el, { zoomControl: false, attributionControl: true, dragging: !L.Browser.mobile, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 13, attribution: '© OpenStreetMap' }).addTo(m);
    L.circleMarker(A, { radius: 8, color: '#062048', fillColor: '#ffffff', fillOpacity: 1 }).addTo(m).bindTooltip(origem);
    L.circleMarker(B, { radius: 8, color: '#062048', fillColor: '#0ac8fe', fillOpacity: 1 }).addTo(m).bindTooltip(destino);
    L.polyline([A, B], { color: '#0ac8fe', weight: 3, dashArray: '8 8' }).addTo(m);
    m.fitBounds([A, B], { padding: [30, 30] });
  };
  if (window.L) return desenha();
  if (!document.getElementById('leafletCss')) {
    const l = document.createElement('link'); l.id = 'leafletCss'; l.rel = 'stylesheet';
    l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l);
  }
  const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  s.onload = desenha; s.onerror = () => { const el = document.getElementById('mapa'); if (el) el.remove(); };
  document.head.appendChild(s);
}
// atualização automática enquanto a tela está aberta e ninguém está digitando
function aoVivo(segundos = 30) {
  clearInterval(S.timer);
  const h = location.hash;
  S.timer = setInterval(() => {
    if (location.hash !== h || document.hidden || $('#dlg').open) return;
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) || V.querySelector('form[data-sujo]')) return;
    rota(true);
  }, segundos * 1000);
}

// ───────────────────────── navegação ─────────────────────────
const IC = {
  casa: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  rota: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 17V9a4 4 0 0 1 4-4h6M18 7v8a4 4 0 0 1-4 4H8"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  mais: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  caminhao: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  admin: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>'
};
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${p}</svg>`;
function montaNav() {
  const itens = ehGuincho()
    ? [['inicio', 'Início', IC.casa], ['buscar', 'Buscar', IC.busca], ['rotas', 'Rotas', IC.rota], ['servicos', 'Serviços', IC.caminhao], ['perfil', 'Perfil', IC.user]]
    : [['inicio', 'Início', IC.casa], ['pedido/novo', 'Pedir', IC.mais], ['pedidos', 'Pedidos', IC.lista], ['perfil', 'Perfil', IC.user]];
  if (S.perfil?.is_admin && !ehGuincho()) itens.splice(3, 0, ['admin', 'Admin', IC.admin]);
  $('#nav').innerHTML = itens.map(([h, t, i]) => `<a href="#${h}" data-r="${h}">${svg(i)}${t}<span class="badge" data-b="${h}" hidden></span></a>`).join('');
  $('#nav').hidden = false; $('#btSair').hidden = false;
}
function marcaNav(r) {
  const base = r.split('/')[0] || 'inicio';
  document.querySelectorAll('#nav a').forEach(a => {
    const on = a.dataset.r.split('/')[0] === base || (a.dataset.r === 'pedido/novo' && r === 'pedido/novo');
    a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
}
function badge(r, n) { const b = document.querySelector(`[data-b="${r}"]`); if (b) { b.hidden = !n; b.textContent = n; } }

async function contadores() {
  if (!S.perfil) return;
  try {
    if (ehGuincho()) {
      const { count } = await sb.from('gf_pedidos').select('id', { count: 'exact', head: true }).eq('prestador_id', S.user.id).in('status', ATIVOS);
      badge('servicos', count || 0);
    } else {
      const d = ok(await sb.from('gf_pedidos').select('id, gf_propostas(status)').eq('autor_id', S.user.id).eq('status', 'aberto'));
      badge('pedidos', d.reduce((s, p) => s + p.gf_propostas.filter(x => x.status === 'enviada').length, 0));
    }
  } catch (e) { /* contador é acessório */ }
}

async function rota(silencioso) {
  const h = decodeURIComponent(location.hash.slice(1));
  const [a, b, c] = h.split('/');
  if (!silencioso) clearInterval(S.timer);
  if (S.recuperandoSenha) return telaNovaSenha();
  if (!S.user) return telaLogin();
  if (!S.perfil) return telaPerfil(true);
  marcaNav(h);
  if (!silencioso) { window.scrollTo(0, 0); carregando(); }
  try {
    if (!a || a === 'inicio') return await (ehGuincho() ? inicioGuincheiro() : inicioCliente());
    if (a === 'pedido' && b === 'novo') return telaNovoPedido('cliente');
    if (a === 'repasse') return telaNovoPedido('repasse');
    if (a === 'pedido') return await telaPedido(b);
    if (a === 'pedidos') return await telaMeusPedidos();
    if (a === 'buscar') return await telaBuscar();
    if (a === 'rotas' && b === 'nova') return telaNovaRota();
    if (a === 'rotas') return await telaRotas();
    if (a === 'rota') return await telaRota(b);
    if (a === 'servicos') return await telaServicos();
    if (a === 'perfil') return telaPerfil(false);
    if (a === 'ocorrencias') return await telaOcorrencias();
    if (a === 'ocorrencia') return telaNovaOcorrencia(c || null);
    if (a === 'admin') return await telaAdmin(b || 'indicadores');
    if (a === 'privacidade') { location.href = '/privacidade'; return; }
    location.hash = 'inicio';
  } catch (e) { silencioso ? console.error('[GF]', e) : telaErro(e); }
}
window.addEventListener('hashchange', () => rota());

// ───────────────────────── acesso ─────────────────────────
function telaLogin() {
  titulo('Entrar'); $('#nav').hidden = true; $('#btSair').hidden = true;
  V.innerHTML = `
  <div class="boas-vindas"><h2>O seu caminhão nunca mais <em>volta vazio.</em></h2>
  <p>Entre ou crie sua conta. Quem precisa transportar pede; guincheiros recebem pedidos na rota.</p></div>
  <div class="seg c2">
    <label><input type="radio" name="modo" value="entrar" checked><span>Entrar</span></label>
    <label><input type="radio" name="modo" value="criar"><span>Criar conta</span></label>
  </div>
  <form id="fL" novalidate>
    <label for="em">E-mail</label><input id="em" type="email" autocomplete="email" required>
    <label for="se">Senha</label><input id="se" type="password" autocomplete="current-password" minlength="6" required>
    <button class="btn full" style="margin-top:18px" id="btL">Entrar</button>
  </form>
  <button class="btn fant full" style="margin-top:10px" id="btMagic">Receber link de acesso no e-mail</button>
  <button class="btn fant full" style="margin-top:10px" id="btEsqueci">Esqueci minha senha</button>
  <p style="text-align:center;margin-top:22px"><a href="/">Conhecer o GF</a> · <a href="/privacidade">Privacidade</a></p>`;
  const modo = () => document.querySelector('[name=modo]:checked').value;
  document.querySelectorAll('[name=modo]').forEach(r => r.onchange = () => {
    $('#btL').textContent = modo() === 'criar' ? 'Criar conta' : 'Entrar';
    $('#se').autocomplete = modo() === 'criar' ? 'new-password' : 'current-password';
  });
  const email = () => $('#em').value.trim();
  $('#fL').onsubmit = e => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email())) { $('#em').setAttribute('aria-invalid', 'true'); return toast('Digite um e-mail válido.', true); }
    if ($('#se').value.length < 6) { $('#se').setAttribute('aria-invalid', 'true'); return toast('A senha precisa de pelo menos 6 caracteres.', true); }
    comBotao($('#btL'), async () => {
      const password = $('#se').value;
      const r = modo() === 'criar'
        ? await sb.auth.signUp({ email: email(), password, options: { emailRedirectTo: location.origin + '/app' } })
        : await sb.auth.signInWithPassword({ email: email(), password });
      if (r.error) {
        const m = r.error.message || '';
        return toast(/Invalid login/i.test(m) ? 'E-mail ou senha incorretos.' : /already registered/i.test(m) ? 'Esse e-mail já tem conta. Use “Entrar”.'
          : /confirm/i.test(m) ? 'Confirme seu e-mail pelo link que enviamos.' : /rate|seconds/i.test(m) ? 'Muitas tentativas. Aguarde um minuto.' : 'Não foi possível: ' + m, true);
      }
      if (modo() === 'criar' && !r.data.session) toast('Conta criada. Abra o link que enviamos no seu e-mail para ativar.');
    });
  };
  $('#btMagic').onclick = e => {
    if (!/^\S+@\S+\.\S+$/.test(email())) return toast('Digite seu e-mail primeiro.', true);
    comBotao(e.currentTarget, async () => {
      const { error } = await sb.auth.signInWithOtp({ email: email(), options: { emailRedirectTo: location.origin + '/app' } });
      error ? falha(error, 'Não foi possível enviar o link.') : toast('Link enviado. Abra no e-mail deste celular.');
    });
  };
  $('#btEsqueci').onclick = e => {
    if (!/^\S+@\S+\.\S+$/.test(email())) return toast('Digite seu e-mail primeiro.', true);
    comBotao(e.currentTarget, async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email(), { redirectTo: location.origin + '/app' });
      error ? falha(error, 'Não foi possível enviar.') : toast('Enviamos um link para criar uma nova senha.');
    });
  };
}
function telaNovaSenha() {
  titulo('Nova senha'); $('#nav').hidden = true;
  V.innerHTML = `<form id="fS"><label for="ns">Nova senha</label><input id="ns" type="password" minlength="6" autocomplete="new-password" required>
    <button class="btn full" style="margin-top:16px">Salvar nova senha</button></form>`;
  $('#fS').onsubmit = e => {
    e.preventDefault();
    if ($('#ns').value.length < 6) return toast('A senha precisa de pelo menos 6 caracteres.', true);
    comBotao(e.submitter, async () => {
      const { error } = await sb.auth.updateUser({ password: $('#ns').value });
      if (error) return falha(error);
      S.recuperandoSenha = false; toast('Senha atualizada.'); location.hash = 'inicio'; rota();
    });
  };
}

// ───────────────────────── perfil ─────────────────────────
function blocoProgresso() {
  const { itens, pct } = progressoCadastro(S.perfil);
  const st = S.perfil.aprovacao;
  return `<div class="aviso ${st === 'aprovado' ? '' : 'am'}">
    <b>Cadastro de guincheiro: ${esc(APROVACAO[st])}</b>
    ${st === 'pendente' ? '<p style="margin:6px 0 0">A equipe GF confere seus dados antes de liberar pedidos e propostas. Complete o que falta para agilizar.</p>' : ''}
    ${st === 'recusado' || st === 'bloqueado' ? `<p style="margin:6px 0 0">${esc(S.perfil.aprovacao_obs || 'Fale com o suporte para entender o motivo.')}</p>` : ''}
    <div class="barra-prog" aria-label="Cadastro ${pct}% completo"><i style="width:${pct}%"></i></div>
    <ul class="check">${itens.map(i => `<li class="${i.ok ? 'ok' : ''}">${esc(i.nome)}</li>`).join('')}</ul>
    ${st !== 'aprovado' ? `<a class="btn sec full" style="margin-top:10px" target="_blank" rel="noopener" href="${linkZap(CFG.whatsappSuporte, `Olá! Sou ${S.perfil.nome}, guincheiro em ${S.perfil.cidade}. Quero agilizar a aprovação do meu cadastro no GF.`)}">Falar com a equipe GF</a>` : ''}
  </div>`;
}
function telaPerfil(novo) {
  titulo(novo ? 'Seu perfil' : 'Perfil');
  if (novo) { $('#nav').hidden = true; $('#btSair').hidden = false; }
  const p = S.perfil || { tipo: 'cliente', raio_km: 100 };
  V.innerHTML = `
  ${novo ? '<h2 style="font-size:34px">Como você vai usar o GF?</h2>' : ''}
  ${!novo && ehGuincho() ? blocoProgresso() : ''}
  <form id="fP" novalidate>
    <div class="seg" role="radiogroup" aria-label="Tipo de conta">
      ${[['cliente', 'Preciso transportar'], ['guincheiro', 'Sou guincheiro'], ['empresa', 'Empresa']].map(([v, t]) =>
        `<label><input type="radio" name="tipo" value="${v}" ${p.tipo === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
    </div>
    <label for="pn">Nome</label><input id="pn" name="nome" value="${esc(p.nome)}" autocomplete="name" maxlength="80" required>
    <label for="pe">Empresa (opcional)</label><input id="pe" name="empresa" value="${esc(p.empresa)}" maxlength="80" autocomplete="organization">
    <label for="pc">Cidade base</label><input id="pc" name="cidade" list="dlCidades" value="${esc(p.cidade)}" required>
    <label for="pz">WhatsApp</label><input id="pz" name="whatsapp" inputmode="tel" autocomplete="tel" value="${esc(mascaraZap(p.whatsapp || ''))}" placeholder="(55) 99999-9999" required>
    <div id="bG">
      <label for="pq">Equipamento</label><select id="pq" name="equipamento">${EQUIPAMENTOS.map(e => `<option ${p.equipamento === e ? 'selected' : ''}>${e}</option>`).join('')}</select>
      <label for="pk">Capacidade de carga</label><select id="pk" name="capacidade"><option value="">Escolha</option>${Object.entries(CAPACIDADE).map(([v, t]) => `<option value="${v}" ${p.capacidade === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label for="pl">Placa do caminhão</label><input id="pl" name="placa" value="${esc(p.placa)}" maxlength="8" style="text-transform:uppercase" placeholder="ABC1D23">
      <label for="pr">Área de atuação</label><select id="pr" name="raio_km">${[20, 50, 100, 150, 300, 500].map(r => `<option value="${r}" ${Number(p.raio_km) === r ? 'selected' : ''}>Até ${r} km da cidade base</option>`).join('')}</select>
    </div>
    ${novo ? '<label class="chk" style="margin-top:16px"><input type="checkbox" name="lgpd" required><span>Li e aceito a <a href="/privacidade" target="_blank">política de privacidade</a>. Meus dados servem só para operar o GF.</span></label>' : ''}
    <p style="color:var(--cinza);font-size:14px">Seu WhatsApp só aparece para quem fecha serviço com você.</p>
    <button class="btn full">${novo ? 'Começar a usar' : 'Salvar perfil'}</button>
  </form>
  ${!novo ? `<div class="acoes" style="margin-top:22px">
    ${ehGuincho() ? '<a class="btn fant full" href="#pedidos">Meus repasses</a>' : ''}
    <a class="btn fant full" href="#ocorrencias">Minhas ocorrências</a>
    ${S.perfil?.is_admin ? '<a class="btn sec full" href="#admin">Painel da administração</a>' : ''}
    <button class="btn fant full" id="btInst">Instalar app no celular</button>
    <a class="btn fant full" href="/privacidade">Privacidade e dados</a>
  </div>` : ''}`;
  const zap = $('#pz'); zap.addEventListener('input', () => zap.value = mascaraZap(zap.value));
  const f = $('#fP'); const tg = () => $('#bG').hidden = f.tipo.value !== 'guincheiro'; tg(); f.addEventListener('change', tg);
  if ($('#btInst')) $('#btInst').onclick = instalar;
  f.onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    f.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
    const erro = (id, m) => { const el = document.getElementById(id); el?.setAttribute('aria-invalid', 'true'); el?.focus(); toast(m, true); };
    if (d.nome.trim().length < 2) return erro('pn', 'Informe seu nome.');
    if (!cidadeOk(d.cidade)) return erro('pc', 'Escolha a cidade na lista de sugestões.');
    if (!zapValido(d.whatsapp)) return erro('pz', 'WhatsApp incompleto. Use DDD + número.');
    if (d.tipo === 'guincheiro' && !placaValida(d.placa)) return erro('pl', 'Placa inválida. Use ABC1234 ou ABC1D23.');
    if (novo && !d.lgpd) return toast('Para continuar, aceite a política de privacidade.', true);
    comBotao(f.querySelector('button'), async () => {
      try {
        S.perfil = await rpc('gf_salvar_perfil', { p: {
          tipo: d.tipo, nome: d.nome, empresa: d.empresa, cidade: d.cidade, whatsapp: soNum(d.whatsapp),
          equipamento: d.equipamento, capacidade: d.capacidade, placa: d.placa, raio_km: d.raio_km } });
        montaNav(); toast('Perfil salvo.');
        if (location.hash !== '#inicio') location.hash = 'inicio'; else rota();
        contadores();
      } catch (er) { falha(er); }
    });
  };
}

// ───────────────────────── cliente ─────────────────────────
function cardPedidoMeu(p) {
  const n = (p.gf_propostas || []).filter(x => x.status === 'enviada').length;
  return `<a class="item ${n || ATIVOS.includes(p.status) ? 'quente' : ''}" href="#pedido/${p.id}">
    <div class="trajeto">${esc(p.origem)} › ${esc(p.destino)}</div>
    <div class="meta">${esc(VEICULO[p.veiculo_tipo] || '')} · ${esc(p.veiculo)} · ${dataHora(p.criado_em)}</div>
    <div class="tags">${p.status === 'aberto' && n ? `<span class="tag am">${n} proposta${n > 1 ? 's' : ''} nova${n > 1 ? 's' : ''}</span>` : tagStatus(p.status)}
      ${p.tipo === 'repasse' ? '<span class="tag">Repasse</span>' : ''}${p.valor_combinado != null ? `<span class="tag">${brl(p.valor_combinado)}</span>` : ''}</div></a>`;
}
async function inicioCliente() {
  titulo('Olá, ' + S.perfil.nome.split(' ')[0]);
  const d = ok(await sb.from('gf_pedidos').select('id,origem,destino,veiculo,veiculo_tipo,tipo,status,valor_combinado,criado_em,gf_propostas(status)')
    .eq('autor_id', S.user.id).not('status', 'in', '(concluido,cancelado)').order('criado_em', { ascending: false }).limit(20));
  V.innerHTML = `${blocoInstalar()}
    <a class="btn full" href="#pedido/novo" style="min-height:64px;font-size:20px">Pedir transporte de veículo</a>
    <p style="color:var(--cinza);font-size:15px;margin:10px 0 0">Guincheiros da região e quem está voltando pela sua rota recebem o pedido e mandam propostas. Você escolhe.</p>
    <h3 class="sec-t">Em andamento</h3>
    ${d.length ? d.map(cardPedidoMeu).join('') : '<div class="vazio">Nenhum pedido em andamento.<br>Quando pedir, as propostas aparecem aqui.</div>'}
    ${S.perfil.is_admin ? '<a class="btn sec full" style="margin-top:8px" href="#admin">Painel da administração</a>' : ''}`;
  ligaInstalar(); aoVivo();
}
function telaNovoPedido(tipo) {
  const rep = tipo === 'repasse';
  if (rep && !(ehGuincho() && aprovado())) { toast('Só guincheiros aprovados podem repassar serviços.', true); location.hash = 'inicio'; return; }
  titulo(rep ? 'Repassar serviço' : 'Pedir transporte');
  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  V.innerHTML = `${rep ? '<p style="color:var(--cinza)">Não consegue atender? Ofereça para a rede e mantenha seu cliente bem atendido.</p>' : ''}
  <form id="fN" novalidate>
    <div class="linha2">
      <div><label for="no">Buscar em</label><input id="no" name="origem" list="dlCidades" value="${esc(S.perfil.cidade)}" required></div>
      <div><label for="nd">Levar para</label><input id="nd" name="destino" list="dlCidades" required></div>
    </div>
    <label for="nvt">Tipo de veículo</label>
    <select id="nvt" name="veiculo_tipo">${Object.entries(VEICULO).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
    <label for="nv">Modelo e ano</label><input id="nv" name="veiculo" maxlength="80" placeholder="Ex.: Gol 2015, S10 2019" required>
    <label for="npl">Placa (opcional)</label><input id="npl" name="placa" maxlength="8" style="text-transform:uppercase" placeholder="ABC1D23">
    <label>Condição</label>
    <div class="seg">${Object.entries(CONDICAO).map(([v, t], i) => `<label><input type="radio" name="condicao" value="${v}" ${i === 1 ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
    <label for="nt">Quando</label><input id="nt" name="data_servico" type="date" min="${hoje}" value="${hoje}">
    <label for="nb">Detalhes (opcional)</label><textarea id="nb" name="obs" maxlength="1000" placeholder="Ponto de referência, roda travada, subsolo, horário… Não coloque endereço completo: ele é combinado com o guincheiro escolhido."></textarea>
    <p id="nkm" style="color:var(--cinza);font-size:15px"></p>
    <button class="btn full" style="margin-top:10px">${rep ? 'Publicar repasse' : 'Publicar pedido'}</button>
  </form>`;
  const f = $('#fN');
  const km = () => { const k = GF_GEO.km(f.origem.value, f.destino.value); $('#nkm').textContent = k ? `Distância estimada: ${kmTxt(k)} por estrada.` : ''; };
  f.origem.oninput = f.destino.oninput = km; km();
  f.addEventListener('input', () => f.dataset.sujo = '1');
  f.onsubmit = e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f));
    if (!cidadeOk(d.origem) || !cidadeOk(d.destino)) return toast('Escolha as cidades na lista de sugestões.', true);
    if (d.origem === d.destino) return toast('Origem e destino precisam ser diferentes.', true);
    if (d.veiculo.trim().length < 2) { f.veiculo.focus(); return toast('Informe o modelo do veículo.', true); }
    if (!placaValida(d.placa)) { f.placa.focus(); return toast('Placa inválida. Use ABC1234 ou ABC1D23.', true); }
    comBotao(f.querySelector('button'), async () => {
      try {
        const p = ok(await sb.from('gf_pedidos').insert({ tipo, origem: d.origem, destino: d.destino, veiculo: d.veiculo.trim(), veiculo_tipo: d.veiculo_tipo,
          placa: d.placa || null, condicao: d.condicao, data_servico: d.data_servico || null, obs: d.obs.trim() || null }).select('id').single());
        toast(rep ? 'Repasse publicado.' : 'Pedido publicado. Avisamos quando chegar proposta.');
        location.hash = 'pedido/' + p.id;
      } catch (er) { falha(er, mensagemErro(er)); }
    });
  };
}
async function telaMeusPedidos() {
  titulo(ehGuincho() ? 'Meus repasses' : 'Meus pedidos');
  const f = S.filtros.pedidos ||= { st: 'todos', dias: '30' };
  const d = ok(await sb.from('gf_pedidos').select('id,origem,destino,veiculo,veiculo_tipo,tipo,status,valor_combinado,criado_em,gf_propostas(status)')
    .eq('autor_id', S.user.id).order('criado_em', { ascending: false }).limit(300));
  const noPeriodo = d.filter(p => dentroDoPeriodo(p.criado_em, Number(f.dias)));
  const grupo = { todos: () => true, andamento: p => !['concluido', 'cancelado'].includes(p.status), concluido: p => p.status === 'concluido', cancelado: p => p.status === 'cancelado' };
  const lista = noPeriodo.filter(grupo[f.st]);
  const cont = k => noPeriodo.filter(grupo[k]).length;
  V.innerHTML = `<a class="btn full" href="#${ehGuincho() ? 'repasse' : 'pedido'}/novo">${ehGuincho() ? 'Repassar serviço' : 'Pedir transporte'}</a>
    <div class="resumo" style="margin-top:14px"><div><b>${cont('todos')}</b>no período</div><div><b>${cont('andamento')}</b>em andamento</div>
      <div><b>${cont('concluido')}</b>concluídos</div><div><b>${cont('cancelado')}</b>cancelados</div></div>
    ${chips('st', [['todos', 'Todos'], ['andamento', 'Em andamento'], ['concluido', 'Concluídos'], ['cancelado', 'Cancelados']], f.st)}
    ${chips('dias', [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']], f.dias)}
    ${lista.length ? lista.map(cardPedidoMeu).join('') : '<div class="vazio">Nada neste filtro.</div>'}`;
  ligaChips('st', v => { f.st = v; rota(); }); ligaChips('dias', v => { f.dias = v; rota(); });
}

// ───────────────────────── guincheiro ─────────────────────────
function cardPedidoAberto(p, extra) {
  return `<a class="item ${p.tipo === 'repasse' ? 'quente' : ''}" href="#pedido/${p.id}">
    <div class="trajeto">${esc(p.origem)} › ${esc(p.destino)}</div>
    <div class="meta">${esc(VEICULO[p.veiculo_tipo] || '')} · ${esc(p.veiculo)} · ${esc(CONDICAO[p.condicao] || p.condicao)} · ${dataCurta(p.data_servico)}</div>
    <div class="tags">${p.tipo === 'repasse' ? '<span class="tag am">Repasse de colega</span>' : ''}${extra ? `<span class="tag">${esc(extra)}</span>` : ''}
      ${GF_GEO.km(p.origem, p.destino) ? `<span class="tag">trajeto ${kmTxt(GF_GEO.km(p.origem, p.destino))}</span>` : ''}</div></a>`;
}
async function pedidosAbertos() {
  return ok(await sb.from('gf_pedidos').select('id,origem,destino,veiculo,veiculo_tipo,condicao,data_servico,tipo,criado_em')
    .eq('status', 'aberto').neq('autor_id', S.user.id).order('criado_em', { ascending: false }).limit(300))
    .map(p => ({ ...p, dist: GF_GEO.km(S.perfil.cidade, p.origem) }));
}
async function inicioGuincheiro() {
  titulo('Olá, ' + S.perfil.nome.split(' ')[0]);
  if (!aprovado()) {
    V.innerHTML = `${blocoInstalar()}${blocoProgresso()}<a class="btn full" href="#perfil">Completar cadastro</a>`;
    return ligaInstalar();
  }
  S.raio ||= String([20, 50, 100, 150].reduce((m, r) => r <= (S.perfil.raio_km || 100) ? r : m, 20));
  const [abertos, propsR, servR, retR] = await Promise.all([
    pedidosAbertos(),
    sb.from('gf_propostas').select('id', { count: 'exact', head: true }).eq('guincheiro_id', S.user.id).eq('status', 'enviada'),
    sb.from('gf_pedidos').select('id', { count: 'exact', head: true }).eq('prestador_id', S.user.id).in('status', ATIVOS),
    sb.from('gf_retornos').select('id', { count: 'exact', head: true }).eq('guincheiro_id', S.user.id).eq('status', 'ativo')]);
  [propsR, servR, retR].forEach(ok);
  const perto = abertos.filter(p => p.dist != null && p.dist <= Number(S.raio)).sort((a, b) => a.dist - b.dist);
  V.innerHTML = `${blocoInstalar()}
    <div class="troca"><div><b>${S.perfil.disponivel ? 'Disponível para serviços' : 'Indisponível'}</b><br>
      <span style="color:var(--cinza);font-size:14px">${S.perfil.disponivel ? 'Clientes e colegas sabem que você está atendendo.' : 'Ative quando puder pegar serviço.'}</span></div>
      <input type="checkbox" role="switch" id="disp" aria-label="Disponível para serviços" ${S.perfil.disponivel ? 'checked' : ''}></div>
    <div class="resumo">
      <a href="#buscar"><b>${abertos.length}</b>pedidos abertos</a>
      <a href="#servicos"><b>${servR.count ?? 0}</b>serviços em andamento</a>
      <a href="#servicos/propostas"><b>${propsR.count ?? 0}</b>propostas aguardando</a>
      <a href="#rotas"><b>${retR.count ?? 0}</b>rotas ativas</a>
    </div>
    <h3 class="sec-t">Próximos de ${esc(S.perfil.cidade)}</h3>
    ${chips('raio', [['20', '20 km'], ['50', '50 km'], ['100', '100 km'], ['150', '150 km']], S.raio)}
    ${perto.length ? perto.slice(0, 10).map(p => cardPedidoAberto(p, `${p.dist} km de você`)).join('') : '<div class="vazio">Nenhum pedido aberto neste raio agora.<br>Aumente o raio ou anuncie sua rota de volta.</div>'}
    <div class="acoes"><a class="btn full" href="#rotas/nova">Anunciar rota ou vaga</a><a class="btn fant full" href="#repasse/novo">Repassar um serviço para a rede</a></div>`;
  ligaChips('raio', v => { S.raio = v; rota(); });
  $('#disp').onchange = async e => {
    const el = e.currentTarget, v = el.checked;
    try { await rpc('gf_definir_disponivel', { p_disponivel: v }); S.perfil.disponivel = v; toast(v ? 'Você está disponível.' : 'Você está indisponível.'); rota(true); }
    catch (er) { el.checked = !v; falha(er); }
  };
  ligaInstalar(); aoVivo();
}
async function telaBuscar() {
  titulo('Buscar pedidos');
  if (!aprovado()) { V.innerHTML = blocoProgresso(); return; }
  const f = S.filtros.buscar ||= { raio: '0', tipo: 'todos' };
  let lista = await pedidosAbertos();
  if (f.raio !== '0') lista = lista.filter(p => p.dist != null && p.dist <= Number(f.raio));
  if (f.tipo === 'repasse') lista = lista.filter(p => p.tipo === 'repasse');
  lista.sort((a, b) => (a.dist ?? 9999) - (b.dist ?? 9999));
  V.innerHTML = `<p style="color:var(--cinza);margin-top:0">Pedidos abertos, do mais perto ao mais longe de ${esc(S.perfil.cidade)}. Atualiza sozinho a cada 30 s.</p>
    ${chips('raio', [['50', '50 km'], ['100', '100 km'], ['150', '150 km'], ['300', '300 km'], ['0', 'Todos']], f.raio)}
    ${chips('tipo', [['todos', 'Clientes e repasses'], ['repasse', 'Só repasses']], f.tipo)}
    ${lista.length ? lista.map(p => cardPedidoAberto(p, p.dist != null ? `${p.dist} km de você` : '')).join('') : '<div class="vazio"><h2>Sem pedidos abertos</h2>Anuncie sua rota para ver o que cabe no caminho.</div>'}`;
  ligaChips('raio', v => { f.raio = v; rota(); }); ligaChips('tipo', v => { f.tipo = v; rota(); });
  aoVivo();
}
async function telaRotas() {
  titulo('Rotas e vagas');
  if (!aprovado()) { V.innerHTML = blocoProgresso(); return; }
  const [minhas, rede] = await Promise.all([
    sb.from('gf_retornos').select('*').eq('guincheiro_id', S.user.id).order('saida', { ascending: false }).limit(50),
    sb.from('gf_retornos').select('id,origem,destino,saida,equipamento,sentido,vagas,g:gf_perfis!gf_retornos_guincheiro_id_fkey(nome,cidade)')
      .neq('guincheiro_id', S.user.id).eq('status', 'ativo').gte('saida', new Date(Date.now() - 864e5).toISOString()).order('saida').limit(50)]);
  const m = ok(minhas), r = ok(rede);
  const card = (x, meu) => `<a class="item ${x.status === 'ativo' || !meu ? 'quente' : ''}" href="#rota/${x.id}">
    <div class="trajeto">${esc(x.origem)} › ${esc(x.destino)}</div>
    <div class="meta">${dataHora(x.saida)} · ${esc(x.equipamento)} · ${x.vagas} vaga${x.vagas > 1 ? 's' : ''}${!meu && x.g ? ' · ' + esc(x.g.nome) : ''}</div>
    <div class="tags"><span class="tag ${x.sentido === 'retorno' ? 'am' : ''}">${x.sentido === 'retorno' ? 'Retorno' : 'Ida'}</span>
      ${meu ? `<span class="tag">${x.status === 'ativo' ? 'Ativa' : 'Encerrada'}</span>` : ''}</div></a>`;
  V.innerHTML = `<a class="btn full" href="#rotas/nova">Anunciar rota ou vaga</a>
    <h3 class="sec-t">Minhas rotas</h3>
    ${m.length ? m.map(x => card(x, true)).join('') : '<div class="vazio">Anuncie de onde sai e para onde volta. O GF mostra os pedidos que cabem no caminho.</div>'}
    <h3 class="sec-t">Vagas na rede</h3>
    <p style="color:var(--cinza);font-size:15px;margin-top:0">Colegas com caminhão saindo. Útil para repassar serviço.</p>
    ${r.length ? r.map(x => card(x, false)).join('') : '<div class="vazio">Nenhuma vaga anunciada por colegas agora.</div>'}`;
}
function telaNovaRota() {
  titulo('Anunciar rota');
  if (!aprovado()) { V.innerHTML = blocoProgresso(); return; }
  const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4 + 36e5).toISOString().slice(0, 16);
  V.innerHTML = `<form id="fR" novalidate>
    <div class="seg c2" role="radiogroup" aria-label="Sentido"><label><input type="radio" name="sentido" value="retorno" checked><span>Retorno (voltando)</span></label>
      <label><input type="radio" name="sentido" value="ida"><span>Ida (vaga sobrando)</span></label></div>
    <div class="linha2">
      <div><label for="ro">Saio de</label><input id="ro" name="origem" list="dlCidades" required></div>
      <div><label for="rd">Vou para</label><input id="rd" name="destino" list="dlCidades" value="${esc(S.perfil.cidade)}" required></div>
    </div>
    <label for="rs">Saída</label><input id="rs" name="saida" type="datetime-local" value="${agora}" required>
    <div class="linha2">
      <div><label for="rq">Equipamento livre</label><select id="rq" name="equipamento">${EQUIPAMENTOS.map(e => `<option ${S.perfil.equipamento === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div><label for="rv">Vagas</label><input id="rv" name="vagas" type="number" min="1" max="12" value="1" required></div>
    </div>
    <label for="rb">Observação (opcional)</label><textarea id="rb" name="obs" maxlength="500" placeholder="Ex.: plataforma livre, aceito até 2 veículos leves"></textarea>
    <button class="btn full" style="margin-top:16px">Anunciar e ver pedidos na rota</button>
  </form>`;
  $('#fR').onsubmit = e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    if (!cidadeOk(d.origem) || !cidadeOk(d.destino)) return toast('Escolha as cidades na lista de sugestões.', true);
    if (d.origem === d.destino) return toast('Origem e destino precisam ser diferentes.', true);
    const vagas = parseInt(d.vagas, 10); if (!(vagas >= 1 && vagas <= 12)) return toast('Vagas entre 1 e 12.', true);
    if (!d.saida) return toast('Informe a saída.', true);
    comBotao(e.target.querySelector('button'), async () => {
      try {
        const r = ok(await sb.from('gf_retornos').insert({ guincheiro_id: S.user.id, sentido: d.sentido, origem: d.origem, destino: d.destino,
          saida: new Date(d.saida).toISOString(), equipamento: d.equipamento, vagas, obs: d.obs.trim() || null }).select('id').single());
        toast('Rota anunciada.'); location.hash = 'rota/' + r.id;
      } catch (er) { falha(er, 'Não foi possível anunciar a rota.'); }
    });
  };
}
async function telaRota(id) {
  const r = ok(await sb.from('gf_retornos').select('*, g:gf_perfis!gf_retornos_guincheiro_id_fkey(nome,cidade,empresa)').eq('id', id).maybeSingle());
  if (!r) { V.innerHTML = '<div class="vazio"><h2>Rota não encontrada</h2><a href="#rotas">Voltar</a></div>'; return; }
  titulo(r.origem + ' › ' + r.destino);
  const meu = r.guincheiro_id === S.user.id;
  const lista = (await pedidosAbertos()).map(p => ({ ...p, desvio: GF_GEO.desvio(r.origem, r.destino, p.origem, p.destino) }))
    .filter(p => p.desvio != null && p.desvio <= 120).sort((a, b) => a.desvio - b.desvio);
  V.innerHTML = `<div class="item quente"><div class="trajeto">${esc(r.origem)} › ${esc(r.destino)}</div>
    <div class="meta">${r.sentido === 'retorno' ? 'Retorno' : 'Ida'} · ${dataHora(r.saida)} · ${esc(r.equipamento)} · ${r.vagas} vaga(s) · ${kmTxt(GF_GEO.km(r.origem, r.destino))}</div>
    ${!meu && r.g ? `<div class="meta">${esc(r.g.nome)}${r.g.empresa ? ' · ' + esc(r.g.empresa) : ''} · ${esc(r.g.cidade)}</div>` : ''}
    ${r.obs ? `<div class="meta">${esc(r.obs)}</div>` : ''}</div>
    ${meu ? `<h3 class="sec-t">Pedidos que cabem na rota (${lista.length})</h3>
      ${lista.length ? lista.map(p => cardPedidoAberto(p, `desvio ~${p.desvio} km`)).join('') : '<div class="vazio">Nenhum pedido aberto nessa rota agora.<br>Deixe a rota ativa: novos pedidos aparecem aqui.</div>'}
      <div class="acoes"><button class="btn fant full" id="btEnc">${r.status === 'ativo' ? 'Encerrar rota' : 'Reativar rota'}</button>
      <button class="btn perigo full" id="btDel">Excluir rota</button></div>` : '<p style="color:var(--cinza)">Para combinar um repasse com este colega, publique o serviço em “Repassar” e ele recebe na busca.</p>'}`;
  if (!meu) return;
  aoVivo();
  $('#btEnc').onclick = e => comBotao(e.currentTarget, async () => {
    try { ok(await sb.from('gf_retornos').update({ status: r.status === 'ativo' ? 'encerrado' : 'ativo' }).eq('id', id)); toast('Rota atualizada.'); rota(); }
    catch (er) { falha(er); }
  });
  $('#btDel').onclick = async () => {
    if (!await perguntar({ titulo: 'Excluir esta rota?', ok: 'Excluir', perigo: true })) return;
    try { ok(await sb.from('gf_retornos').delete().eq('id', id)); toast('Rota excluída.'); location.hash = 'rotas'; }
    catch (er) { falha(er); }
  };
}
async function telaServicos() {
  titulo('Meus serviços');
  const aba = decodeURIComponent(location.hash).split('/')[1] || 'andamento';
  const f = S.filtros.servicos ||= { dias: '30' };
  if (aba === 'quanto') return telaCalculadora(decodeURIComponent(location.hash).split('/')[2] || null);
  let html = chips('aba', [['andamento', 'Em andamento'], ['historico', 'Histórico e valores'], ['propostas', 'Propostas'], ['quanto', 'Quanto sobra?']], aba);
  if (aba === 'propostas') {
    const d = ok(await sb.from('gf_propostas').select('*, p:gf_pedidos(id,origem,destino,veiculo,status)').eq('guincheiro_id', S.user.id)
      .order('atualizado_em', { ascending: false }).limit(100));
    const rot = { enviada: 'Aguardando o cliente', aceita: 'Aceita', recusada: 'Não escolhida', cancelada: 'Retirada' };
    html += d.length ? d.map(x => `<a class="item ${x.status === 'aceita' ? 'quente' : ''}" href="#pedido/${x.p?.id}">
      <div class="trajeto">${esc(x.p?.origem)} › ${esc(x.p?.destino)}</div><div class="meta">${esc(x.p?.veiculo)} · ${brl(x.valor)} · ${dataHora(x.atualizado_em)}</div>
      <div class="tags"><span class="tag ${x.status === 'aceita' ? 'vd' : x.status === 'recusada' ? 'vm' : ''}">${rot[x.status]}</span></div></a>`).join('')
      : '<div class="vazio"><h2>Nenhuma proposta ainda</h2><a href="#buscar">Ver pedidos abertos</a></div>';
  } else {
    const d = ok(await sb.from('gf_pedidos').select('id,origem,destino,veiculo,veiculo_tipo,status,valor_combinado,aceito_em,concluido_em,nota,criado_em')
      .eq('prestador_id', S.user.id).order('atualizado_em', { ascending: false }).limit(300));
    if (aba === 'andamento') {
      const at = d.filter(p => ATIVOS.includes(p.status));
      html += at.length ? at.map(p => `<div class="item quente"><a href="#pedido/${p.id}" style="color:inherit;text-decoration:none">
        <div class="trajeto">${esc(p.origem)} › ${esc(p.destino)}</div><div class="meta">${esc(p.veiculo)} · ${brl(p.valor_combinado)}</div>
        <div class="tags">${tagStatus(p.status)}</div></a>
        <button class="btn full" style="margin-top:12px" data-av="${p.id}" data-st="${PROXIMO[p.status]}">${ACAO_PRESTADOR[p.status]}</button></div>`).join('')
        : '<div class="vazio">Nenhum serviço em andamento.<br>Quando um cliente aceitar sua proposta, ele aparece aqui.</div>';
    } else {
      const conc = d.filter(p => p.status === 'concluido' && dentroDoPeriodo(p.concluido_em || p.criado_em, Number(f.dias)));
      const notas = conc.filter(p => p.nota);
      html += chips('dias', [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']], f.dias) +
        `<div class="resumo"><div><b>${conc.length}</b>serviços concluídos</div><div><b>${brl(totalRegistrado(conc))}</b>valores registrados</div>
          <div><b>${notas.length ? (notas.reduce((s, p) => s + p.nota, 0) / notas.length).toFixed(1) : '–'}</b>nota média</div><div><b>R$ 0,00</b>pago pelo GF</div></div>
        <p class="aviso" style="font-size:15px"><b>Valor registrado</b> é o combinado com o cliente na proposta aceita. O pagamento é acertado direto entre vocês: o GF não processa nem garante pagamentos nesta fase.</p>` +
        (conc.length ? conc.map(p => `<div class="item"><a href="#pedido/${p.id}" style="color:inherit;text-decoration:none"><div class="trajeto">${esc(p.origem)} › ${esc(p.destino)}</div>
          <div class="meta">${esc(p.veiculo)} · ${dataHora(p.concluido_em)} · ${brl(p.valor_combinado)} registrado${p.nota ? ' · ' + '★'.repeat(p.nota) : ''}</div></a>
          <a class="btn sec peq" style="margin-top:12px" href="#servicos/quanto/${p.id}">Quanto sobrou?</a></div>`).join('')
          : '<div class="vazio">Nenhum serviço concluído neste período.</div>');
    }
  }
  V.innerHTML = html;
  ligaChips('aba', v => location.hash = 'servicos/' + v);
  ligaChips('dias', v => { f.dias = v; rota(); });
  V.querySelectorAll('[data-av]').forEach(b => b.onclick = () => avancar(b, b.dataset.av, b.dataset.st));
  if (aba === 'andamento') aoVivo();
}
// ───────────── "Quanto realmente sobra?" (estimativa feita no próprio celular) ─────────────
const PREF_CALC = 'gf_calc_pref';
function prefCalc() { try { return JSON.parse(localStorage.getItem(PREF_CALC)) || {}; } catch (e) { return {}; } }
async function telaCalculadora(pedidoId) {
  titulo('Quanto sobra?');
  const pref = prefCalc();
  let ped = null, kmSug = '';
  if (pedidoId) {
    ped = ok(await sb.from('gf_pedidos').select('id,origem,destino,veiculo,valor_combinado,prestador_id').eq('id', pedidoId).maybeSingle());
    if (ped) {
      const base = S.perfil.cidade, t = [GF_GEO.km(base, ped.origem), GF_GEO.km(ped.origem, ped.destino), GF_GEO.km(ped.destino, base)];
      if (t.every(x => x != null)) kmSug = String(t.reduce((a, b) => a + b, 0));
    }
  }
  const v = (k, d = '') => esc(String(pref[k] ?? d)).replace('.', ',');
  V.innerHTML = `${chips('aba', [['andamento', 'Em andamento'], ['historico', 'Histórico e valores'], ['propostas', 'Propostas'], ['quanto', 'Quanto sobra?']], 'quanto')}
  <div class="aviso"><b>Quanto realmente sobra?</b> Coloque o que recebeu e o que gastou. A conta é feita aqui no seu celular e não é enviada a ninguém.</div>
  ${ped ? `<div class="item quente"><div class="trajeto">${esc(ped.origem)} › ${esc(ped.destino)}</div><div class="meta">${esc(ped.veiculo)}${kmSug ? ` · ~${kmSug} km ida e volta desde ${esc(S.perfil.cidade)} (estimativa, ajuste se precisar)` : ''}</div></div>` : ''}
  <form id="fC" novalidate>
    <div class="linha2">
      <div><label for="cv">Valor recebido (R$)</label><input id="cv" name="valor" inputmode="decimal" value="${ped?.valor_combinado != null ? String(ped.valor_combinado).replace('.', ',') : ''}" placeholder="Ex.: 850"></div>
      <div><label for="ck">Km rodados</label><input id="ck" name="km" inputmode="decimal" value="${esc(kmSug)}" placeholder="Ex.: 320"></div>
    </div>
    <div class="linha2">
      <div><label for="cc">Consumo (km por litro)</label><input id="cc" name="consumo" inputmode="decimal" value="${v('consumo', '4')}"></div>
      <div><label for="cd">Diesel (R$ por litro)</label><input id="cd" name="diesel" inputmode="decimal" value="${v('diesel', '6,20')}"></div>
    </div>
    <div class="linha2">
      <div><label for="cm">Manutenção (R$ por km)</label><input id="cm" name="manutencaoKm" inputmode="decimal" value="${v('manutencaoKm', '0,60')}"></div>
      <div><label for="ci">Impostos (% do valor)</label><input id="ci" name="impostosPct" inputmode="decimal" value="${v('impostosPct', '6')}"></div>
    </div>
    <div class="linha2">
      <div><label for="cp">Pedágios (R$)</label><input id="cp" name="pedagios" inputmode="decimal" placeholder="0"></div>
      <div><label for="co">Outros custos (R$)</label><input id="co" name="outros" inputmode="decimal" placeholder="Ajudante, alimentação…"></div>
    </div>
  </form>
  <div id="cRes" aria-live="polite"></div>
  <p style="color:var(--cinza);font-size:13px">Estimativa simplificada: não inclui depreciação do caminhão, custos fixos do mês nem todos os tributos. Consumo, diesel, manutenção e impostos ficam guardados neste celular para a próxima conta.</p>`;
  ligaChips('aba', x => location.hash = 'servicos/' + x);
  const f = $('#fC');
  const conta = () => {
    const d = Object.fromEntries(new FormData(f));
    try { localStorage.setItem(PREF_CALC, JSON.stringify({ consumo: d.consumo, diesel: d.diesel, manutencaoKm: d.manutencaoKm, impostosPct: d.impostosPct })); } catch (e) { }
    const r = calcularResultado(d);
    if (!r.receita) { $('#cRes').innerHTML = '<div class="vazio">Digite o valor recebido para ver o resultado.</div>'; return; }
    const linha = (t, x) => x ? `<tr><td>${t}</td><td style="text-align:right">${brl(x)}</td></tr>` : '';
    $('#cRes').innerHTML = `<div class="resumo" style="margin-top:16px">
        <div><b>${brl(r.receita)}</b>recebido</div><div><b>${brl(r.custos)}</b>custos</div>
        <div style="grid-column:1/-1;border-color:${r.resultado >= 0 ? 'var(--gf-success)' : 'var(--gf-danger)'}"><b style="color:${r.resultado >= 0 ? 'var(--gf-success)' : 'var(--gf-danger)'}">${brl(r.resultado)}</b>
          sobra estimada${r.margem != null ? ` · ${String(r.margem).replace('.', ',')}% do valor` : ''}${r.porKm != null ? ` · ${brl(r.porKm)} por km` : ''}</div></div>
      <div class="rolar"><table><tbody>${linha('Combustível', r.combustivel)}${linha('Manutenção', r.manutencao)}${linha('Impostos', r.impostos)}${linha('Pedágios', r.pedagios)}${linha('Outros', r.outros)}</tbody></table></div>`;
  };
  f.addEventListener('input', conta); f.onsubmit = e => e.preventDefault(); conta();
}

async function avancar(bt, pedidoId, novo) {
  const txt = { a_caminho: 'Confirmar que saiu para o atendimento?', no_local: 'Confirmar que chegou no local?',
    em_transporte: 'Confirmar que o veículo está carregado?', concluido: 'Confirmar que entregou o veículo no destino?' }[novo];
  if (!await perguntar({ titulo: txt, texto: 'O cliente acompanha cada etapa no app.', ok: 'Confirmar' })) return;
  comBotao(bt, async () => {
    try { await rpc('gf_atualizar_status', { p_pedido: pedidoId, p_status: novo, p_detalhe: null }); toast('Atualizado: ' + STATUS[novo] + '.'); rota(); contadores(); }
    catch (er) { falha(er); }
  });
}

// ───────────────────────── detalhe do pedido ─────────────────────────
function linhaDoTempo(p) {
  if (p.status === 'cancelado') return `<div class="aviso"><b>Pedido cancelado.</b>${p.cancelado_motivo ? ' Motivo: ' + esc(p.cancelado_motivo) : ''}</div>`;
  const i = ETAPAS.indexOf(p.status);
  return `<ol class="passos" aria-label="Andamento">${ETAPAS.map((s, k) =>
    `<li class="${k < i || p.status === 'concluido' ? 'feito' : k === i ? 'atual' : ''}" ${k === i ? 'aria-current="step"' : ''}>${esc(STATUS[s])}</li>`).join('')}</ol>`;
}
async function botaoContato(p, papel) {
  try {
    const c = await rpc('gf_contato', { p_pedido: p.id });
    const msg = papel === 'cliente'
      ? `Olá ${c.nome}! Aceitei sua proposta no GF: ${p.origem} › ${p.destino}, ${p.veiculo}, ${brl(p.valor_combinado)}.`
      : `Olá ${c.nome}! Sou ${S.perfil.nome}, do GF. Vamos combinar o serviço ${p.origem} › ${p.destino} (${p.veiculo})?`;
    return `<a class="btn zap full" style="margin-top:12px" target="_blank" rel="noopener" href="${linkZap(c.whatsapp, msg)}">Chamar ${esc(c.nome.split(' ')[0])} no WhatsApp</a>
      ${papel === 'cliente' && c.placa ? `<p style="color:var(--cinza);font-size:14px;margin:8px 0 0">Placa do caminhão: <b style="color:var(--branco)">${esc(c.placa)}</b></p>` : ''}`;
  } catch (e) { return `<p style="color:var(--cinza)">${esc(mensagemErro(e))}</p>`; }
}
async function historico(id) {
  const ev = ok(await sb.from('gf_eventos').select('*').eq('pedido_id', id).order('criado_em', { ascending: false }).limit(50));
  const nome = { criado: 'Pedido criado', proposta: 'Proposta recebida', proposta_retirada: 'Proposta retirada', desistencia: 'Guincheiro desistiu',
    avaliacao: 'Serviço avaliado', ocorrencia: 'Ocorrência aberta' };
  return ev.length ? `<h3 class="sec-t">Histórico</h3><ul class="historico">${ev.map(e => `<li><time>${dataHora(e.criado_em)}</time>
    ${esc(e.tipo === 'status' ? STATUS[e.status_novo] || e.status_novo : nome[e.tipo] || e.tipo)}${e.detalhe ? ' · ' + esc(e.detalhe) : ''}</li>`).join('')}</ul>` : '';
}
async function telaPedido(id) {
  const p = ok(await sb.from('gf_pedidos').select('*, autor:gf_perfis!gf_pedidos_autor_id_fkey(nome,cidade,empresa), prestador:gf_perfis!gf_pedidos_prestador_id_fkey(nome,cidade,empresa,equipamento)')
    .eq('id', id).maybeSingle());
  if (!p) { titulo('Pedido'); V.innerHTML = '<div class="vazio"><h2>Pedido não encontrado</h2>Ele pode ter sido fechado com outro guincheiro.<br><a href="#inicio">Voltar ao início</a></div>'; return; }
  titulo(p.tipo === 'repasse' ? 'Repasse' : 'Pedido');
  const papel = p.autor_id === S.user.id ? 'cliente' : p.prestador_id === S.user.id ? 'prestador' : 'outro';
  const km = GF_GEO.km(p.origem, p.destino);
  let html = `<div class="item quente"><div class="trajeto">${esc(p.origem)} › ${esc(p.destino)}</div>
    <div class="meta">${esc(VEICULO[p.veiculo_tipo] || '')} · ${esc(p.veiculo)}${p.placa && papel !== 'outro' ? ' · ' + esc(p.placa) : ''} · ${esc(CONDICAO[p.condicao] || p.condicao)}</div>
    <div class="meta">${dataCurta(p.data_servico)}${km ? ' · trajeto ' + kmTxt(km) : ''}${papel !== 'cliente' && p.autor ? ' · pedido por ' + esc(p.autor.nome.split(' ')[0]) : ''}</div>
    ${p.obs ? `<div class="meta">${esc(p.obs)}</div>` : ''}
    <div class="tags">${p.tipo === 'repasse' ? '<span class="tag am">Repasse</span>' : ''}${tagStatus(p.status)}</div>
    <div id="mapa" role="img" aria-label="Mapa aproximado de ${esc(p.origem)} até ${esc(p.destino)}"></div></div>
    ${papel !== 'outro' ? linhaDoTempo(p) : ''}`;

  if (papel === 'cliente') {
    if (p.status === 'aberto') {
      const props = ok(await sb.from('gf_propostas').select('*, g:gf_perfis!gf_propostas_guincheiro_id_fkey(nome,cidade,equipamento,empresa,capacidade)')
        .eq('pedido_id', id).eq('status', 'enviada').order('valor'));
      const rep = props.length ? ok(await sb.rpc('gf_reputacao', { p_ids: props.map(x => x.guincheiro_id) })) : [];
      const repDe = gid => rep.find(r => r.perfil_id === gid);
      html += `<h3 class="sec-t">Propostas (${props.length})</h3>` + (props.length ? props.map(x => {
        const r = repDe(x.guincheiro_id);
        return `<div class="prop"><div class="valor">${brl(x.valor)}</div>
          <div><b>${esc(x.g?.nome || 'Guincheiro')}</b>${x.g?.empresa ? ' · ' + esc(x.g.empresa) : ''}</div>
          <div style="color:var(--cinza);font-size:15px">${esc(x.g?.cidade || '')} · ${esc(x.g?.equipamento || '')}${x.prazo ? ' · chega ' + esc(x.prazo) : ''}</div>
          <div style="color:var(--cinza);font-size:15px">${r ? `★ ${r.media ?? '–'} · ${r.concluidos} serviço${r.concluidos > 1 ? 's' : ''} pelo GF` : 'Novo no GF'}</div>
          ${x.mensagem ? `<div style="margin-top:6px">${esc(x.mensagem)}</div>` : ''}
          <button class="btn full" style="margin-top:12px" data-ac="${x.id}" data-v="${x.valor}">Aceitar esta proposta</button></div>`;
      }).join('') : '<div class="vazio">Ainda sem propostas. Guincheiros da região e com rota passando por aqui já estão vendo seu pedido. Esta tela atualiza sozinha.</div>');
    } else if (p.prestador_id) {
      html += `<h3 class="sec-t">Seu guincheiro</h3><div class="prop"><div class="valor">${brl(p.valor_combinado)}</div>
        <div><b>${esc(p.prestador?.nome || '')}</b>${p.prestador?.empresa ? ' · ' + esc(p.prestador.empresa) : ''}</div>
        <div style="color:var(--cinza);font-size:15px">${esc(p.prestador?.cidade || '')} · ${esc(p.prestador?.equipamento || '')}</div>
        <p style="color:var(--cinza);font-size:14px;margin:8px 0 0">Valor combinado na proposta (registrado). O pagamento é feito direto ao guincheiro; o GF não processa pagamentos.</p>
        ${p.status !== 'concluido' ? await botaoContato(p, 'cliente') : ''}</div>`;
      if (p.status === 'em_transporte') html += '<button class="btn full" style="margin-top:14px" id="btReceb">Recebi o veículo</button>';
    }
    if (p.status === 'concluido') {
      html += p.nota ? `<h3 class="sec-t">Sua avaliação</h3><p style="font-size:22px;margin:0;color:var(--placa)">${'★'.repeat(p.nota)}${'☆'.repeat(5 - p.nota)}</p>${p.avaliacao_comentario ? `<p>${esc(p.avaliacao_comentario)}</p>` : ''}`
        : `<h3 class="sec-t">Como foi o serviço?</h3><form id="fAv"><div class="seg c5" role="radiogroup" aria-label="Nota">${[1, 2, 3, 4, 5].map(n =>
          `<label><input type="radio" name="nota" value="${n}" required><span>${n}★</span></label>`).join('')}</div>
          <label for="avc">Comentário (opcional)</label><textarea id="avc" name="comentario" maxlength="500"></textarea>
          <button class="btn full" style="margin-top:12px">Enviar avaliação</button></form>`;
    }
    if (['aberto', 'aceito', 'a_caminho'].includes(p.status)) html += '<button class="btn perigo full" style="margin-top:18px" id="btCanc">Cancelar pedido</button>';
  } else if (papel === 'prestador') {
    html += `<div class="prop"><div class="valor">${brl(p.valor_combinado)}</div><div style="color:var(--cinza);font-size:15px">Valor combinado (registrado). Pagamento direto com o cliente.</div>
      ${p.status !== 'concluido' ? await botaoContato(p, 'prestador') : ''}</div>
      ${PROXIMO[p.status] ? `<button class="btn full" style="margin-top:14px;min-height:64px;font-size:20px" id="btAv">${ACAO_PRESTADOR[p.status]}</button>` : ''}
      ${['aceito', 'a_caminho'].includes(p.status) ? '<button class="btn perigo full" style="margin-top:12px" id="btDesist">Não vou conseguir atender</button>' : ''}`;
    if (p.status === 'concluido') html += `<a class="btn sec full" style="margin-top:12px" href="#servicos/quanto/${p.id}">Quanto sobrou neste serviço?</a>`;
    if (p.nota) html += `<p style="color:var(--placa);font-size:20px">Avaliação do cliente: ${'★'.repeat(p.nota)}</p>${p.avaliacao_comentario ? `<p>${esc(p.avaliacao_comentario)}</p>` : ''}`;
  } else {
    const mine = ok(await sb.from('gf_propostas').select('*').eq('pedido_id', id).eq('guincheiro_id', S.user.id).maybeSingle());
    const rot = { enviada: 'Aguardando o cliente', aceita: 'Aceita', recusada: 'Não escolhida', cancelada: 'Retirada' };
    if (mine && (mine.status !== 'cancelada' || p.status !== 'aberto')) {
      html += `<h3 class="sec-t">Sua proposta</h3><div class="prop"><div class="valor">${brl(mine.valor)}</div>
        <span class="tag ${mine.status === 'recusada' ? 'vm' : ''}">${rot[mine.status]}</span></div>`;
    }
    if (p.status === 'aberto' && ehGuincho() && aprovado() && (!mine || mine.status !== 'aceita')) {
      const ed = mine?.status === 'enviada';
      html += `<h3 class="sec-t">${ed ? 'Alterar proposta' : 'Mandar proposta'}</h3><form id="fPr" novalidate>
        <label for="pv">Valor total (R$)</label><input id="pv" name="valor" inputmode="decimal" placeholder="Ex.: 450" value="${ed ? String(mine.valor).replace('.', ',') : ''}" required>
        <label for="pp">Quando consegue chegar</label><input id="pp" name="prazo" maxlength="80" placeholder="Ex.: hoje até 16h" value="${esc(ed ? mine.prazo : '')}">
        <label for="pm">Mensagem (opcional)</label><textarea id="pm" name="mensagem" maxlength="500" placeholder="Ex.: estou voltando de Santa Maria, passo aí no caminho">${esc(ed ? mine.mensagem : '')}</textarea>
        <button class="btn full" style="margin-top:14px">${ed ? 'Atualizar proposta' : 'Enviar proposta'}</button></form>
        ${ed ? '<button class="btn fant full" style="margin-top:10px" id="btRet">Retirar proposta</button>' : ''}`;
    } else if (p.status === 'aberto' && ehGuincho() && !aprovado()) html += blocoProgresso();
  }
  if (papel !== 'outro') {
    html += `<a class="btn fant full" style="margin-top:12px" href="#ocorrencia/nova/${p.id}">Abrir ocorrência</a>`;
    html += await historico(id);
  }
  V.innerHTML = html;
  mapaRota(p.origem, p.destino);
  if (['aberto', ...ATIVOS].includes(p.status)) aoVivo();

  V.querySelectorAll('[data-ac]').forEach(b => b.onclick = async () => {
    if (!await perguntar({ titulo: `Aceitar proposta de ${brl(b.dataset.v)}?`, texto: 'As outras propostas serão recusadas e o contato do guincheiro é liberado.', ok: 'Aceitar' })) return;
    comBotao(b, async () => {
      try { await rpc('gf_aceitar_proposta', { p_proposta: b.dataset.ac }); toast('Proposta aceita. Combine os detalhes pelo WhatsApp.'); rota(); contadores(); }
      catch (er) { falha(er); rota(true); }
    });
  });
  if ($('#btCanc')) $('#btCanc').onclick = async () => {
    const r = await perguntar({ titulo: 'Cancelar este pedido?', texto: p.status === 'aberto' ? '' : 'O guincheiro já foi escolhido. Conte o motivo.',
      campo: p.status === 'aberto' ? null : { label: 'Motivo', obrigatorio: true }, ok: 'Cancelar pedido', perigo: true });
    if (r == null) return;
    try { await rpc('gf_cancelar_pedido', { p_pedido: id, p_motivo: r === true ? null : r }); toast('Pedido cancelado.'); rota(); }
    catch (er) { falha(er); }
  };
  if ($('#btReceb')) $('#btReceb').onclick = e => avancar(e.currentTarget, id, 'concluido');
  if ($('#btAv')) $('#btAv').onclick = e => avancar(e.currentTarget, id, PROXIMO[p.status]);
  if ($('#btDesist')) $('#btDesist').onclick = async () => {
    const m = await perguntar({ titulo: 'Desistir deste atendimento?', texto: 'O pedido volta para a rede e o cliente pode escolher outra proposta.',
      campo: { label: 'Motivo (o cliente vê)', obrigatorio: true }, ok: 'Desistir', perigo: true });
    if (!m) return;
    try { await rpc('gf_cancelar_pedido', { p_pedido: id, p_motivo: m }); toast('Pedido devolvido para a rede.'); location.hash = 'servicos'; }
    catch (er) { falha(er); }
  };
  if ($('#fAv')) $('#fAv').onsubmit = e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    if (!d.nota) return toast('Escolha de 1 a 5 estrelas.', true);
    comBotao(e.target.querySelector('button'), async () => {
      try { await rpc('gf_avaliar', { p_pedido: id, p_nota: Number(d.nota), p_comentario: d.comentario }); toast('Obrigado pela avaliação!'); rota(); }
      catch (er) { falha(er); }
    });
  };
  if ($('#fPr')) {
    $('#fPr').addEventListener('input', () => $('#fPr').dataset.sujo = '1');
    $('#fPr').onsubmit = e => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); const valor = valorDigitado(d.valor);
      if (!(valor >= 1 && valor <= 100000)) { $('#pv').setAttribute('aria-invalid', 'true'); $('#pv').focus(); return toast('Informe um valor entre R$ 1 e R$ 100.000.', true); }
      comBotao(e.target.querySelector('button'), async () => {
        try { await rpc('gf_enviar_proposta', { p_pedido: id, p_valor: valor, p_prazo: d.prazo, p_mensagem: d.mensagem }); toast('Proposta enviada.'); rota(); }
        catch (er) { falha(er); }
      });
    };
  }
  if ($('#btRet')) $('#btRet').onclick = async e => {
    const mine = ok(await sb.from('gf_propostas').select('id').eq('pedido_id', id).eq('guincheiro_id', S.user.id).maybeSingle());
    if (!mine || !await perguntar({ titulo: 'Retirar sua proposta?', ok: 'Retirar', perigo: true })) return;
    comBotao(e.target, async () => {
      try { await rpc('gf_retirar_proposta', { p_proposta: mine.id }); toast('Proposta retirada.'); rota(); } catch (er) { falha(er); }
    });
  };
}

// ───────────────────────── ocorrências ─────────────────────────
async function telaOcorrencias() {
  titulo('Ocorrências');
  const d = ok(await sb.from('gf_ocorrencias').select('*').eq('autor_id', S.user.id).order('criado_em', { ascending: false }).limit(50));
  const st = { aberta: 'Aberta', em_analise: 'Em análise', resolvida: 'Resolvida' };
  V.innerHTML = `<a class="btn full" href="#ocorrencia/nova">Abrir ocorrência</a><div style="height:12px"></div>
    ${d.length ? d.map(o => `<div class="item"><div class="meta">${dataHora(o.criado_em)} · ${esc(OCORRENCIA[o.tipo])}</div>
      <p style="margin:6px 0">${esc(o.descricao)}</p><div class="tags"><span class="tag ${o.status === 'resolvida' ? 'vd' : 'am'}">${st[o.status]}</span>
      ${o.pedido_id ? `<a class="tag" href="#pedido/${o.pedido_id}">ver pedido</a>` : ''}</div>
      ${o.resposta ? `<p style="margin:10px 0 0"><b>Resposta GF:</b> ${esc(o.resposta)}</p>` : ''}</div>`).join('')
      : '<div class="vazio">Nenhuma ocorrência. Se algo der errado num atendimento, registre aqui: a equipe GF acompanha.</div>'}`;
}
function telaNovaOcorrencia(pedidoId) {
  titulo('Nova ocorrência');
  V.innerHTML = `<form id="fO" novalidate>${pedidoId ? '<p style="color:var(--cinza)">Ligada ao pedido que você estava vendo.</p>' : ''}
    <label for="ot">Tipo</label><select id="ot" name="tipo">${Object.entries(OCORRENCIA).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
    <label for="od">O que aconteceu?</label><textarea id="od" name="descricao" minlength="10" maxlength="2000" required></textarea>
    <button class="btn full" style="margin-top:14px">Enviar para a equipe GF</button></form>`;
  $('#fO').onsubmit = e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    if (d.descricao.trim().length < 10) return toast('Descreva o que aconteceu (mínimo 10 letras).', true);
    comBotao(e.target.querySelector('button'), async () => {
      try { await rpc('gf_abrir_ocorrencia', { p_pedido: pedidoId, p_tipo: d.tipo, p_descricao: d.descricao }); toast('Ocorrência registrada.'); location.hash = 'ocorrencias'; }
      catch (er) { falha(er); }
    });
  };
}

// ───────────────────────── administração ─────────────────────────
function csv(rows, nome) {
  if (!rows.length) return toast('Nada para exportar.');
  const cols = Object.keys(rows[0]); const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const txt = '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => q(typeof r[c] === 'object' && r[c] ? JSON.stringify(r[c]) : r[c])).join(';'))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = `gf-${nome}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}
async function telaAdmin(aba) {
  if (!S.perfil.is_admin) { location.hash = 'inicio'; return; }
  titulo('Administração');
  let html = chips('adm', [['indicadores', 'Indicadores'], ['cadastros', 'Cadastros'], ['pedidos', 'Pedidos'], ['rotas', 'Rotas'], ['ocorrencias', 'Ocorrências'], ['lista', 'Lista de espera']], aba);
  let dados = [];
  if (aba === 'indicadores') {
    const k = await rpc('gf_admin_indicadores');
    const ps = k.por_status || {};
    const taxa = k.pedidos_total ? Math.round(100 * k.pedidos_com_proposta / k.pedidos_total) + '%' : '–';
    html += `<p style="color:var(--cinza);margin-top:0">Números calculados agora, direto do banco.</p>
      <div class="resumo">
        <div><b>${k.usuarios}</b>usuários (${k.clientes} clientes/empresas)</div>
        <a href="#admin/cadastros"><b>${k.guincheiros_pendentes}</b>guincheiros aguardando aprovação</a>
        <div><b>${k.guincheiros_aprovados}</b>guincheiros aprovados (${k.guincheiros_disponiveis} disponíveis)</div>
        <div><b>${k.pedidos_30d}</b>pedidos nos últimos 30 dias (${k.pedidos_total} no total)</div>
        <div><b>${taxa}</b>dos pedidos receberam proposta</div>
        <div><b>${k.minutos_ate_primeira_proposta ?? '–'}</b>minutos até a 1ª proposta (média)</div>
        <div><b>${ps.concluido || 0}</b>atendimentos concluídos</div>
        <div><b>${k.avaliacao_media ?? '–'}</b>nota média dos clientes</div>
        <div><b>${brl(k.valor_registrado_concluidos)}</b>valores registrados em concluídos</div>
        <div><b>${k.pagamentos_processados}</b>pagamentos processados pelo GF</div>
        <a href="#admin/rotas"><b>${k.retornos_ativos}</b>rotas/vagas ativas</a>
        <a href="#admin/ocorrencias"><b>${k.ocorrencias_abertas}</b>ocorrências em aberto</a>
        <a href="#admin/lista"><b>${k.lista_espera}</b>na lista de espera</a>
      </div>
      <h3 class="sec-t">Pedidos por situação</h3>
      <table><tbody>${Object.keys(STATUS).map(s => `<tr><td>${esc(STATUS[s])}</td><td style="text-align:right"><b>${ps[s] || 0}</b></td></tr>`).join('')}</tbody></table>`;
  } else if (aba === 'cadastros') {
    const f = S.filtros.adm ||= { quem: 'pendentes' };
    const todos = await rpc('gf_admin_usuarios');
    const filtro = { pendentes: u => u.tipo === 'guincheiro' && u.aprovacao === 'pendente', guincheiros: u => u.tipo === 'guincheiro', clientes: u => u.tipo !== 'guincheiro', todos: () => true };
    dados = todos.filter(filtro[f.quem]);
    html += chips('quem', [['pendentes', 'Aguardando'], ['guincheiros', 'Guincheiros'], ['clientes', 'Clientes'], ['todos', 'Todos']], f.quem) +
      `<button class="btn sec full" id="btCsv">Baixar CSV</button><div style="height:12px"></div>` +
      (dados.length ? dados.map(u => `<div class="item"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(u.nome)}</b><span class="tag ${u.aprovacao === 'aprovado' ? 'vd' : u.aprovacao === 'pendente' ? 'am' : 'vm'}">${esc(APROVACAO[u.aprovacao])}</span></div>
        <div class="meta">${esc({ guincheiro: 'Guincheiro', cliente: 'Cliente', empresa: 'Empresa' }[u.tipo])}${u.empresa ? ' · ' + esc(u.empresa) : ''} · ${esc(u.cidade)} · ${esc(u.email || '')}</div>
        ${u.tipo === 'guincheiro' ? `<div class="meta">${esc(u.equipamento || 'sem equipamento')} · ${esc(CAPACIDADE[u.capacidade] || 'capacidade não informada')} · placa ${esc(u.placa || '—')} · até ${u.raio_km} km</div>` : ''}
        ${u.aprovacao_obs ? `<div class="meta">Obs.: ${esc(u.aprovacao_obs)}</div>` : ''}
        <div class="meta">Cadastro em ${dataHora(u.criado_em)}${u.is_admin ? ' · administrador' : ''}</div>
        <div class="acoes" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
          <a class="btn zap peq" target="_blank" rel="noopener" href="${linkZap(u.whatsapp, `Olá ${u.nome}, aqui é da equipe GF (Guincho Fácil).`)}">WhatsApp</a>
          ${u.tipo === 'guincheiro' && u.aprovacao !== 'aprovado' ? `<button class="btn peq" data-apr="${u.id}" data-st="aprovado">Aprovar</button>` : ''}
          ${u.tipo === 'guincheiro' && u.aprovacao === 'pendente' ? `<button class="btn fant peq" data-apr="${u.id}" data-st="recusado">Recusar</button>` : ''}
          ${u.aprovacao !== 'bloqueado' && !u.is_admin ? `<button class="btn perigo peq" data-apr="${u.id}" data-st="bloqueado">Bloquear</button>` : ''}
        </div></div>`).join('') : '<div class="vazio">Ninguém neste filtro.</div>');
  } else if (aba === 'pedidos') {
    const f = S.filtros.admPed ||= { st: 'ativos' };
    let q = sb.from('gf_pedidos').select('id,tipo,origem,destino,veiculo,status,valor_combinado,criado_em,autor:gf_perfis!gf_pedidos_autor_id_fkey(nome),prestador:gf_perfis!gf_pedidos_prestador_id_fkey(nome)')
      .order('criado_em', { ascending: false }).limit(300);
    if (f.st === 'ativos') q = q.not('status', 'in', '(concluido,cancelado)'); else if (f.st !== 'todos') q = q.eq('status', f.st);
    dados = ok(await q);
    html += chips('pst', [['ativos', 'Em aberto/andamento'], ['concluido', 'Concluídos'], ['cancelado', 'Cancelados'], ['todos', 'Todos']], f.st) +
      `<button class="btn sec full" id="btCsv">Baixar CSV</button><div style="height:12px"></div>` +
      (dados.length ? dados.map(p => `<div class="item"><div class="trajeto">${esc(p.origem)} › ${esc(p.destino)}</div>
        <div class="meta">${esc(p.veiculo)} · ${dataHora(p.criado_em)} · cliente ${esc(p.autor?.nome || '')}${p.prestador ? ' · guincheiro ' + esc(p.prestador.nome) : ''}${p.valor_combinado != null ? ' · ' + brl(p.valor_combinado) : ''}</div>
        <div class="tags">${tagStatus(p.status)}${p.tipo === 'repasse' ? '<span class="tag">Repasse</span>' : ''}</div>
        ${!['concluido', 'cancelado'].includes(p.status) ? `<button class="btn perigo peq" style="margin-top:10px" data-canc="${p.id}">Cancelar (admin)</button>` : ''}</div>`).join('')
        : '<div class="vazio">Nenhum pedido neste filtro.</div>');
  } else if (aba === 'rotas') {
    dados = ok(await sb.from('gf_retornos').select('id,sentido,origem,destino,saida,equipamento,vagas,status,g:gf_perfis!gf_retornos_guincheiro_id_fkey(nome,cidade)')
      .order('saida', { ascending: false }).limit(300));
    html += `<button class="btn sec full" id="btCsv">Baixar CSV</button><div class="rolar"><table><thead><tr><th>Rota</th><th>Saída</th><th>Guincheiro</th><th>Vagas</th><th>Situação</th></tr></thead><tbody>
      ${dados.map(r => `<tr><td>${esc(r.origem)} › ${esc(r.destino)} (${r.sentido})</td><td>${dataHora(r.saida)}</td><td>${esc(r.g?.nome || '')}</td><td>${r.vagas}</td><td>${esc(r.status)}</td></tr>`).join('')}</tbody></table></div>
      ${dados.length ? '' : '<div class="vazio">Nenhuma rota anunciada.</div>'}`;
  } else if (aba === 'ocorrencias') {
    dados = ok(await sb.from('gf_ocorrencias').select('*').order('status').order('criado_em', { ascending: false }).limit(200));
    html += dados.length ? dados.map(o => `<div class="item"><div class="meta">${dataHora(o.criado_em)} · ${esc(OCORRENCIA[o.tipo])}</div>
      <p style="margin:6px 0">${esc(o.descricao)}</p>${o.resposta ? `<p style="margin:0 0 6px"><b>Resposta:</b> ${esc(o.resposta)}</p>` : ''}
      <div class="tags"><span class="tag ${o.status === 'resolvida' ? 'vd' : 'am'}">${esc(o.status.replace('_', ' '))}</span>${o.pedido_id ? `<a class="tag" href="#pedido/${o.pedido_id}">ver pedido</a>` : ''}</div>
      ${o.status !== 'resolvida' ? `<div class="acoes" style="grid-template-columns:1fr 1fr"><button class="btn fant peq" data-oc="${o.id}" data-st="em_analise">Em análise</button>
        <button class="btn peq" data-oc="${o.id}" data-st="resolvida">Resolver</button></div>` : ''}</div>`).join('') : '<div class="vazio">Nenhuma ocorrência registrada.</div>';
  } else if (aba === 'lista') {
    dados = ok(await sb.from('gf_lista_espera').select('*').order('criado_em', { ascending: false }).limit(1000));
    html += `<button class="btn sec full" id="btCsv">Baixar CSV</button><div class="rolar"><table><thead><tr><th>Nome</th><th>Perfil</th><th>Cidade</th><th>WhatsApp</th><th>Equip./rota</th><th>Data</th></tr></thead><tbody>
      ${dados.map(l => `<tr><td>${esc(l.nome)}</td><td>${esc(l.perfil)}</td><td>${esc(l.cidade)}</td><td><a target="_blank" rel="noopener" href="${linkZap(l.whatsapp, `Olá ${l.nome}! Aqui é do GF (Guincho Fácil).`)}">${esc(mascaraZap(l.whatsapp.replace(/^55/, '')))}</a></td>
      <td>${esc([l.equipamento, l.rota].filter(Boolean).join(' · '))}</td><td>${dataHora(l.criado_em)}</td></tr>`).join('')}</tbody></table></div>
      ${dados.length ? '' : '<div class="vazio">Lista de espera vazia.</div>'}`;
  }
  V.innerHTML = html;
  ligaChips('adm', v => location.hash = 'admin/' + v);
  ligaChips('quem', v => { S.filtros.adm.quem = v; rota(); });
  ligaChips('pst', v => { S.filtros.admPed.st = v; rota(); });
  if ($('#btCsv')) $('#btCsv').onclick = () => csv(dados.map(x => { const { g, autor, prestador, ...r } = x; return { ...r, ...(g ? { guincheiro: g.nome } : {}), ...(autor ? { cliente: autor.nome } : {}), ...(prestador ? { prestador: prestador.nome } : {}) }; }), aba);
  V.querySelectorAll('[data-apr]').forEach(b => b.onclick = async () => {
    const st = b.dataset.st;
    const r = await perguntar({ titulo: { aprovado: 'Aprovar este guincheiro?', recusado: 'Recusar cadastro?', bloqueado: 'Bloquear usuário?' }[st],
      texto: st === 'aprovado' ? 'Ele passa a ver pedidos e mandar propostas.' : 'O usuário vê o motivo no app.',
      campo: st === 'aprovado' ? null : { label: 'Motivo', obrigatorio: true }, ok: 'Confirmar', perigo: st !== 'aprovado' });
    if (r == null) return;
    try { await rpc('gf_admin_aprovar', { p_perfil: b.dataset.apr, p_aprovacao: st, p_obs: r === true ? null : r }); toast('Cadastro atualizado.'); rota(); }
    catch (er) { falha(er); }
  });
  V.querySelectorAll('[data-canc]').forEach(b => b.onclick = async () => {
    const m = await perguntar({ titulo: 'Cancelar pedido como administração?', campo: { label: 'Motivo (cliente e guincheiro veem)', obrigatorio: true }, ok: 'Cancelar pedido', perigo: true });
    if (!m) return;
    try { await rpc('gf_cancelar_pedido', { p_pedido: b.dataset.canc, p_motivo: m }); toast('Pedido cancelado.'); rota(); } catch (er) { falha(er); }
  });
  V.querySelectorAll('[data-oc]').forEach(b => b.onclick = async () => {
    const st = b.dataset.st;
    const r = await perguntar({ titulo: st === 'resolvida' ? 'Resolver ocorrência' : 'Marcar em análise', campo: { label: 'Resposta para o usuário', obrigatorio: st === 'resolvida' }, ok: 'Salvar' });
    if (r == null) return;
    try { await rpc('gf_admin_tratar_ocorrencia', { p_id: b.dataset.oc, p_status: st, p_resposta: r }); toast('Ocorrência atualizada.'); rota(); } catch (er) { falha(er); }
  });
}

// ───────────────────────── instalação (PWA) ─────────────────────────
let promptInst = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInst = e; document.querySelectorAll('.instalar').forEach(x => x.hidden = false); });
const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
function blocoInstalar() {
  if (instalado()) return '';
  return `<div class="aviso instalar" ${promptInst || ios() ? '' : 'hidden'}><b>Instale o GF no celular.</b> Fica com ícone na tela e abre em tela cheia.
    <button class="btn full" style="margin-top:10px" data-inst>Instalar</button></div>`;
}
function ligaInstalar() { V.querySelectorAll('[data-inst]').forEach(b => b.onclick = instalar); }
async function instalar() {
  if (instalado()) return toast('O GF já está instalado.');
  if (promptInst) { promptInst.prompt(); await promptInst.userChoice; promptInst = null; return; }
  if (ios()) return perguntar({ titulo: 'Instalar no iPhone', texto: 'Toque em Compartilhar (quadrado com seta) e depois em “Adicionar à Tela de Início”.', ok: 'Entendi' });
  toast('Abra o menu do navegador (⋮) e toque em “Instalar app” ou “Adicionar à tela inicial”.');
}

// ───────────────────────── sessão ─────────────────────────
async function carregaPerfil() {
  try { S.perfil = await rpc('gf_meu_perfil'); }
  catch (e) { S.perfil = null; throw e; }
  if (S.perfil) montaNav();
}
$('#btSair').onclick = async () => { await sb.auth.signOut(); S.perfil = null; location.hash = ''; };
sb.auth.onAuthStateChange((ev, session) => {
  setTimeout(async () => {
    if (ev === 'PASSWORD_RECOVERY') S.recuperandoSenha = true;
    const novo = session?.user || null; const mudou = (novo?.id || null) !== (S.user?.id || null);
    S.user = novo;
    if (!S.user) { S.perfil = null; $('#nav').hidden = true; return rota(); }
    if (mudou || ev === 'INITIAL_SESSION') {
      try { await carregaPerfil(); rota(); contadores(); } catch (e) { telaErro(e); }
    }
  }, 0);
});
setInterval(contadores, 45000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[GF] service worker', e));
