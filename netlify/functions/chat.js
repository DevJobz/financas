import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { readJSON, writeJSON } from './_shared/blobStore.js';
import { verifyToken, cors } from './_shared/authMiddleware.js';
import { buildMonthlySummary, getCardsUsage, monthKey } from './_shared/financeEngine.js';

const STORE = 'financas';
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const CONTEXT_LIMIT = parseInt(process.env.CHAT_CONTEXT_LIMIT || '100', 10);

// Campos que podem ser propagados em cascata para todas as parcelas de um grupo.
// Igual ao que o transactions.js real permite no updateGroup — NUNCA inclui date nem status,
// porque cada parcela tem sua própria data de vencimento e seu próprio status de pagamento.
const GROUP_CASCADE_FIELDS = ['category', 'description', 'amount', 'paidBy', 'paymentMethod', 'isThirdParty', 'thirdPartyName', 'thirdPartyDate'];

async function appendAudit(user, action, entity, entityId, before, after) {
  const log = await readJSON(STORE, 'audit.json', []);
  log.unshift({
    id: crypto.randomUUID(), timestamp: new Date().toISOString(),
    userId: user.sub, userName: user.name, action, entity, entityId, before, after,
  });
  await writeJSON(STORE, 'audit.json', log.slice(0, 1000));
}

// ---------- SESSÕES DE CHAT ----------
async function getSessions() {
  return await readJSON(STORE, 'chat_sessions.json', []);
}
async function saveSessions(sessions) {
  await writeJSON(STORE, 'chat_sessions.json', sessions);
}

async function generateTitle(ai, userMsg, aiMsg) {
  try {
    const r = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: `Gere um título curto (3 a 6 palavras, sem aspas, sem ponto final) para esta conversa de um app financeiro de casal, baseado na troca abaixo. Responda APENAS com o título.\n\nUsuário: ${userMsg}\nAssistente: ${String(aiMsg || '').slice(0, 300)}`
    });
    const title = (r.text || '').trim().replace(/^["'“”]+|["'“”]+$/g, '').replace(/\.$/, '');
    return title || (userMsg || 'Anexo enviado').slice(0, 40);
  } catch {
    return (userMsg || 'Anexo enviado').slice(0, 40);
  }
}

// ---------- TRAVA REAL DE CONFIRMAÇÃO PARA EXCLUSÕES ----------
async function getPendingDeletions() {
  const list = await readJSON(STORE, 'pending_deletions.json', []);
  return list.filter(p => p.expiresAt > Date.now());
}
async function requestDeletionCode(entity, id, preview, extra = {}) {
  const pending = await getPendingDeletions();
  const filtered = pending.filter(p => !(p.entity === entity && p.id === id));
  const codigo = String(crypto.randomInt(1000, 10000));
  filtered.push({ entity, id, codigo, expiresAt: Date.now() + CONFIRMATION_TTL_MS, ...extra });
  await writeJSON(STORE, 'pending_deletions.json', filtered);
  return {
    aguardandoConfirmacao: true,
    item: preview,
    codigoConfirmacao: codigo,
    instrucao: 'NÃO diga que excluiu nada ainda. Mostre os detalhes do item e peça o código de 4 dígitos. Na confirmação, chame a mesma função de novo passando SOMENTE codigoConfirmacao.'
  };
}
async function resolveDeletionCode(entity, codigoConfirmacao) {
  const pending = await getPendingDeletions();
  const match = pending.find(p => p.entity === entity && p.codigo === String(codigoConfirmacao || ''));
  if (!match) return null;
  await writeJSON(STORE, 'pending_deletions.json', pending.filter(p => p !== match));
  return match;
}

export default async (req) => {
  const headers = cors();
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers });

  const user = verifyToken({ headers: Object.fromEntries(req.headers) });
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401, headers });
  if (req.method !== 'POST') return Response.json({ error: 'Método não permitido' }, { status: 405, headers });

  try {
    const { message, chatId, attachment } = await req.json();

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const sessions = await getSessions();
    let session = chatId ? sessions.find(s => s.id === chatId) : null;
    if (!session) {
      session = {
        id: crypto.randomUUID(), title: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        createdBy: user.sub, messages: []
      };
      sessions.push(session);
    }

    const historyForGemini = session.messages
      .slice(-CONTEXT_LIMIT)
      .map(m => ({ role: m.role, parts: [{ text: m.text }] }));

    const u1 = process.env.USER1_NAME || 'Pessoa 1';
    const u2 = process.env.USER2_NAME || 'Pessoa 2';

    const systemInstruction = `Você é o assistente financeiro e organizador de vida do casal ${u1} e ${u2}.
    Seu papel é analisar os dados financeiros e ajudar na gestão do "Life Hub" (Viagens, Metas, Assinaturas, Mercado e Manutenções).
    REGRA DE OURO 1: Toda exclusão (lançamento, registro do Life Hub, lançamento fixo ou cartão) exige confirmação em duas etapas: 1ª chamada com o id gera um código de 4 dígitos e NÃO exclui nada. 2ª chamada, só com codigoConfirmacao, executa de fato.
    REGRA DE OURO 2: Para viagens, metas, assinaturas, mercado ou manutenções, chame consultarDados (objeto 'diarios_e_listas'). Antes de criar um registro novo, observe o formato de um registro existente do mesmo tipo.
    REGRA DE OURO 3: Sugira proativamente se o casal consegue bater uma Meta cruzando o "Saldo Restante" do mês com o valor faltante.
    REGRA DE OURO 4: Seja claro, analítico, verdadeiro e amigável. Valores sempre em R$.
    REGRA DE OURO 5: Use SEMPRE resumoMensal[chave] para saldo/receitas/despesas de um mês. NUNCA some 'transacoes' brutas por conta própria.
    REGRA DE OURO 6: Para editar um lançamento (inclusive marcar como pago/recebido ou reabrir), use editarLancamento com o id e só os campos que mudaram — inclusive status ('aberto' ou 'ok'). Para marcar VÁRIOS de uma vez, use atualizarStatusEmMassa.
    REGRA DE OURO 7: Para o Life Hub, use criarOuAtualizarRegistro/excluirRegistro com o 'tipo' EXATO: 'goal' (meta), 'trip' (viagem), 'subscription' (assinatura), 'shopping' (lista de mercado) ou 'maintenance' (manutenção) — nomes reais do sistema, nunca traduza. Para a regra de um lançamento fixo recorrente use criarOuAtualizarLancamentoFixo/excluirLancamentoFixo. Para cartões use criarOuAtualizarCartao/excluirCartao.
    REGRA DE OURO 8: Você tem memória desta conversa (até ${CONTEXT_LIMIT} mensagens). Não peça pro usuário repetir o que ele já disse aqui.
    REGRA DE OURO 9: As categorias são separadas por tipo: configuracoes.categories.gasto e configuracoes.categories.receita. Antes de chamar criarLancamento, verifique se tem TODOS os campos com certeza (date, type, category, amount, paidBy, e paymentMethod quando for gasto). Se faltar qualquer coisa ou houver ambiguidade, NÃO invente valores e NÃO chame criarLancamento — chame abrirFormularioLancamento informando em camposConhecidos (JSON) o que você já sabe.
    REGRA DE OURO 10: Se a mensagem começar com "[FORMULARIO_PREENCHIDO]" seguida de um JSON, isso é o resultado do formulário — já contém todos os campos. Chame criarLancamento diretamente com esses valores exatos, sem perguntar mais nada.
    REGRA DE OURO 11: Se o usuário enviar imagem (comprovante, nota, print, foto de lista escrita à mão) ou áudio, interprete o conteúdo para entender o que ele quer e siga as demais regras normalmente.
    REGRA DE OURO 12 (PARCELAS): Lançamentos parcelados compartilham um mesmo 'groupId' e têm 'installmentLabel' (ex: "2/12"). Ao criar um gasto parcelado, use installments em criarLancamento. Ao editar/excluir um lançamento de um grupo, SEMPRE pergunte antes se é só aquela parcela ou todas, e use updateGroup (editarLancamento) ou excluirGrupoTodo (excluirLancamento) conforme a resposta. Ao usar updateGroup, saiba que data e status NUNCA são propagados às outras parcelas — só categoria, descrição, valor, responsável, forma de pagamento e dados de terceiro.
    REGRA DE OURO 13: Para transferir todos os lançamentos de um cartão para outra pessoa, use transferirTitularidadeCartao. Confirme com o usuário antes, dizendo quantos lançamentos serão afetados.
    REGRA DE OURO 14 (LISTAS DE MERCADO): Ao criar uma lista de mercado (tipo 'shopping'), o campo 'title' é o nome do mercado/lista (ex: "Assaí Setembro", "Primeira Compra - Casa Nova") — SEMPRE pergunte esse nome ao usuário se ele não disser, antes de salvar. Se o usuário mandar uma FOTO de uma lista escrita à mão, extraia os nomes dos itens da imagem, pergunte o nome do mercado/lista se não foi dito, mostre a lista extraída pro usuário confirmar, e só então chame criarOuAtualizarRegistro. Se o usuário pedir uma lista sem dizer os itens (ex: "cria uma lista de compras pra gente"), você pode sugerir um rascunho de itens comuns, mas MOSTRE o rascunho e PERGUNTE se pode salvar antes de realmente chamar criarOuAtualizarRegistro — nunca salve uma lista grande e inventada sem confirmação do usuário.`;

    const tools = [{
      functionDeclarations: [
        {
          name: "consultarDados",
          description: "Retorna resumoMensal, transacoes brutas, configuracoes (categories.gasto, categories.receita, people, cards, fixedEntries), diarios_e_listas (Life Hub), usoCartoes e historicoAlteracoes.",
          parameters: {
            type: "OBJECT",
            properties: {
              mesReferencia: { type: "STRING", description: "Mês (AAAA-MM) para uso de cartões. Opcional, padrão é o mês atual." }
            }
          }
        },
        {
          name: "abrirFormularioLancamento",
          description: "Chame quando faltar informação pra registrar um lançamento. Mostra um formulário interativo pro usuário completar. NÃO chame criarLancamento nesse caso.",
          parameters: {
            type: "OBJECT",
            properties: {
              camposConhecidos: { type: "STRING", description: "JSON (texto) com o que você já sabe, ex: {\"amount\":50,\"type\":\"gasto\",\"description\":\"dívida\"}" }
            },
            required: ["camposConhecidos"]
          }
        },
        {
          name: "criarLancamento",
          description: "Cria um lançamento financeiro. Se installments > 1, gera automaticamente as parcelas nos meses seguintes, todas com o mesmo groupId.",
          parameters: {
            type: "OBJECT",
            properties: {
              date: { type: "STRING", description: "YYYY-MM-DD (data da 1ª parcela)" },
              type: { type: "STRING", description: "'gasto' ou 'receita'" },
              category: { type: "STRING", description: "Categoria exata da lista do tipo correspondente" },
              description: { type: "STRING", description: "Descrição curta" },
              amount: { type: "NUMBER", description: "Valor de CADA parcela (não o total)" },
              paidBy: { type: "STRING", description: "ID de quem pagou (u1 ou u2)" },
              paymentMethod: { type: "STRING", description: "dinheiro, debito, pix, transferencia, ou card_<id>. Null se for receita." },
              installments: { type: "NUMBER", description: "Número de parcelas. Omita ou use 1 para lançamento único." },
              isThirdParty: { type: "BOOLEAN", description: "true se for dívida/gasto de terceiro" },
              thirdPartyName: { type: "STRING", description: "Nome do terceiro, se isThirdParty" },
              thirdPartyDate: { type: "STRING", description: "Data combinada com o terceiro (YYYY-MM-DD), se isThirdParty" }
            },
            required: ["date", "type", "category", "amount", "paidBy"]
          }
        },
        {
          name: "editarLancamento",
          description: "Edita um lançamento. Use status para 'ok' (pago/recebido) ou 'aberto' (reabrir). Use updateGroup=true para aplicar categoria/descrição/valor/responsável/forma de pagamento/terceiro em TODAS as parcelas do mesmo grupo (data e status nunca são propagados).",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "ID do lançamento" },
              date: { type: "STRING", description: "opcional" },
              type: { type: "STRING", description: "opcional" },
              category: { type: "STRING", description: "opcional" },
              description: { type: "STRING", description: "opcional" },
              amount: { type: "NUMBER", description: "opcional" },
              paidBy: { type: "STRING", description: "opcional" },
              paymentMethod: { type: "STRING", description: "opcional" },
              status: { type: "STRING", description: "'ok' ou 'aberto', opcional" },
              isThirdParty: { type: "BOOLEAN", description: "opcional" },
              thirdPartyName: { type: "STRING", description: "opcional" },
              thirdPartyDate: { type: "STRING", description: "opcional" },
              updateGroup: { type: "BOOLEAN", description: "true aplica em todas as parcelas do grupo (exceto data/status). Só use depois de perguntar ao usuário." }
            },
            required: ["id"]
          }
        },
        {
          name: "atualizarStatusEmMassa",
          description: "Marca vários lançamentos como 'ok' (pago/recebido) ou 'aberto' (reabrir) de uma só vez. Use quando o usuário pedir algo como 'marca tudo de setembro como pago'.",
          parameters: {
            type: "OBJECT",
            properties: {
              ids: { type: "ARRAY", items: { type: "STRING" }, description: "Lista de IDs dos lançamentos" },
              status: { type: "STRING", description: "'ok' ou 'aberto'" }
            },
            required: ["ids", "status"]
          }
        },
        {
          name: "excluirLancamento",
          description: "1ª chamada: id (gera código). 2ª chamada: só codigoConfirmacao. Use excluirGrupoTodo=true na 1ª chamada para excluir todas as parcelas do grupo.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              excluirGrupoTodo: { type: "BOOLEAN", description: "true exclui todas as parcelas do grupo. Só use depois de perguntar ao usuário." },
              codigoConfirmacao: { type: "STRING" }
            }
          }
        },
        {
          name: "transferirTitularidadeCartao",
          description: "Transfere TODOS os lançamentos de uma forma de pagamento (geralmente um cartão) para outra pessoa. Confirme com o usuário antes.",
          parameters: {
            type: "OBJECT",
            properties: {
              formaPagamento: { type: "STRING", description: "ID da forma de pagamento, ex: card_1" },
              novoDono: { type: "STRING", description: "ID da pessoa que passa a ser dona (u1 ou u2)" }
            },
            required: ["formaPagamento", "novoDono"]
          }
        },
        {
          name: "criarOuAtualizarRegistro",
          description: `Cria/atualiza um registro do Life Hub. O campo 'tipo' deve ser EXATAMENTE um destes valores em inglês (nomes reais do sistema, não traduza):

- 'goal' (Meta do Casal): dados = {"title": string, "target": number, "saved": number}

- 'trip' (Viagem/Roteiro): dados = {"title": string, "date": "AAAA-MM-01", "places": [{"id": "string único, ex: p1", "name": string, "link": string ou "", "estCost": number}]}. Para uma viagem nova sem locais ainda, use "places": [].

- 'subscription' (Assinatura): dados = {"title": string, "cost": number, "cycle": "Mensal" ou "Anual"}

- 'shopping' (Lista de Mercado): dados = {"title": string (nome do mercado/lista, ex: "Assaí Setembro"), "date": "AAAA-MM-DD", "items": [{"id": "string único, ex: i1", "name": string, "qty": number, "price": 0, "checked": false}]}. Cada item precisa ter TODOS esses 5 campos, com "price": 0 e "checked": false por padrão (o casal preenche o preço depois, no mercado).

- 'maintenance' (Manutenção de veículo/casa): dados = {"vehicle": string, "service": string, "km": number, "cost": number, "date": "AAAA-MM-DD"}

Ao atualizar (id preenchido), envie só os campos que mudaram. Para adicionar um item a uma lista de mercado existente ou um local a uma viagem existente, releia o registro via consultarDados, pegue o array atual (items ou places), acrescente o novo item/local mantendo os já existentes, e mande o array completo de volta.`,
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "Vazio para criar novo" },
              tipo: { type: "STRING", description: "'goal', 'trip', 'subscription', 'shopping' ou 'maintenance'" },
              dados: { type: "STRING", description: "JSON (texto) com os campos do tipo escolhido, conforme descrito acima." }
            },
            required: ["tipo", "dados"]
          }
        },
        {
          name: "excluirRegistro",
          description: "1ª chamada: id. 2ª chamada: só codigoConfirmacao.",
          parameters: {
            type: "OBJECT",
            properties: { id: { type: "STRING" }, codigoConfirmacao: { type: "STRING" } }
          }
        },
        {
          name: "criarOuAtualizarLancamentoFixo",
          description: "Cria/atualiza a REGRA de um lançamento fixo recorrente.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "Vazio para criar" },
              dados: { type: "STRING", description: "JSON com: type ('gasto'/'receita'), category, description, amount, person (id), dueDay, startsAt (AAAA-MM), expiresAt (AAAA-MM, opcional)" }
            },
            required: ["dados"]
          }
        },
        {
          name: "excluirLancamentoFixo",
          description: "1ª chamada: id. 2ª chamada: só codigoConfirmacao.",
          parameters: {
            type: "OBJECT",
            properties: { id: { type: "STRING" }, codigoConfirmacao: { type: "STRING" } }
          }
        },
        {
          name: "criarOuAtualizarCartao",
          description: "Cria/atualiza um cartão de crédito.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "Vazio para criar" },
              dados: { type: "STRING", description: "JSON com: name, owner (id da pessoa), limit (número), closeDay (dia de fechamento)" }
            },
            required: ["dados"]
          }
        },
        {
          name: "excluirCartao",
          description: "1ª chamada: id. 2ª chamada: só codigoConfirmacao.",
          parameters: {
            type: "OBJECT",
            properties: { id: { type: "STRING" }, codigoConfirmacao: { type: "STRING" } }
          }
        }
      ]
    }];

    const chat = ai.chats.create({
      model: "gemini-3.6-flash",
      config: { systemInstruction, tools },
      history: historyForGemini
    });

    let messageToSend = message || '';
    if (attachment && attachment.data && attachment.mimeType) {
      messageToSend = [
        { text: message || 'Segue um anexo.' },
        { inlineData: { mimeType: attachment.mimeType, data: attachment.data } }
      ];
    }

    let result = await chat.sendMessage({ message: messageToSend });
    let functionCall = result.functionCalls && result.functionCalls[0];
    let uiAction = null;
    let pendingForm = null;

    while (functionCall) {
      const args = functionCall.args || {};
      let toolResponse = {};

      if (functionCall.name === 'consultarDados') {
        const txs = await readJSON(STORE, 'transactions.json', []);
        const settings = await readJSON(STORE, 'settings.json', {});
        const records = await readJSON(STORE, 'records.json', []);
        const auditLog = await readJSON(STORE, 'audit.json', []);
        const resumoMensal = buildMonthlySummary(txs, settings);
        const mesRef = args.mesReferencia || monthKey(new Date().toISOString());
        const usoCartoes = getCardsUsage(txs, mesRef, settings);
        toolResponse = {
          resumoMensal, transacoes: txs, configuracoes: settings,
          diarios_e_listas: records, usoCartoes, mesReferenciaUsada: mesRef,
          historicoAlteracoes: auditLog.slice(0, 50)
        };
      }

      else if (functionCall.name === 'abrirFormularioLancamento') {
        let known = {};
        try { known = JSON.parse(args.camposConhecidos || '{}'); } catch { known = {}; }
        const settings = await readJSON(STORE, 'settings.json', {});
        const cats = settings.categories || {};
        pendingForm = {
          tipo: 'lancamento',
          camposConhecidos: known,
          opcoes: {
            categoriasGasto: cats.gasto || [],
            categoriasReceita: cats.receita || [],
            pessoas: settings.people || [],
            formasPagamento: ['dinheiro', 'debito', 'pix', 'transferencia'],
            cartoes: (settings.cards || []).map(c => ({ id: c.id, name: c.name }))
          }
        };
        toolResponse = { sucesso: true, mensagem: 'Formulário aberto para o usuário preencher.' };
      }

      else if (functionCall.name === 'criarLancamento') {
        const list = await readJSON(STORE, 'transactions.json', []);
        const now = new Date().toISOString();
        const installments = parseInt(args.installments) || 1;
        const groupId = installments > 1 ? crypto.randomUUID() : null;
        const criados = [];

        for (let i = 0; i < installments; i++) {
          const txDate = new Date(args.date);
          txDate.setMonth(txDate.getMonth() + i);
          const item = {
            id: crypto.randomUUID(),
            groupId,
            installmentLabel: installments > 1 ? `${i + 1}/${installments}` : null,
            isThirdParty: Boolean(args.isThirdParty),
            thirdPartyName: args.isThirdParty ? (args.thirdPartyName || null) : null,
            thirdPartyDate: args.isThirdParty ? (args.thirdPartyDate || null) : null,
            date: txDate.toISOString().split('T')[0],
            type: args.type,
            category: args.category,
            description: args.description || '',
            amount: Number(args.amount),
            paidBy: args.paidBy,
            paymentMethod: args.paymentMethod || 'outro',
            status: 'aberto',
            fixedRefId: null,
            createdBy: 'IA Assistente',
            createdAt: now,
            updatedAt: now
          };
          list.push(item);
          criados.push(item);
        }

        await writeJSON(STORE, 'transactions.json', list);
        await appendAudit(user, 'create', 'transaction', criados[0].id, null, criados[0]);
        toolResponse = { sucesso: true, id: criados[0].id, parcelasCriadas: criados.length, groupId };
        uiAction = 'RELOAD_DATA';
      }

      else if (functionCall.name === 'editarLancamento') {
        const list = await readJSON(STORE, 'transactions.json', []);
        const idx = list.findIndex(t => t.id === args.id);
        if (idx === -1) {
          toolResponse = { sucesso: false, erro: 'ID não encontrado' };
        } else {
          const before = { ...list[idx] };
          const { id, updateGroup, ...changes } = args;
          if (changes.amount !== undefined) changes.amount = Number(changes.amount);
          const now = new Date().toISOString();
          const targetGroupId = list[idx].groupId;

          if (updateGroup && targetGroupId) {
            // Só propaga os campos seguros — igual ao transactions.js real (nunca data nem status)
            const safeChanges = {};
            for (const key of GROUP_CASCADE_FIELDS) {
              if (changes[key] !== undefined) safeChanges[key] = changes[key];
            }
            let count = 0;
            list.forEach((item, i) => {
              if (item.groupId === targetGroupId) {
                list[i] = { ...item, ...safeChanges, updatedAt: now, updatedBy: 'IA Assistente' };
                count++;
              }
            });
            await writeJSON(STORE, 'transactions.json', list);
            await appendAudit(user, 'update_group', 'transaction_group', targetGroupId, before, list[idx]);
            toolResponse = { sucesso: true, parcelasAtualizadas: count, lancamento: list[idx] };
          } else {
            list[idx] = { ...list[idx], ...changes, updatedAt: now, updatedBy: 'IA Assistente' };
            await writeJSON(STORE, 'transactions.json', list);
            await appendAudit(user, 'update', 'transaction', args.id, before, list[idx]);
            toolResponse = { sucesso: true, lancamento: list[idx] };
          }
          uiAction = 'RELOAD_DATA';
        }
      }

      else if (functionCall.name === 'atualizarStatusEmMassa') {
        const list = await readJSON(STORE, 'transactions.json', []);
        const ids = args.ids || [];
        const now = new Date().toISOString();
        let count = 0;
        list.forEach((item, i) => {
          if (ids.includes(item.id)) {
            list[i].status = args.status;
            list[i].updatedAt = now;
            list[i].updatedBy = 'IA Assistente';
            count++;
          }
        });
        if (count > 0) {
          await writeJSON(STORE, 'transactions.json', list);
          await appendAudit(user, 'update_group', 'transaction_group', 'bulk', { action: 'Atualização em Massa (Status)' }, { status: args.status, count });
          uiAction = 'RELOAD_DATA';
        }
        toolResponse = { sucesso: count > 0, lancamentosAtualizados: count };
      }

      else if (functionCall.name === 'excluirLancamento') {
        if (args.codigoConfirmacao) {
          const match = await resolveDeletionCode('transaction', args.codigoConfirmacao);
          if (!match) { toolResponse = { sucesso: false, erro: 'Código inválido ou expirado.' }; }
          else {
            const list = await readJSON(STORE, 'transactions.json', []);
            const idx = list.findIndex(t => t.id === match.id);
            if (idx === -1) { toolResponse = { sucesso: false, erro: 'Já não existe mais.' }; }
            else {
              const before = list[idx];
              const targetGroupId = before.groupId;
              if (match.excluirGrupoTodo && targetGroupId) {
                const restante = list.filter(t => t.groupId !== targetGroupId);
                const removidas = list.length - restante.length;
                await writeJSON(STORE, 'transactions.json', restante);
                await appendAudit(user, 'delete_group', 'transaction_group', targetGroupId, before, null);
                toolResponse = { sucesso: true, mensagem: `Grupo excluído (${removidas} parcelas).` };
              } else {
                list.splice(idx, 1);
                await writeJSON(STORE, 'transactions.json', list);
                await appendAudit(user, 'delete', 'transaction', match.id, before, null);
                toolResponse = { sucesso: true, mensagem: 'Excluído com sucesso' };
              }
              uiAction = 'RELOAD_DATA';
            }
          }
        } else {
          const list = await readJSON(STORE, 'transactions.json', []);
          const idx = list.findIndex(t => t.id === args.id);
          if (idx === -1) { toolResponse = { sucesso: false, erro: 'ID não encontrado' }; }
          else {
            const item = list[idx];
            const totalGrupo = item.groupId ? list.filter(t => t.groupId === item.groupId).length : 1;
            toolResponse = await requestDeletionCode(
              'transaction', args.id,
              {
                descricao: item.description, valor: item.amount, data: item.date,
                parcela: item.installmentLabel,
                escopo: args.excluirGrupoTodo ? `TODAS as ${totalGrupo} parcelas do grupo` : 'somente este lançamento'
              },
              { excluirGrupoTodo: Boolean(args.excluirGrupoTodo) }
            );
          }
        }
      }

      else if (functionCall.name === 'transferirTitularidadeCartao') {
        const list = await readJSON(STORE, 'transactions.json', []);
        const now = new Date().toISOString();
        let count = 0;
        list.forEach((item, i) => {
          if (item.paymentMethod === args.formaPagamento) {
            list[i].paidBy = args.novoDono;
            list[i].updatedAt = now;
            list[i].updatedBy = 'IA Assistente';
            count++;
          }
        });
        if (count > 0) {
          await writeJSON(STORE, 'transactions.json', list);
          await appendAudit(user, 'update_group', 'transaction_group', args.formaPagamento, { action: 'Transferência de Titularidade' }, { newOwner: args.novoDono, updatedCount: count });
          uiAction = 'RELOAD_DATA';
        }
        toolResponse = { sucesso: count > 0, lancamentosTransferidos: count };
      }

      else if (functionCall.name === 'criarOuAtualizarRegistro') {
        let dadosParsed = {};
        try { dadosParsed = JSON.parse(args.dados || '{}'); } catch { dadosParsed = {}; }
        const list = await readJSON(STORE, 'records.json', []);
        if (args.id) {
          const idx = list.findIndex(r => r.id === args.id);
          if (idx > -1) {
            const before = { ...list[idx] };
            list[idx] = { ...list[idx], ...dadosParsed, type: args.tipo || list[idx].type, updatedAt: new Date().toISOString(), updatedBy: 'IA Assistente' };
            await writeJSON(STORE, 'records.json', list);
            await appendAudit(user, 'update', 'record', args.id, before, list[idx]);
            toolResponse = { sucesso: true, registro: list[idx] };
            uiAction = 'RELOAD_DATA';
          } else { toolResponse = { sucesso: false, erro: 'ID não encontrado' }; }
        } else {
          const newRecord = { id: crypto.randomUUID(), type: args.tipo, ...dadosParsed, createdBy: 'IA Assistente', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          list.push(newRecord);
          await writeJSON(STORE, 'records.json', list);
          await appendAudit(user, 'create', 'record', newRecord.id, null, newRecord);
          toolResponse = { sucesso: true, registro: newRecord };
          uiAction = 'RELOAD_DATA';
        }
      }

      else if (functionCall.name === 'excluirRegistro') {
        if (args.codigoConfirmacao) {
          const match = await resolveDeletionCode('record', args.codigoConfirmacao);
          if (!match) { toolResponse = { sucesso: false, erro: 'Código inválido ou expirado.' }; }
          else {
            const list = await readJSON(STORE, 'records.json', []);
            const idx = list.findIndex(r => r.id === match.id);
            if (idx === -1) { toolResponse = { sucesso: false, erro: 'Já não existe mais.' }; }
            else {
              const before = list[idx];
              await writeJSON(STORE, 'records.json', list.filter(r => r.id !== match.id));
              await appendAudit(user, 'delete', 'record', match.id, before, null);
              toolResponse = { sucesso: true, mensagem: 'Excluído com sucesso' };
              uiAction = 'RELOAD_DATA';
            }
          }
        } else {
          const list = await readJSON(STORE, 'records.json', []);
          const idx = list.findIndex(r => r.id === args.id);
          if (idx === -1) { toolResponse = { sucesso: false, erro: 'ID não encontrado' }; }
          else { toolResponse = await requestDeletionCode('record', args.id, list[idx]); }
        }
      }

      else if (functionCall.name === 'criarOuAtualizarLancamentoFixo') {
        let dadosParsed = {};
        try { dadosParsed = JSON.parse(args.dados || '{}'); } catch { dadosParsed = {}; }
        const settings = await readJSON(STORE, 'settings.json', {});
        settings.fixedEntries = settings.fixedEntries || [];
        if (args.id) {
          const idx = settings.fixedEntries.findIndex(f => f.id === args.id);
          if (idx > -1) {
            const before = { ...settings.fixedEntries[idx] };
            settings.fixedEntries[idx] = { ...settings.fixedEntries[idx], ...dadosParsed };
            await writeJSON(STORE, 'settings.json', settings);
            await appendAudit(user, 'update', 'fixedEntry', args.id, before, settings.fixedEntries[idx]);
            toolResponse = { sucesso: true, lancamentoFixo: settings.fixedEntries[idx] };
            uiAction = 'RELOAD_DATA';
          } else { toolResponse = { sucesso: false, erro: 'ID não encontrado' }; }
        } else {
          const newFixo = { id: crypto.randomUUID(), ...dadosParsed };
          settings.fixedEntries.push(newFixo);
          await writeJSON(STORE, 'settings.json', settings);
          await appendAudit(user, 'create', 'fixedEntry', newFixo.id, null, newFixo);
          toolResponse = { sucesso: true, lancamentoFixo: newFixo };
          uiAction = 'RELOAD_DATA';
        }
      }

      else if (functionCall.name === 'excluirLancamentoFixo') {
        if (args.codigoConfirmacao) {
          const match = await resolveDeletionCode('fixedEntry', args.codigoConfirmacao);
          if (!match) { toolResponse = { sucesso: false, erro: 'Código inválido ou expirado.' }; }
          else {
            const settings = await readJSON(STORE, 'settings.json', {});
            settings.fixedEntries = settings.fixedEntries || [];
            const idx = settings.fixedEntries.findIndex(f => f.id === match.id);
            if (idx === -1) { toolResponse = { sucesso: false, erro: 'Já não existe mais.' }; }
            else {
              const before = settings.fixedEntries[idx];
              settings.fixedEntries.splice(idx, 1);
              await writeJSON(STORE, 'settings.json', settings);
              await appendAudit(user, 'delete', 'fixedEntry', match.id, before, null);
              toolResponse = { sucesso: true, mensagem: 'Excluído com sucesso' };
              uiAction = 'RELOAD_DATA';
            }
          }
        } else {
          const settings = await readJSON(STORE, 'settings.json', {});
          const item = (settings.fixedEntries || []).find(f => f.id === args.id);
          if (!item) { toolResponse = { sucesso: false, erro: 'ID não encontrado' }; }
          else { toolResponse = await requestDeletionCode('fixedEntry', args.id, item); }
        }
      }

      else if (functionCall.name === 'criarOuAtualizarCartao') {
        let dadosParsed = {};
        try { dadosParsed = JSON.parse(args.dados || '{}'); } catch { dadosParsed = {}; }
        const settings = await readJSON(STORE, 'settings.json', {});
        settings.cards = settings.cards || [];
        if (args.id) {
          const idx = settings.cards.findIndex(c => c.id === args.id);
          if (idx > -1) {
            const before = { ...settings.cards[idx] };
            settings.cards[idx] = { ...settings.cards[idx], ...dadosParsed };
            await writeJSON(STORE, 'settings.json', settings);
            await appendAudit(user, 'update', 'card', args.id, before, settings.cards[idx]);
            toolResponse = { sucesso: true, cartao: settings.cards[idx] };
            uiAction = 'RELOAD_DATA';
          } else { toolResponse = { sucesso: false, erro: 'ID não encontrado' }; }
        } else {
          const newCard = { id: 'card_' + crypto.randomUUID().slice(0, 8), ...dadosParsed };
          settings.cards.push(newCard);
          await writeJSON(STORE, 'settings.json', settings);
          await appendAudit(user, 'create', 'card', newCard.id, null, newCard);
          toolResponse = { sucesso: true, cartao: newCard };
          uiAction = 'RELOAD_DATA';
        }
      }

      else if (functionCall.name === 'excluirCartao') {
        if (args.codigoConfirmacao) {
          const match = await resolveDeletionCode('card', args.codigoConfirmacao);
          if (!match) { toolResponse = { sucesso: false, erro: 'Código inválido ou expirado.' }; }
          else {
            const settings = await readJSON(STORE, 'settings.json', {});
            settings.cards = settings.cards || [];
            const idx = settings.cards.findIndex(c => c.id === match.id);
            if (idx === -1) { toolResponse = { sucesso: false, erro: 'Já não existe mais.' }; }
            else {
              const before = settings.cards[idx];
              settings.cards.splice(idx, 1);
              await writeJSON(STORE, 'settings.json', settings);
              await appendAudit(user, 'delete', 'card', match.id, before, null);
              toolResponse = { sucesso: true, mensagem: 'Excluído com sucesso' };
              uiAction = 'RELOAD_DATA';
            }
          }
        } else {
          const settings = await readJSON(STORE, 'settings.json', {});
          const item = (settings.cards || []).find(c => c.id === args.id);
          if (!item) { toolResponse = { sucesso: false, erro: 'ID não encontrado' }; }
          else { toolResponse = await requestDeletionCode('card', args.id, item); }
        }
      }

      result = await chat.sendMessage({
        message: [{ functionResponse: { name: functionCall.name, response: toolResponse } }]
      });
      functionCall = result.functionCalls && result.functionCalls[0];
    }

    const now = new Date().toISOString();
    const textForHistory = (message || '') + (attachment ? ` [anexo enviado: ${attachment.mimeType}]` : '');
    session.messages.push({ role: 'user', text: textForHistory, timestamp: now });
    session.messages.push({ role: 'model', text: result.text, timestamp: now });
    session.updatedAt = now;
    if (!session.title) session.title = await generateTitle(ai, textForHistory, result.text);
    await saveSessions(sessions);

    return Response.json({
      text: result.text,
      uiAction,
      chatId: session.id,
      formulario: pendingForm
    }, { status: 200, headers });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers });
  }
};
