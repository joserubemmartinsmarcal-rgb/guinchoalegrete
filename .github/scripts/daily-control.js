
function validateLabels(requiredLabels, repoLabels) {
  const existingLabelNames = new Set(repoLabels.map(l => (typeof l === 'string' ? l : l.name)));
  return requiredLabels.filter(name => !existingLabelNames.has(name));
}

function findExistingIssue(issues, expectedTitle) {
  const normalizedTitle = expectedTitle.trim().toLowerCase();
  return issues.find(issue => issue.title && issue.title.trim().toLowerCase() === normalizedTitle) || null;
}

function buildIssueBody({ today, assignee }) {
  return `### 📋 Dados do Plantão
- **Data:** ${today}
- **Responsável pelo Plantão:** @${assignee}
- **Guincho(s) e Motorista(s) Escalados:** 

---

### 🚨 Registro de Chamados do Dia
- **Número da OS / Acionamento Allianz:** 
- **Nome do Segurado:** 
- **Veículo / Placa:** 
- **Origem / Destino:** 

### ⏱️ Horários do SLA
- **Acionamento:** 
- **Saída Base:** 
- **Previsão Informada:** 
- **Chegada Local:** 
- **Conclusão/Entrega:** 

### 🛣️ Quilometragem (KM)
- **KM Saída / Chegada / Destino / Retorno:** 
- **KM Total:** 
- **KM Autorizada Allianz:** 
- **KM Excedente:** 

### 💳 Pedágios e Despesas
- **Total Pedágios (R$):** 
- **Comprovantes:** (anexar fotos/recibos)

### 📷 Vistoria e Fotos
- [ ] Fotos do veículo (frente, traseira, placa)
- [ ] Veículo embarcado
- [ ] Local de entrega
- [ ] Comprovante assinado

---
### 💵 Fechamento Financeiro
- [ ] Lançado no sistema
- [ ] Pronto para faturamento`;
}

async function runDailyControl({ github, context, core, today, assignee, requiredLabels = ['operacao-urgente', 'financeiro-km', 'allianz-sla'] }) {
  const expectedTitle = `Controle Diário - Allianz [${today}]`;

  // 1. Validação de labels
  const { data: repoLabels } = await github.rest.issues.listLabelsForRepo({
    owner: context.repo.owner,
    repo: context.repo.repo,
    per_page: 100
  });

  const missingLabels = validateLabels(requiredLabels, repoLabels);
  if (missingLabels.length > 0) {
    const errorMsg = `Erro de validação: As seguintes labels não existem no repositório: ${missingLabels.join(', ')}. Crie as labels antes de executar.`;
    core.setFailed(errorMsg);
    return { status: 'failed_missing_labels', missingLabels, errorMsg };
  }

  // 2. Prevenção de duplicidade (verifica issues abertas e fechadas)
  const { data: issues } = await github.rest.issues.listForRepo({
    owner: context.repo.owner,
    repo: context.repo.repo,
    state: 'all',
    per_page: 100
  });

  const existing = findExistingIssue(issues, expectedTitle);
  if (existing) {
    const noticeMsg = `A issue para a data ${today} já existe (${existing.state}): #${existing.number} (${existing.html_url}). Nenhuma nova issue criada.`;
    core.notice(noticeMsg);
    return { status: 'skipped_duplicate', existingIssue: existing, noticeMsg };
  }

  // 3. Criação da issue
  const body = buildIssueBody({ today, assignee });
  const created = await github.rest.issues.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    title: expectedTitle,
    body: body,
    assignees: [assignee],
    labels: requiredLabels
  });

  core.info(`Issue criada com sucesso: #${created.data.number}`);
  return { status: 'created', issue: created.data };
}

module.exports = {
  validateLabels,
  findExistingIssue,
  buildIssueBody,
  runDailyControl
};
