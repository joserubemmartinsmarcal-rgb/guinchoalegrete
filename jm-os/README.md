# JM Serviços — controle de ordens de serviço da JM Transportes

App de uma página só (`os.html`) para celular e computador, com o layout de apps de gestão de guincho
(barra inferior, menu lateral, abas e cartões) e as cores do site https://jmautossocorro.vercel.app
(grafite #171C23, aço #344B63, prata #C0C8D0). Tem modo escuro (padrão) e claro.

## Telas
- **Dashboard**: acionamentos ativos, serviços de hoje, faturamento e lucro do mês, a receber, notas a vencer.
- **Serviços** (abas):
  - *Dashboard*: serviços do mês, faturamento, serviços sem valor, pagamentos pendentes, serviços sem
    fechamento de lote, top faturamento por cliente / colaboradores / contratados / agregados e consulta por motorista.
  - *Serviços*: filtros por nome, placa, protocolo, mês, motorista, status e tipo; seleção múltipla para criar
    lote ou marcar recebido; exportar Excel.
  - *Lotes*: agrupa serviços não pagos por cliente para emitir a nota; “Sincronizar” atualiza o lote para
    Faturado/Pago conforme a nota.
  - *Notas Fiscais*: notas pendentes, total a receber e pago (líquido de retenções), filtros por período e status.
- **Acionamentos**: chamados em andamento em Cards, Lista ou Kanban (Tela TV), contadores do dia, motoristas
  disponíveis, mapa, envio dos dados ao motorista e aviso ao segurado pelo WhatsApp. Ao concluir, gera o serviço.
- **Checklists**: vistoria de coleta/entrega com itens, combustível, km, avarias e fotos; impressão.
- **Perfil**: dados da empresa (saem nas impressões), tema e som.
- Menu lateral: clientes/assistências, colaboradores e motoristas (próprio, contratado, agregado), caminhões,
  itens do checklist, relatório mensal, relatório de agregados (repasses), exportar dados e backup.

## Pedidos pelo site
`solicitar.html` é a página pública para clientes pedirem atendimento (nome, telefone, serviço, veículo, local com GPS,
destino, ocorrido). O pedido é gravado na tabela `jm_solicitacoes` do Supabase (projeto central-24h-jm) — o público só
consegue inserir. O app lê os pedidos pelas funções `jm_solicitacoes_listar` / `jm_solicitacoes_marcar`, que exigem a
chave secreta salva em **Perfil → Pedidos do site** (fica só no aparelho). Os pedidos aparecem no topo de
**Acionamentos**, com som e aviso no sino; **Aceitar** abre o acionamento já preenchido.

## Importar PDF da assistência
Em **Novo Acionamento** e **Novo Serviço** há o botão *Importar PDF da assistência*. O PDF é lido no próprio aparelho
(pdf.js) e o sistema procura protocolo, segurado, telefone, veículo, placa, cor, origem, destino, valor, km, data e a
assistência (cadastra automaticamente se for nova). PDF escaneado (imagem) não tem texto e não é lido.

## Como colocar no site
Copie `os.html` para a pasta do site (ao lado de `index.html`) e publique: `https://jmautossocorro.vercel.app/os.html`.
A página tem `noindex`.

## Dados
Ficam no navegador do aparelho (localStorage, chave `jm-app-v2`; dados da versão anterior `jm-os-v1` são migrados
automaticamente). Use **Exportar Dados → Backup** para guardar ou levar para outro aparelho.
