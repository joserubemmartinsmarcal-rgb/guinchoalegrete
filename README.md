# Guincho Alegrete - Operação Allianz

Rotinas de apoio e controle operacional para acionamentos da seguradora Allianz.

## Testes Automatizados

A suíte de testes valida as regras de abertura de chamados diários, checando:
- Bloqueio quando houver labels obrigatórias ausentes no repositório.
- Prevenção de duplicidade caso já exista uma issue (aberta ou fechada) para a mesma data.
- Criação correta com checklist e atribuição ao responsável pelo plantão.

### Como executar localmente

Certifique-se de estar utilizando Node.js v18 ou superior.

Execute o comando:



Ou diretamente pelo executor nativo do Node.js:


