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
  `ID, Tipo, Tempo, Potes, Volume, Horário, Status, Template, AtualizadoEm, Data, Tipo Disparo`.
- `Tipo Disparo` define o valor de cada envio: **SMS R$ 0,070 · RCS R$ 0,070 · WhatsApp R$ 0,12**
  (tabela `PRECO_POR_TIPO` em `backend/app.py`; os preços só são enviados a quem está logado).
- As colunas são localizadas pelo nome, então podem ser reordenadas. **Não apague nem renomeie a coluna `ID`.**
- Linhas digitadas à mão sem ID recebem um ID automaticamente.
- Templates próprios ficam na aba `Templates` (criada automaticamente), com as colunas
  `ID, Nome, Tipo, Texto, AtualizadoEm`. Podem ser escritos pelo painel (tela **Frases**) e
  aparecem no cadastro de disparos conforme o tipo escolhido.
- Datas: `AAAA-MM-DD` ou `dd/mm/aaaa`. O painel atualiza a cada ~10 s (`SNAPSHOT_TTL`).

## Instâncias (um painel por cliente)

- Cada instância tem os seus **disparos, templates e cores**, em abas próprias da mesma planilha.
  O cadastro fica na aba `Instancias` (criada automaticamente).
- Na primeira execução é criada a instância **Safra** (Azul e dourado, modelo Safra)
  usando as abas que já existiam (`Disparos` e `Templates`) — nada é migrado. Quem já usava o painel
  ganha acesso a ela.
- Instâncias novas ganham as abas `Disparos - <slug>` e `Templates - <slug>`. O tema padrão é **Azul e branco**.
- **Modelo Safra:** mostra a fraseologia Safra e a marca d'água. **Padrão:** só templates próprios.
- Quem vê o quê: **administradores** veem e editam todas; **operadores** só as marcadas no cadastro
  de usuários (nenhuma outra aparece para eles).
  Contas **aguardando liberação** não veem nada: só a mensagem "Conta criada com sucesso, aguarde um
  administrador liberar o acesso".
- Endereço de cada instância: `?i=<slug>` (ex.: `?i=safra`). Trocar de instância: seletor na barra lateral.
- Excluir uma instância só a tira do cadastro: as abas com os dados continuam na planilha.
- `GOOGLE_INSTANCES_TAB` muda o nome da aba de cadastro (padrão `Instancias`). Instâncias exigem Google Planilhas.

## Importar calendário de ações

Na tela **Importar/Exportar**, aba **Importar** (atalho: `#importar`), envie o `.json` exportado da ferramenta de
calendário (formato `segs[].actionsByDate`). O painel mostra uma prévia e só grava ao confirmar.
Cada ação vira um disparo (data e canal do calendário; texto completo em **Observações**; horário 08:00).
Status pela data: antes de hoje = **Finalizado**; hoje = **Em andamento** com 10 minutos para finalizar;
dias futuros = **Programado**. Reimportar também corrige ações já importadas que ainda estão "Em andamento"
(nunca altera o que foi mudado à mão). Cada ação guarda a origem na coluna `Ref`, então reimportar não duplica.
Canais: SMS, RCS, WhatsApp e E-mail (E-mail sem custo; preço em `PRECO_POR_TIPO`).

## Status automáticos

O servidor ajusta os status sozinho (sem depender de alguém com o painel aberto):
- **Virada do dia:** disparo **Programado** cuja data chegou vira **Em andamento** com timer de
  15 minutos (ou o tempo próprio do disparo, se tiver). Variável `AUTO_START_MINUTES` muda o padrão.
- **Fim do timer:** **Em andamento** com tempo vira **Finalizado** quando o tempo acaba.
- A verificação roda nas leituras do painel (no máximo a cada 30 s). Com o serviço "dormindo",
  a troca acontece no primeiro acesso seguinte e o timer conta a partir dali.

## Proteção

- Código proprietário: veja `LICENSE` (todos os direitos reservados).
- Cabeçalhos de segurança: o painel não pode ser aberto dentro de outro site (`X-Frame-Options`,
  `frame-ancestors`), além de `nosniff`, `Referrer-Policy` e `Permissions-Policy`.
- Aviso de propriedade no console do navegador.
- Mantenha este repositório **privado** no GitHub.

## Login

- **Sem login ninguém vê o painel:** o site abre direto na tela de login (com microvídeos em
  `backend/static/video/`), e o servidor recusa qualquer leitura de dados sem sessão.
- Com login, tudo fica liberado. **Administradores** também gerenciam os usuários (tela **Usuários**);
  **operadores** cadastram, editam e exportam.
- **Criar conta:** qualquer pessoa cria a própria conta (usuário e senha à escolha) na tela de login.
  A conta nasce como **Aguardando liberação** (só visualiza, sem valores) até um administrador
  clicar em **Liberar** ou mudar o cargo na tela **Usuários**. Só administradores mudam cargos.
  - `ALLOW_SIGNUP=0` desliga o "Criar conta".
  - `SIGNUP_ROLE=operador` faz as contas novas já poderem editar (não recomendado).
- Os logins ficam na aba `Usuarios` da planilha (senha guardada só como hash).
- Variáveis de ambiente:
  - `APP_SECRET`: chave que assina a sessão (qualquer texto longo e aleatório). Sem ela, todos
    são deslogados a cada reinício/deploy.
  - `ADMIN_LOGIN` / `ADMIN_PASSWORD` (e opcional `ADMIN_NOME`): criam o primeiro administrador,
    **só quando ainda não existe nenhum administrador ativo**. Depois disso são ignoradas (excluir essa
    conta pelo painel não a recria) e podem ser apagadas do servidor. A senha é trocada pelo próprio painel.

## Deploy (Render)

O deploy é feito no [Render](https://render.com) usando o `Dockerfile` e o blueprint `render.yaml`.

1. No Render: **New → Blueprint** e selecione este repositório.
2. Informe `GOOGLE_SHEET_ID` e `GOOGLE_SERVICE_ACCOUNT_JSON` quando forem pedidos.
3. A cada push na branch configurada o Render faz o deploy automaticamente (`autoDeploy`).

Plano e região ficam no `render.yaml` (`plan: free` dorme após ~15 min sem acesso; use `starter` para ficar sempre ligado).

> O login foi removido temporariamente — todas as rotas de escrita estão abertas.
