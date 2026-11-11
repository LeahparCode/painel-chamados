# Painel de Disparos

Painel operacional de disparos (Flask + Google Planilhas), com atualização em tempo real via SSE.
O Airtable continua disponível como alternativa (`DATA_BACKEND=airtable`).

## Estrutura

```
backend/
├── app.py                     # API Flask (rotas, validação, SSE)
├── storage/                   # camada de dados
│   ├── sheets_store.py        # Google Planilhas
│   └── airtable_store.py      # Airtable
├── requirements.txt
├── templates/
│   └── index.html             # apenas a marcação das telas
└── static/
    ├── css/
    │   ├── tokens.css         # cores, sombras, raios (tema claro/escuro)
    │   ├── base.css           # reset e elementos globais
    │   ├── layout.css         # sidebar, área principal, responsivo
    │   ├── components.css     # botões, campos, métricas, modais, toasts
    │   ├── board.css          # painel por dias
    │   ├── dashboard.css      # KPIs e gráficos
    │   └── frases.css         # biblioteca de frases
    └── js/
        ├── main.js            # ponto de entrada
        ├── data/
        │   └── frases-safra.js  # fraseologia Safra (68 frases)
        ├── core/              # regras e infraestrutura
        │   ├── config.js      # listas fixas, custos por tipo
        │   ├── dates.js       # utilitários de data
        │   ├── format.js      # moeda, números, tempo
        │   ├── records.js     # cálculos (valor, status, escopo da visão)
        │   ├── frases.js      # acesso às frases
        │   ├── state.js       # estado central + eventos
        │   ├── api.js         # REST, SSE, cache local
        │   └── actions.js     # criar/editar/excluir (otimista)
        ├── ui/                # toast, tema, modal, relógio
        └── views/             # painel, quadro, detalhes, novo disparo, dashboard, frases
```

## Regras do painel

- O quadro mostra **dias** (colunas). Cada dia exibe a quantidade de disparos, o valor e a barra de status.
- As métricas (valor, em andamento, finalizados, insucessos) são calculadas **do dia** por padrão e
  acompanham a virada do dia automaticamente. O escopo só muda quando alguém troca a visão
  (Dia / Semana / Mês / Período).
- Arraste um card para outro dia para remarcar; clique no cabeçalho de um dia para focá-lo.

## Rodando localmente

```bash
pip install -r backend/requirements.txt
DATA_BACKEND=sheets GOOGLE_SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_JSON="$(cat chave.json)" python backend/app.py
```

## Google Planilhas

- Crie uma conta de serviço no Google Cloud (com a **Google Sheets API** ativada) e baixe a chave JSON.
- Compartilhe a planilha com o e-mail da conta de serviço como **Editor**.
- A aba `Disparos` e o cabeçalho são criados automaticamente se não existirem. Colunas:
  `ID, Tipo, Tempo, Potes, Volume, Horário, Status, Template, AtualizadoEm, Data, Tags, Tipo Disparo`.
- As colunas são localizadas pelo nome, então podem ser reordenadas. **Não apague nem renomeie a coluna `ID`.**
- Linhas digitadas à mão sem ID recebem um ID automaticamente.
- Datas: `AAAA-MM-DD` ou `dd/mm/aaaa`. O painel atualiza a cada ~10 s (`SNAPSHOT_TTL`).

## Deploy (Render)

O deploy é feito no [Render](https://render.com) usando o `Dockerfile` e o blueprint `render.yaml`.

1. No Render: **New → Blueprint** e selecione este repositório.
2. Informe `GOOGLE_SHEET_ID` e `GOOGLE_SERVICE_ACCOUNT_JSON` quando forem pedidos.
3. A cada push na branch configurada o Render faz o deploy automaticamente (`autoDeploy`).

Plano e região ficam no `render.yaml` (`plan: free` dorme após ~15 min sem acesso; use `starter` para ficar sempre ligado).

> O login foi removido temporariamente — todas as rotas de escrita estão abertas.
