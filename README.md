# Finanças a Dois

Sistema de controle financeiro conjunto para casal: renda somada, gastos identificados por pessoa, saldo que rola automaticamente de mês em mês, limite de cartão de crédito, e um registro de auditoria mostrando quem alterou o quê e quando.

## Por que a arquitetura mudou um pouco em relação ao que você pediu

Você pediu Netlify CMS + GitHub Pages. Isso não dá certo aqui, e vale explicar o porquê antes de você subir o projeto:

- **GitHub Pages só serve arquivos estáticos.** Ele não roda login, não roda banco de dados, não roda nada em servidor. Um sistema com autenticação e log de auditoria precisa de backend.
- **Netlify CMS (hoje chamado Decap CMS)** é um editor de conteúdo baseado em Git (bom para blog, não para lançamentos financeiros com múltiplos usuários escrevendo ao mesmo tempo e login de verdade).

O que fiz no lugar, mantendo tudo "simples, só para vocês dois":

- **Front-end**: HTML/CSS/JS puro (sem framework), responsivo, com navbar flutuante — exatamente como pedido.
- **Backend**: [Netlify Functions](https://docs.netlify.com/functions/overview/) (serverless, JavaScript) para login, CRUD de lançamentos e log de auditoria.
- **Banco de dados**: [Netlify Blobs](https://docs.netlify.com/blobs/overview/) — armazenamento chave-valor embutido na própria Netlify. Não é Supabase, não é Firebase, não exige cadastro em outro serviço, e já vem habilitado em qualquer site Netlify.
- **Hospedagem**: tudo (front-end + funções) roda direto na Netlify, conectada ao seu repositório do GitHub. Você continua subindo o código no GitHub normalmente — só a hospedagem final é na Netlify, não no GitHub Pages.

## Estrutura do projeto

```
financas-casal/
├── index.html
├── css/styles.css
├── js/
│   ├── utils.js        formatação e cálculo do saldo acumulado
│   ├── api.js           chamadas às funções serverless
│   ├── auth.js           sessão/login no navegador
│   ├── charts.js        gráficos (Chart.js)
│   └── app.js            toda a interface e lógica da aplicação
├── netlify/functions/
│   ├── auth.js            login (verifica usuário/senha, emite token)
│   ├── transactions.js    CRUD de lançamentos + grava auditoria
│   ├── settings.js        limite do cartão, categorias, pessoas
│   ├── audit.js           leitura do histórico de alterações
│   └── _shared/           helpers de storage e verificação de token
├── scripts/gerar-hash.js  gera hash de senha localmente
├── netlify.toml
├── package.json
└── .env.example
```

## Como o saldo acumulado funciona

Não existe um campo "saldo do mês anterior" guardado à mão. O sistema soma todos os lançamentos, agrupa por mês, e calcula em cascata: o saldo final de janeiro vira o saldo inicial de fevereiro, e assim por diante — para sempre, sem limite de meses ou anos. Está em `js/utils.js`, função `buildMonthlySummary`.

## Categorias já vêm prontas para a sua situação

Como você é servidor público e ela é CLT, as categorias de receita já incluem **13º Salário**, **Férias +1/3**, **Renda Extra** e **Dívida de Terceiros (recebida)** — você pode editar essa lista direto no arquivo `netlify/functions/settings.js` (array `categories`) se quiser ajustar nomes.

## Passo a passo para colocar no ar

### 1. Suba o código no GitHub

```bash
cd financas-casal
git init
git add .
git commit -m "Sistema financeiro do casal"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/financas-casal.git
git push -u origin main
```

### 2. Gere os hashes de senha

Localmente, com Node.js instalado:

```bash
npm install
npm run gerar-hash -- "senhaDoJobs"
npm run gerar-hash -- "senhaDaSuaNamorada"
```

Guarde os dois hashes gerados — eles vão para as variáveis de ambiente, nunca para o código.

### 3. Crie o site na Netlify

1. Acesse [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**.
2. Escolha o repositório `financas-casal` no GitHub.
3. Build command: deixe em branco. Publish directory: `.` (já configurado em `netlify.toml`, então a Netlify detecta sozinha).
4. Antes de clicar em "Deploy", vá em **Site settings → Environment variables** e cadastre:

| Variável | Valor |
|---|---|
| `JWT_SECRET` | uma string aleatória longa (gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `USER1_NAME` | o usuário de login dele, ex. `jobs` |
| `USER1_PASS_HASH` | hash gerado no passo 2 |
| `USER1_ROLE` | `Servidor Público` |
| `USER2_NAME` | o usuário de login dela |
| `USER2_PASS_HASH` | hash gerado no passo 2 |
| `USER2_ROLE` | `CLT` |

5. Faça o deploy. O Netlify Blobs já funciona automaticamente, sem configuração extra.

### 4. Primeiro acesso

Entre com o usuário/senha de qualquer um dos dois. Vá em **Ajustes** e preencha os nomes reais, o vínculo (Servidor Público / CLT) e a cor de cada pessoa — isso alimenta os gráficos e os rótulos "quem pagou".

## Testando localmente (opcional)

```bash
npm install -g netlify-cli
npm install
netlify dev
```

Isso sobe o front-end e as funções juntos em `localhost:8888`, usando as variáveis do seu `.env` local.

## Limitações que valem a pena conhecer

- **Sincronização quase em tempo real, não instantânea.** O app atualiza os dados a cada 25 segundos automaticamente e sempre que você salva algo. Não é um WebSocket ao vivo — para uso de casal isso é imperceptível na prática, mas é bom saber.
- **Login simples para 2 pessoas.** Não há recuperação de senha por e-mail nem cadastro de novos usuários pela interface — de propósito, para manter simples. Trocar senha = gerar novo hash e atualizar a variável de ambiente na Netlify.
- **Netlify Blobs não é um banco relacional.** Para o volume de dados de um casal (algumas centenas de lançamentos por ano) isso é mais que suficiente e gratuito no plano free da Netlify.
