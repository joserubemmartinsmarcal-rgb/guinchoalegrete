const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { validateLabels, findExistingIssue, runDailyControl } = require('../.github/scripts/daily-control.js');

function parseWorkflowYaml(content) {
  const lines = content.split('
');
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (let rawLine of lines) {
    const lineWithoutComment = rawLine.replace(/#.*$/, '');
    if (!lineWithoutComment.trim()) continue;

    const indent = lineWithoutComment.search(/\S/);
    const trimmed = lineWithoutComment.trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const current = stack[stack.length - 1].obj;

    if (trimmed.includes(':')) {
      const colonIndex = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIndex).trim();
      const valStr = trimmed.slice(colonIndex + 1).trim();

      if (valStr === '') {
        const newObj = {};
        current[key] = newObj;
        stack.push({ indent, obj: newObj });
      } else {
        let parsedVal = valStr;
        if (valStr === 'true') parsedVal = true;
        else if (valStr === 'false') parsedVal = false;
        else if (!isNaN(Number(valStr)) && valStr !== '') parsedVal = Number(valStr);
        else if ((valStr.startsWith("'") && valStr.endsWith("'")) || (valStr.startsWith('"') && valStr.endsWith('"'))) {
          parsedVal = valStr.slice(1, -1);
        }
        current[key] = parsedVal;
      }
    }
  }
  return root;
}

test('Validação de labels: identifica labels faltantes e interrompe com erro claro', async () => {
  const required = ['operacao-urgente', 'financeiro-km', 'allianz-sla'];
  const repoLabels = [{ name: 'allianz-sla' }];

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

test('Proteção de regressão do workflow: interpreta YAML e valida campos concurrency.group e cancel-in-progress', () => {
  const workflowPath = path.resolve(__dirname, '../.github/workflows/daily-allianz-control.yml');
  const fileContent = fs.readFileSync(workflowPath, 'utf8');
  const parsed = parseWorkflowYaml(fileContent);

  assert.ok(parsed.concurrency, 'O workflow deve possuir o bloco estruturado de concorrência');
  assert.strictEqual(parsed.concurrency.group, 'daily-allianz-control', 'O campo concurrency.group deve ser daily-allianz-control');
  assert.strictEqual(parsed.concurrency['cancel-in-progress'], false, 'O campo concurrency.cancel-in-progress deve ser false para serializar execuções');
});
