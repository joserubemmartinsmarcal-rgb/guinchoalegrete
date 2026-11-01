# Ordens de Serviço — JM Transportes

Página `os.html` para controlar as ordens de serviço da JM, com o mesmo visual do site
https://jmautossocorro.vercel.app (fundo escuro, prata/azul-aço, fontes Barlow Condensed e Inter).

Baseada no app OS Guincho (os-guincho.vercel.app): mesmos campos de OS (data/hora, tipo de serviço,
cliente, veículo, origem/destino, motorista, caminhão, km, valor, forma de pagamento, status, observações),
mais: protocolo/sinistro, despesas (combustível, pedágio, repasse, outras), lucro, recebido/a receber e vencimento.

## Telas
- **Painel**: OS abertas hoje, em andamento, concluídas e faturado no mês.
- **Ordens de Serviço**: lista por mês, filtros por status/serviço, busca por placa, cliente, cidade.
- **Controle mensal**: faturamento, despesas, lucro, recebido, a receber, gráfico por dia e totais por
  serviço, cliente, forma de pagamento e motorista. Exporta para Excel (CSV) e imprime/PDF.
- **Clientes, Motoristas, Veículos**: cadastros.
- **Backup**: baixar/restaurar os dados (.json) e exportar todas as OS.
- Cada OS pode ser impressa com o cabeçalho da JM (nome, CNPJ, contato) e espaço para assinatura.

## Como colocar no site
Copie `os.html` para a pasta do site (ao lado de `index.html`, `jm.css` e `assets/`) e publique.
Fica em `https://jmautossocorro.vercel.app/os.html`. A página tem `noindex` (não aparece no Google).

## Onde ficam os dados
No navegador do aparelho (localStorage, chave `jm-os-v1`). Use **Backup** para levar os dados para
outro aparelho ou guardar uma cópia.
