import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { readJSON, writeJSON } from './_shared/blobStore.js';
import { verifyToken, cors } from './_shared/authMiddleware.js';
import { buildMonthlySummary, getCardsUsage, monthKey } from './_shared/financeEngine.js';

const STORE = 'financas';
const CONFIRMATION_TTL_MS = 30 * 60 * 1000;
const CONTEXT_LIMIT = parseInt(process.env.CHAT_CONTEXT_LIMIT || '100', 10);

// Campos propagáveis em cascade de parcelas — nunca inclui date nem status
const GROUP_CASCADE_FIELDS = ['category', 'description', 'amount', 'paidBy', 'paymentMethod', 'isThirdParty', 'thirdPartyName', 'thirdPartyDate'];

async function appendAudit(user, action, entity, entityId, before, after) {
  const log = await readJSON(STORE, 'audit.json', []);
  log.unshift({
    id: crypto.randomUUID(), timestamp: new Date().toISOString(),
    userId: user.sub, userName: user.name, action, entity, entityId, before, after,
  });
  await writeJSON(STORE, 'audit.json', log.slice(0, 1000));
}

async function getSessions() {
  return await readJSON(STORE, 'chat_sessions.json', []);
}
async function saveSessions(sessions) {
  await writeJSON(STORE, 'chat_sessions.json', sessions);
}

async function generateTitle(ai, userMsg, aiMsg) {
  try {
    const r = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: `Gere um título curto (3 a 6 palavras, sem aspas, sem ponto final) para esta conversa de um app financeiro de casal, baseado na troca abaixo. Responda APENAS com o título.\n\nUsuário: ${userMsg}\nAssistente: ${String(aiMsg || '').slice(0, 300)}`
    });
    const title = (r.text || '').trim().replace(/^["'""]+|["'""]+$/g, '').replace(/\.$/, '');
    return title || (userMsg || 'Anexo enviado').slice(0, 40);
  } catch {
    return (userMsg || 'Anexo enviado').slice(0, 40);
  }
}

// ---------- TRAVA DE EXCLUSÃO ----------
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
    instrucao: `Código de segurança gerado: **${codigo}**. EXIBA este código claramente ao usuário e peça que ele o digite no chat para confirmar a exclusão. NÃO exclua nada ainda. Aguarde o código.`
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
      .filter(m => m.text !== null && m.text !== undefined && String(m.text).trim() !== '')
      .map(m => ({ role: m.role, parts: [{ text: m.text }] }));

    const u1 = process.env.USER1_NAME || 'Pessoa 1';
    const u2 = process.env.USER2_NAME || 'Pessoa 2';

    const systemInstruction = `Você é o assistente financeiro e organizador de vida do casal ${u1} e ${u2}.
Seu papel é analisar dados financeiros e ajudar na gestão do "Life Hub" (Viagens, Metas, Assinaturas, Mercado e Manutenções).

REGRA CRÍTICA — LANÇAMENTOS (leia com atenção máxima):
Quando o usuário pedir para lançar, registrar, adicionar qualquer gasto ou receita:
- Se a mensagem NÃO contiver explicitamente todos estes campos: data, tipo (gasto/receita), categoria, valor, quem pagou E forma de pagamento (se gasto) → você DEVE chamar IMEDIATAMENTE 'abrirFormularioLancamento' com os campos que já sabe em 'camposConhecidos'.
- PROIBIDO fazer perguntas em texto pedindo dados do lançamento. PROIBIDO dizer "posso abrir um formulário". CHAME A FUNÇÃO AGORA sem texto explicativo.
- PROIBIDO dizer que um lançamento foi "registrado" ou "salvo" sem ter chamado 'criarLancamento' E recebido id de sucesso do sistema.
- Se a mensagem começa com "[FORMULARIO_PREENCHIDO]" seguida de JSON: chame 'criarLancamento' com esses valores exatos, sem perguntar nada.

REGRA CRÍTICA — LIFE HUB:
Quando o usuário pedir para criar/adicionar qualquer coisa no Life Hub (meta, viagem, lista de mercado, assinatura, manutenção):
- Se faltar informação essencial (nome da lista, valor da meta, etc.) → chame IMEDIATAMENTE 'abrirFormularioLifeHub' com o tipo e os campos já conhecidos.
- Para listas de mercado: SEMPRE pergunte o nome do mercado/lista antes de salvar se não foi dito. Se o usuário mandar FOTO de lista escrita à mão, extraia os itens, mostre a lista, pergunte o nome e só salve após confirmação.
- PROIBIDO salvar um registro do Life Hub inventando campos que o usuário não forneceu.

REGRA DE OURO 1: Toda exclusão exige confirmação em duas etapas com código de 4 dígitos. 1ª chamada com id → gera código, NÃO exclui. 2ª chamada com codigoConfirmacao → exclui.
REGRA DE OURO 2: Use SEMPRE resumoMensal[chave] para saldo/receitas/despesas. NUNCA some transacoes brutas.
REGRA DE OURO 3: Para o Life Hub, use 'tipo' EXATO: 'goal' (meta), 'trip' (viagem), 'subscription' (assinatura), 'shopping' (mercado), 'maintenance' (manutenção).
REGRA DE OURO 4: Ao usar updateGroup em editarLancamento, data e status NUNCA são propagados — só categoria, descrição, valor, responsável, forma de pagamento e dados de terceiro.
REGRA DE OURO 5: Para transferir lançamentos de um cartão para outra pessoa, use transferirTitularidadeCartao. Confirme antes.
REGRA DE OURO 6: Você tem memória desta conversa (até ${CONTEXT_LIMIT} mensagens). Não peça repetição.
REGRA DE OURO 7: Se receber mensagem iniciada com "[SISTEMA]", o backend JÁ executou a ação. Apenas confirme amigavelmente ao usuário. Não chame nenhuma função.
REGRA DE OURO 8: Se o usuário enviar imagem ou áudio, interprete o conteúdo e siga as regras normalmente — inclusive abrindo formulário se faltar informação.
REGRA DE OURO 9: Sugira proativamente se o casal consegue bater uma Meta cruzando o Saldo Restante do mês com o valor faltante.`;

    const tools = [{
      functionDeclarations: [
        {
          name: "consultarDados",
          description: "Retorna resumoMensal, transacoes brutas, configuracoes (categories.gasto, categories.receita, people, cards, fixedEntries), diarios_e_listas (Life Hub), usoCartoes e historicoAlteracoes.",
          parameters: {
            type: "OBJECT",
            properties: {
              mesReferencia: { type: "STRING", description: "Mês AAAA-MM para uso de cartões. Opcional." }
            }
          }
        },
        {
          name: "abrirFormularioLancamento",
          description: "OBRIGATÓRIO chamar quando o usuário pedir para lançar/registrar um gasto ou receita e qualquer campo estiver faltando. Abre formulário interativo no chat. NÃO faça perguntas em texto — chame esta função diretamente.",
          parameters: {
            type: "OBJECT",
            properties: {
              camposConhecidos: { type: "STRING", description: "JSON com campos já identificados, ex: {\"amount\":10,\"type\":\"gasto\",\"description\":\"café\"}" }
            },
            required: ["camposConhecidos"]
          }
        },
        {
          name: "abrirFormularioLifeHub",
          description: "OBRIGATÓRIO chamar quando o usuário pedir para criar/adicionar algo no Life Hub e informações estiverem faltando. Abre formulário interativo no chat. NÃO faça perguntas em texto.",
          parameters: {
            type: "OBJECT",
            properties: {
              tipo: { type: "STRING", description: "'goal', 'trip', 'subscription', 'shopping' ou 'maintenance'" },
              camposConhecidos: { type: "STRING", description: "JSON com campos já identificados pelo usuário" }
            },
            required: ["tipo", "camposConhecidos"]
          }
        },
        {
          name: "criarLancamento",
          description: "Cria um lançamento financeiro. Só chame quando tiver TODOS os campos obrigatórios.",
          parameters: {
            type: "OBJECT",
            properties: {
              date: { type: "STRING", description: "YYYY-MM-DD" },
              type: { type: "STRING", description: "'gasto' ou 'receita'" },
              category: { type: "STRING", description: "Categoria exata da lista do tipo" },
              description: { type: "STRING", description: "Descrição curta" },
              amount: { type: "NUMBER", description: "Valor de cada parcela" },
              paidBy: { type: "STRING", description: "ID de quem pagou (u1 ou u2)" },
              paymentMethod: { type: "STRING", description: "dinheiro, debito, pix, transferencia, ou card_<id>. Null se receita." },
              installments: { type: "NUMBER", description: "Parcelas. Omita ou 1 para único." },
              isThirdParty: { type: "BOOLEAN" },
              thirdPartyName: { type: "STRING" },
              thirdPartyDate: { type: "STRING" }
            },
            required: ["date", "type", "category", "amount", "paidBy"]
          }
        },
        {
          name: "editarLancamento",
          description: "Edita um lançamento. status: 'ok' ou 'aberto'. updateGroup=true propaga para todas as parcelas (exceto date e status).",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              date: { type: "STRING" },
              type: { type: "STRING" },
              category: { type: "STRING" },
              description: { type: "STRING" },
              amount: { type: "NUMBER" },
              paidBy: { type: "STRING" },
              paymentMethod: { type: "STRING" },
              status: { type: "STRING", description: "'ok' ou 'aberto'" },
              isThirdParty: { type: "BOOLEAN" },
              thirdPartyName: { type: "STRING" },
              thirdPartyDate: { type: "STRING" },
              updateGroup: { type: "BOOLEAN" }
            },
            required: ["id"]
          }
        },
        {
          name: "atualizarStatusEmMassa",
          description: "Marca vários lançamentos como 'ok' ou 'aberto' de uma vez.",
          parameters: {
            type: "OBJECT",
            properties: {
              ids: { type: "ARRAY", items: { type: "STRING" } },
              status: { type: "STRING" }
            },
            required: ["ids", "status"]
          }
        },
        {
          name: "excluirLancamento",
          description: "1ª chamada: id (gera código). 2ª chamada: só codigoConfirmacao. excluirGrupoTodo=true exclui todas as parcelas.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              excluirGrupoTodo: { type: "BOOLEAN" },
              codigoConfirmacao: { type: "STRING" }
            }
          }
        },
        {
          name: "transferirTitularidadeCartao",
          description: "Transfere TODOS os lançamentos de uma forma de pagamento para outra pessoa. Confirme antes.",
          parameters: {
            type: "OBJECT",
            properties: {
              formaPagamento: { type: "STRING" },
              novoDono: { type: "STRING" }
            },
            required: ["formaPagamento", "novoDono"]
          }
        },
        {
          name: "criarOuAtualizarRegistro",
          description: `Cria/atualiza um registro do Life Hub. Tipos e schemas EXATOS:
- 'goal': {"title": string, "target": number, "saved": number}
- 'trip': {"title": string, "date": "AAAA-MM-01", "places": [{"id":"p1","name":string,"link":string,"estCost":number}]}
- 'subscription': {"title": string, "cost": number, "cycle": "Mensal" ou "Anual"}
- 'shopping': {"title": string, "date": "AAAA-MM-DD", "items": [{"id":"i1","name":string,"qty":number,"price":0,"checked":false}]}
- 'maintenance': {"vehicle": string, "service": string, "km": number, "cost": number, "date": "AAAA-MM-DD"}
Para adicionar item a lista existente: leia via consultarDados, acrescente ao array e mande o array completo.`,
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "Vazio para criar" },
              tipo: { type: "STRING" },
              dados: { type: "STRING" }
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
          description: "Cria/atualiza regra de lançamento fixo recorrente.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              dados: { type: "STRING", description: "JSON: type, category, description, amount, person (id), dueDay, startsAt (AAAA-MM), expiresAt (opcional)" }
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
          description: "Cria/atualiza cartão de crédito.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              dados: { type: "STRING", description: "JSON: name, owner (id), limit (número), closeDay" }
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

    // ---------- INTERCEPTAÇÃO DETERMINÍSTICA DE EXCLUSÃO ----------
    let messageToSend = message || '';
    let uiAction = null;
    let pendingForm = null;

    const trimmedMsg = typeof message === 'string' ? message.trim() : '';
    if (/^\d{4}$/.test(trimmedMsg)) {
      const allPending = await readJSON(STORE, 'pending_deletions.json', []);
      const validPending = allPending.filter(p => p.expiresAt > Date.now());
      const matchedPending = validPending.find(p => p.codigo === trimmedMsg);

      if (matchedPending) {
        // Executa a exclusão determinísticamente — sem depender da IA
        if (matchedPending.entity === 'transaction') {
          const list = await readJSON(STORE, 'transactions.json', []);
          const idx = list.findIndex(t => t.id === matchedPending.id);
          if (idx > -1) {
            const before = list[idx];
            if (matchedPending.excluirGrupoTodo && before.groupId) {
              const restante = list.filter(t => t.groupId !== before.groupId);
              await writeJSON(STORE, 'transactions.json', restante);
              await appendAudit(user, 'delete_group', 'transaction_group', before.groupId, before, null);
            } else {
              list.splice(idx, 1);
              await writeJSON(STORE, 'transactions.json', list);
              await appendAudit(user, 'delete', 'transaction', matchedPending.id, before, null);
            }
          }
        } else if (matchedPending.entity === 'record') {
          const list = await readJSON(STORE, 'records.json', []);
          const idx = list.findIndex(r => r.id === matchedPending.id);
          if (idx > -1) {
            const before = list[idx];
            list.splice(idx, 1);
            await writeJSON(STORE, 'records.json', list);
            await appendAudit(user, 'delete', 'record', matchedPending.id, before, null);
          }
        } else if (matchedPending.entity === 'fixedEntry') {
          const settings = await readJSON(STORE, 'settings.json', {});
          settings.fixedEntries = settings.fixedEntries || [];
          const idx = settings.fixedEntries.findIndex(f => f.id === matchedPending.id);
          if (idx > -1) {
            const before = settings.fixedEntries[idx];
            settings.fixedEntries.splice(idx, 1);
            await writeJSON(STORE, 'settings.json', settings);
            await appendAudit(user, 'delete', 'fixedEntry', matchedPending.id, before, null);
          }
        } else if (matchedPending.entity === 'card') {
          const settings = await readJSON(STORE, 'settings.json', {});
          settings.cards = settings.cards || [];
          const idx = settings.cards.findIndex(c => c.id === matchedPending.id);
          if (idx > -1) {
            const before = settings.cards[idx];
            settings.cards.splice(idx, 1);
            await writeJSON(STORE, 'settings.json', settings);
            await appendAudit(user, 'delete', 'card', matchedPending.id, before, null);
          }
        }

        await writeJSON(STORE, 'pending_deletions.json', validPending.filter(p => p !== matchedPending));
        messageToSend = `[SISTEMA] Código correto. Item excluído com sucesso. Avise ao usuário de forma amigável que foi feito.`;
        uiAction = 'RELOAD_DATA';
      } else {
        const expiredMatch = allPending.find(p => p.codigo === trimmedMsg);
        if (expiredMatch) {
          messageToSend = `[SISTEMA] O código ${trimmedMsg} expirou. Informe ao usuário que o código não é mais válido e que deve solicitar a exclusão novamente para receber um novo código.`;
        }
      }
    }
    // ---------- FIM DA INTERCEPTAÇÃO ----------

    if (attachment && attachment.data && attachment.mimeType && !messageToSend.startsWith('[SISTEMA]')) {
      messageToSend = [
        { text: message || 'Segue um anexo.' },
        { inlineData: { mimeType: attachment.mimeType, data: attachment.data } }
      ];
    }

    const chat = ai.chats.create({
      model: "gemini-2.5-flash-lite",
      config: { systemInstruction, tools },
      history: historyForGemini
    });

    let result = await chat.sendMessage({ message: messageToSend });
    let functionCall = result.functionCalls && result.functionCalls[0];

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
        toolResponse = { sucesso: true, mensagem: 'Formulário aberto no chat.' };
      }

      else if (functionCall.name === 'abrirFormularioLifeHub') {
        let known = {};
        try { known = JSON.parse(args.camposConhecidos || '{}'); } catch { known = {}; }
        const settings = await readJSON(STORE, 'settings.json', {});
        pendingForm = {
          tipo: args.tipo || 'shopping',
          camposConhecidos: known,
          opcoes: {
            pessoas: settings.people || [],
            cartoes: (settings.cards || []).map(c => ({ id: c.id, name: c.name }))
          }
        };
        toolResponse = { sucesso: true, mensagem: 'Formulário Life Hub aberto no chat.' };
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
            id: crypto.randomUUID(), groupId,
            installmentLabel: installments > 1 ? `${i + 1}/${installments}` : null,
            isThirdParty: Boolean(args.isThirdParty),
            thirdPartyName: args.isThirdParty ? (args.thirdPartyName || null) : null,
            thirdPartyDate: args.isThirdParty ? (args.thirdPartyDate || null) : null,
            date: txDate.toISOString().split('T')[0],
            type: args.type, category: args.category,
            description: args.description || '',
            amount: Number(args.amount), paidBy: args.paidBy,
            paymentMethod: args.paymentMethod || 'outro',
            status: 'aberto', fixedRefId: null,
            createdBy: 'IA Assistente', createdAt: now, updatedAt: now
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
        if (idx === -1) { toolResponse = { sucesso: false, erro: 'ID não encontrado' }; }
        else {
          const before = { ...list[idx] };
          const { id, updateGroup, ...changes } = args;
          if (changes.amount !== undefined) changes.amount = Number(changes.amount);
          const now = new Date().toISOString();
          const targetGroupId = list[idx].groupId;
          if (updateGroup && targetGroupId) {
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
              if (match.excluirGrupoTodo && before.groupId) {
                const restante = list.filter(t => t.groupId !== before.groupId);
                const removidas = list.length - restante.length;
                await writeJSON(STORE, 'transactions.json', restante);
                await appendAudit(user, 'delete_group', 'transaction_group', before.groupId, before, null);
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
            toolResponse = await requestDeletionCode('transaction', args.id, {
              descricao: item.description, valor: item.amount, data: item.date,
              parcela: item.installmentLabel,
              escopo: args.excluirGrupoTodo ? `TODAS as ${totalGrupo} parcelas` : 'somente este lançamento'
            }, { excluirGrupoTodo: Boolean(args.excluirGrupoTodo) });
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
    const textForHistory = (message || '') + (attachment ? ` [anexo: ${attachment.mimeType}]` : '');
    session.messages.push({ role: 'user', text: textForHistory, timestamp: now });
    session.messages.push({ role: 'model', text: result.text || '', timestamp: now });
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
