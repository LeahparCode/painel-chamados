# Painel de Disparos

Painel operacional de disparos (Flask + Airtable), com atualização em tempo real via SSE.

## Estrutura

```
backend/
├── app.py                     # API Flask (Airtable, SSE)
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
AIRTABLE_TOKEN=... AIRTABLE_BASE_ID=... python backend/app.py
```

> O login foi removido temporariamente — todas as rotas de escrita estão abertas.
