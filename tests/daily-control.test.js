const test = require('node:test');
const assert = require('node:assert');
const { validateLabels, findExistingIssue, runDailyControl } = require('../.github/scripts/daily-control.js');

test('Validação de labels: identifica labels faltantes e interrompe com erro claro', async () => {
  const required = ['operacao-urgente', 'financeiro-km', 'allianz-sla'];
  const repoLabels = [{ name: 'allianz-sla' }]; // faltam operacao-urgente e financeiro-km

  const missing = validateLabels(required, repoLabels);
  assert.deepStrictEqual(missing, ['operacao-urgente', 'financeiro-km']);

  let failedMessage = null;
  let issueCreated = false;

  const mockCore = {
    setFailed: (msg) => { failedMessage = msg; },
    notice: () => {},
    info: () => {}
  };

  const mockGithub = {
    rest: {
      issues: {
        listLabelsForRepo: async () => ({ data: repoLabels }),
        listForRepo: async () => ({ data: [] }),
        create: async () => {
          issueCreated = true;
          return { data: { number: 1 } };
        }
      }
    }
  };

  const mockContext = { repo: { owner: 'user', repo: 'repo' } };

  const result = await runDailyControl({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    today: '04/10/2026',
    assignee: 'operador-test',
    requiredLabels: required
  });

  assert.strictEqual(result.status, 'failed_missing_labels');
  assert.ok(failedMessage.includes('operacao-urgente, financeiro-km'));
  assert.strictEqual(issueCreated, false, 'Issue não deve ser criada quando faltam labels');
});

test('Prevenção de duplicidade: detecta issue aberta existente na mesma data e não cria duplicata', async () => {
  const required = ['operacao-urgente', 'financeiro-km', 'allianz-sla'];
  const repoLabels = required.map(name => ({ name }));

  const existingIssues = [
    {
      number: 10,
      title: 'Controle Diário - Allianz [04/10/2026]',
      state: 'open',
      html_url: 'https://github.com/user/repo/issues/10'
    }
  ];

  let noticeMessage = null;
  let issueCreated = false;

  const mockCore = {
    setFailed: () => {},
    notice: (msg) => { noticeMessage = msg; },
    info: () => {}
  };

  const mockGithub = {
    rest: {
      issues: {
        listLabelsForRepo: async () => ({ data: repoLabels }),
        listForRepo: async () => ({ data: existingIssues }),
        create: async () => {
          issueCreated = true;
          return { data: { number: 11 } };
        }
      }
    }
  };

  const result = await runDailyControl({
    github: mockGithub,
    context: { repo: { owner: 'user', repo: 'repo' } },
    core: mockCore,
    today: '04/10/2026',
    assignee: 'operador-test',
    requiredLabels: required
  });

  assert.strictEqual(result.status, 'skipped_duplicate');
  assert.strictEqual(issueCreated, false, 'Não deve criar nova issue se já houver uma aberta');
  assert.ok(noticeMessage.includes('#10'));
  assert.ok(noticeMessage.includes('open'));
});

test('Prevenção de duplicidade: detecta issue FECHADA existente na mesma data e não cria duplicata', async () => {
  const required = ['operacao-urgente', 'financeiro-km', 'allianz-sla'];
  const repoLabels = required.map(name => ({ name }));

  const existingIssues = [
    {
      number: 9,
      title: 'Controle Diário - Allianz [04/10/2026]',
      state: 'closed',
      html_url: 'https://github.com/user/repo/issues/9'
    }
  ];

  let noticeMessage = null;
  let issueCreated = false;

  const mockCore = {
    setFailed: () => {},
    notice: (msg) => { noticeMessage = msg; },
    info: () => {}
  };

  const mockGithub = {
    rest: {
      issues: {
        listLabelsForRepo: async () => ({ data: repoLabels }),
        listForRepo: async () => ({ data: existingIssues }),
        create: async () => {
          issueCreated = true;
          return { data: { number: 11 } };
        }
      }
    }
  };

  const result = await runDailyControl({
    github: mockGithub,
    context: { repo: { owner: 'user', repo: 'repo' } },
    core: mockCore,
    today: '04/10/2026',
    assignee: 'operador-test',
    requiredLabels: required
  });

  assert.strictEqual(result.status, 'skipped_duplicate');
  assert.strictEqual(issueCreated, false, 'Não deve criar nova issue se já houver uma fechada para a data');
  assert.ok(noticeMessage.includes('#9'));
  assert.ok(noticeMessage.includes('closed'));
});

test('Criação com sucesso: quando labels existem e não há issue anterior na data', async () => {
  const required = ['operacao-urgente', 'financeiro-km', 'allianz-sla'];
  const repoLabels = required.map(name => ({ name }));

  let createdPayload = null;

  const mockCore = {
    setFailed: () => {},
    notice: () => {},
    info: () => {}
  };

  const mockGithub = {
    rest: {
      issues: {
        listLabelsForRepo: async () => ({ data: repoLabels }),
        listForRepo: async () => ({ data: [] }),
        create: async (payload) => {
          createdPayload = payload;
          return { data: { number: 12, ...payload } };
        }
      }
    }
  };

  const result = await runDailyControl({
    github: mockGithub,
    context: { repo: { owner: 'user', repo: 'repo' } },
    core: mockCore,
    today: '04/10/2026',
    assignee: 'joserubemmartinsmarcal-rgb',
    requiredLabels: required
  });

  assert.strictEqual(result.status, 'created');
  assert.ok(createdPayload);
  assert.strictEqual(createdPayload.title, 'Controle Diário - Allianz [04/10/2026]');
  assert.deepStrictEqual(createdPayload.assignees, ['joserubemmartinsmarcal-rgb']);
  assert.deepStrictEqual(createdPayload.labels, required);
});

test('Proteção de regressão do workflow: mantém grupo de concorrência e cancel-in-progress desativado', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  const workflowPath = path.resolve(__dirname, '../.github/workflows/daily-allianz-control.yml');
  const content = fs.readFileSync(workflowPath, 'utf8');

  assert.ok(content.includes('concurrency:'), 'O workflow deve declarar a chave concurrency');
  assert.ok(content.includes('group: daily-allianz-control'), 'O grupo de concorrência deve ser daily-allianz-control');
  assert.match(content, /cancel-in-progress:\s*false/, 'cancel-in-progress deve ser false para serializar as execuções');
});

