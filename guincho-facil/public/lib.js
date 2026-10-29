// Regras de apresentação e validação compartilhadas pelo app e pelos testes.
// As regras de negócio valem no servidor (Supabase); aqui elas só são
// espelhadas para orientar a interface e validar antes de enviar.
(function (root) {
  const STATUS = {
    aberto: 'Aguardando propostas', aceito: 'Guincheiro escolhido', a_caminho: 'Guincheiro a caminho',
    no_local: 'Guincheiro no local', em_transporte: 'Veículo em transporte', concluido: 'Concluído', cancelado: 'Cancelado'
  };
  const ETAPAS = ['aberto', 'aceito', 'a_caminho', 'no_local', 'em_transporte', 'concluido'];
  const ATIVOS = ['aceito', 'a_caminho', 'no_local', 'em_transporte'];
  const PROXIMO = { aceito: 'a_caminho', a_caminho: 'no_local', no_local: 'em_transporte', em_transporte: 'concluido' };
  const ACAO_PRESTADOR = {
    aceito: 'Saí para o atendimento', a_caminho: 'Cheguei no local',
    no_local: 'Veículo carregado, saindo', em_transporte: 'Entreguei o veículo'
  };
  const CONDICAO = { anda: 'Anda', nao_anda: 'Não anda', acidentado: 'Acidentado' };
  const VEICULO = { carro: 'Carro', moto: 'Moto', utilitario: 'Utilitário', caminhonete: 'Caminhonete', caminhao: 'Caminhão', outro: 'Outro' };
  const EQUIPAMENTOS = ['Plataforma', 'Asa-delta', 'Guincho pesado', 'Mais de um'];
  const CAPACIDADE = { leve: 'Leve (até 3,5 t)', utilitario: 'Utilitário (até 5 t)', pesado: 'Pesado (até 12 t)', extra_pesado: 'Extra pesado (acima de 12 t)' };
  const APROVACAO = { pendente: 'Em análise', aprovado: 'Aprovado', recusado: 'Recusado', bloqueado: 'Bloqueado' };
  const OCORRENCIA = { servico: 'Problema no serviço', cobranca: 'Valor / cobrança', cadastro: 'Cadastro', seguranca: 'Segurança', outro: 'Outro' };

  // espelho de public.gf_transicao_valida
  function transicaoValida(atual, novo, papel) {
    if (papel === 'prestador') return PROXIMO[atual] === novo;
    if (papel === 'cliente') return atual === 'em_transporte' && novo === 'concluido';
    return false;
  }
  const etapaIndice = s => ETAPAS.indexOf(s);
  const soNum = s => String(s ?? '').replace(/\D/g, '');
  const zapValido = s => /^\d{10,13}$/.test(soNum(s));
  function mascaraZap(v) {
    const d = soNum(v).slice(0, 11);
    return d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
  }
  function linkZap(numero, mensagem) {
    let n = soNum(numero); if (n.length <= 11) n = '55' + n;
    return `https://wa.me/${n}?text=${encodeURIComponent(mensagem || '')}`;
  }
  const placaNormal = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const placaValida = s => { const p = placaNormal(s); return p === '' || /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p); };
  // "1.234,56" | "1234.56" | "450" → número
  function valorDigitado(s) {
    let t = String(s ?? '').trim().replace(/[R$\s]/g, '');
    if (!t) return NaN;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  const brl = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/Sao_Paulo';
  const dataHora = s => s ? new Date(s).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const dataCurta = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: TZ }) : 'Sem data definida';
  function dentroDoPeriodo(iso, dias, agora = Date.now()) {
    if (!dias) return true;
    return new Date(iso).getTime() >= agora - dias * 864e5;
  }
  // soma de valores combinados em serviços concluídos (não é pagamento processado)
  function totalRegistrado(pedidos) {
    return pedidos.filter(p => p.status === 'concluido' && p.valor_combinado != null)
      .reduce((s, p) => s + Number(p.valor_combinado), 0);
  }
  // progresso do cadastro do guincheiro (ideia: barra de completude)
  function progressoCadastro(p) {
    if (!p) return { itens: [], pct: 0 };
    const itens = [
      { id: 'contato', nome: 'Nome, cidade e WhatsApp', ok: !!(p.nome && p.cidade && p.whatsapp) },
      { id: 'veiculo', nome: 'Veículo de trabalho (equipamento e placa)', ok: !!(p.equipamento && p.placa) },
      { id: 'capacidade', nome: 'Capacidade de carga', ok: !!p.capacidade },
      { id: 'area', nome: 'Área de atuação (raio)', ok: !!p.raio_km },
      { id: 'aprovacao', nome: 'Aprovação da equipe GF', ok: p.aprovacao === 'aprovado' }
    ];
    return { itens, pct: Math.round(100 * itens.filter(i => i.ok).length / itens.length) };
  }

  // "Quanto realmente sobra?": estimativa simples de resultado de um serviço.
  // Combustível = km ÷ consumo × preço; manutenção = km × custo por km; impostos = % do valor.
  function calcularResultado(e) {
    const n = x => { const v = typeof x === 'number' ? x : valorDigitado(x); return Number.isFinite(v) && v > 0 ? v : 0; };
    const c = v => Math.round(v * 100) / 100;
    const valor = n(e.valor), km = n(e.km), consumo = n(e.consumo);
    const combustivel = km && consumo ? km / consumo * n(e.diesel) : 0;
    const manutencao = km * n(e.manutencaoKm);
    const impostos = valor * Math.min(n(e.impostosPct), 100) / 100;
    const pedagios = n(e.pedagios), outros = n(e.outros);
    const custos = combustivel + manutencao + impostos + pedagios + outros;
    const resultado = valor - custos;
    return { receita: c(valor), combustivel: c(combustivel), manutencao: c(manutencao), impostos: c(impostos), pedagios: c(pedagios),
      outros: c(outros), custos: c(custos), resultado: c(resultado),
      margem: valor ? Math.round(resultado / valor * 1000) / 10 : null, porKm: km ? c(resultado / km) : null };
  }

  const GF = { STATUS, calcularResultado, ETAPAS, ATIVOS, PROXIMO, ACAO_PRESTADOR, CONDICAO, VEICULO, EQUIPAMENTOS, CAPACIDADE, APROVACAO, OCORRENCIA,
    transicaoValida, etapaIndice, soNum, zapValido, mascaraZap, linkZap, placaNormal, placaValida, valorDigitado, brl, esc,
    dataHora, dataCurta, dentroDoPeriodo, totalRegistrado, progressoCadastro };
  root.GF = GF;
  if (typeof module === 'object' && module.exports) module.exports = GF;
})(typeof window !== 'undefined' ? window : globalThis);
