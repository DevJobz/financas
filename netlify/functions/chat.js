import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { readJSON, writeJSON } from './_shared/blobStore.js';
import { verifyToken, cors } from './_shared/authMiddleware.js';
import { buildMonthlySummary } from './_shared/financeEngine.js';

const STORE = 'financas';
const CONFIRMATION_TTL_MS = 5 * 60 * 1000; // código de confirmação vale 5 minutos
const CONTEXT_LIMIT = parseInt(process.env.CHAT_CONTEXT_LIMIT || '100', 10); // quantas mensagens salvas viram contexto pro modelo

async function appendAudit(user, action, entity, entityId, before, after) {
  const log = await readJSON(STORE, 'audit.json', []);
  log.unshift({
    id: crypto.randomUUID(), timestamp: new Date().toISOString(),
    userId: user.sub, userName: user.name, action, entity, entityId, before, after,
  });
  await writeJSON(STORE, 'audit.json', log.slice(0, 1000));
}

// ---------- SESSÕES DE CHAT (multi-conversa, com histórico persistido) ----------
async function getSessions() {
  return await readJSON(STORE, 'chat_sessions.json', []);
}
async function saveSessions(sessions) {
  await writeJSON(STORE, 'chat_sessions.json', sessions);
}

async function generateTitle(ai, userMsg, aiMsg) {
  try {
    const r = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: `Gere um título curto (3 a 6 palavras, sem aspas, sem ponto final no fim) para esta conversa de um app financeiro de casal, baseado na troca abaixo. Responda APENAS com o título, nada mais.\n\nUsuário: ${userMsg}\nAssistente: ${String(aiMsg || '').slice(0, 300)}`
    });
    const title = (r.text || '').trim().replace(/^["'“”]+|["'“”]+$/g, '').replace(/\.$/, '');
    return title || userMsg.slice(0, 40);
  } catch {
    return userMsg.slice(0, 40);
  }
}

// ---------- TRAVA REAL DE CONFIRMAÇÃO PARA EXCLUSÕES ----------
async function getPendingDeletions() {
  const list = await readJSON(STORE, 'pending_deletions.json', []);
  return list.filter(p => p.expiresAt > Date.now());
}

async function requestDeletionCode(entity, id, preview) {
  const pending = await getPendingDeletions();
  const filtered = pending.filter(p => !(p.entity === entity && p.id === id));
  const codigo = String(crypto.randomInt(1000, 10000));
  filtered.push({ entity, id, codigo, expiresAt: Date.now() + CONFIRMATION_TTL_MS });
  await writeJSON(STORE, 'pending_deletions.json', filtered);
  return {
    aguardandoConfirmacao: true,
    item: preview,
    codigoConfirmacao: codigo,
    instrucao: 'NÃO diga que excluiu nada ainda. Mostre os detalhes do item ao usuário e peça para ele confirmar informando este código de 4 dígitos. Quando o usuário responder com o código, chame esta mesma função de novo passando SOMENTE o codigoConfirmacao (o id não é necessário nessa segunda chamada).'
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
    const { message, chatId } = await req.json();

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // ---------- Carrega ou cria a sessão de chat ----------
    const sessions = await getSessions();
    let session = chatId ? sessions.find(s => s.id === chatId) : null;
    let isNewSession = false;
    if (!session) {
      session = {
        id: crypto.randomUUID(),
        title: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: user.sub,
        messages: []
      };
      sessions.push(session);
      isNewSession = true;
    }

    // Só os últimos CONTEXT_LIMIT viram contexto pro modelo (o histórico completo continua salvo)
    const historyForGemini = session.messages
      .slice(-CONTEXT_LIMIT)
      .map(m => ({ role: m.role, parts: [{ text: m.text }] }));

    const u1 = process.env.USER1_NAME || 'Pessoa 1';
    const u2 = process.env.USER2_NAME || 'Pessoa 2';

    const systemInstruction = `Você é o assistente financeiro e organizador de vida do casal ${u1} e ${u2}.
    Seu papel é analisar os dados financeiros e ajudar na gestão do "Life Hub" (Viagens, Metas, Mercado e Manutenções).
    REGRA DE OURO 1: Toda exclusão (de lançamento OU de registro do Life Hub) exige confirmação em duas etapas. Ao chamar excluirLancamento ou excluirRegistro pela primeira vez (com o id, sem codigoConfirmacao), você recebe um código de 4 dígitos e os detalhes do item — mostre isso ao usuário e peça que ele confirme informando o código. NUNCA diga "excluí" nessa primeira chamada. Quando o usuário responder com o código, chame a mesma função de novo passando SOMENTE codigoConfirmacao.
    REGRA DE OURO 2: Se o usuário pedir planejamento de viagem, progresso de metas, mercado ou manutenções, chame consultarDados para ler a base atualizada (objeto 'diarios_e_listas'). Antes de CRIAR um registro novo, observe o formato dos registros existentes do mesmo tipo em 'diarios_e_listas' e mantenha os mesmos campos.
    REGRA DE OURO 3: Você pode sugerir de forma proativa se o casal consegue atingir uma Meta cruzando o "Saldo Restante" do mês com o valor faltante da meta.
    REGRA DE OURO 4: Seja claro, analítico, verdadeiro e amigável. Formate valores monetários sempre em R$.
    REGRA DE OURO 5: O campo 'resumoMensal' retornado por consultarDados já vem com saldo, receitas e despesas calculados corretamente por mês (chave AAAA-MM), incluindo saldo acumulado de meses anteriores e lançamentos fixos recorrentes. NUNCA some 'transacoes' brutas por conta própria para calcular saldo — use 'transacoes' apenas para localizar o id de um lançamento específico.
    REGRA DE OURO 6: Para editar um lançamento financeiro já existente, use editarLancamento passando o id e só os campos que mudaram.
    REGRA DE OURO 7: Para criar, atualizar ou excluir metas, viagens, itens de mercado ou manutenções, use criarOuAtualizarRegistro / excluirRegistro. NUNCA use criarLancamento/editarLancamento/excluirLancamento para isso.
    REGRA DE OURO 8: Você tem memória desta conversa (até ${CONTEXT_LIMIT} mensagens anteriores). Use o contexto já dito antes nesta mesma conversa sem pedir pro usuário repetir informação que ele já deu aqui.`;

    const tools = [{
      functionDeclarations: [
        {
          name: "consultarDados",
          description: "Retorna o resumo mensal já calculado (resumoMensal), os lançamentos brutos, categorias e pessoas configuradas, e os registros do Life Hub (diarios_e_listas), para você basear suas respostas."
        },
        {
          name: "criarLancamento",
          description: "Cria um novo lançamento financeiro (receita ou gasto).",
          parameters: {
            type: "OBJECT",
            properties: {
              date: { type: "STRING", description: "Data no formato YYYY-MM-DD" },
              type: { type: "STRING", description: "'gasto' ou 'receita'" },
              category: { type: "STRING", description: "Categoria exata (ex: Alimentação, Moradia)" },
              description: { type: "STRING", description: "Descrição curta" },
              amount: { type: "NUMBER", description: "Valor monetário positivo" },
              paidBy: { type: "STRING", description: "ID de quem pagou (u1 ou u2)" },
              paymentMethod: { type: "STRING", description: "ID da forma de pagamento (dinheiro, pix, debito, card_...)" }
            },
            required: ["date", "type", "category", "amount", "paidBy"]
          }
        },
        {
          name: "editarLancamento",
          description: "Edita um lançamento financeiro existente. Só altera os campos enviados; os demais permanecem como estavam.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "ID do lançamento a ser editado" },
              date: { type: "STRING", description: "Nova data YYYY-MM-DD (opcional)" },
              type: { type: "STRING", description: "'gasto' ou 'receita' (opcional)" },
              category: { type: "STRING", description: "Nova categoria (opcional)" },
              description: { type: "STRING", description: "Nova descrição (opcional)" },
              amount: { type: "NUMBER", description: "Novo valor (opcional)" },
              paidBy: { type: "STRING", description: "Novo pagador (opcional)" },
              paymentMethod: { type: "STRING", description: "Nova forma de pagamento (opcional)" }
            },
            required: ["id"]
          }
        },
        {
          name: "excluirLancamento",
          description: "Solicita exclusão de um lançamento. Primeira chamada: informe o id (sem codigoConfirmacao) — isso apenas gera um código de 4 dígitos, sem excluir nada. Segunda chamada: informe SOMENTE o codigoConfirmacao que o usuário digitou.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "ID do lançamento. Obrigatório apenas na primeira chamada." },
              codigoConfirmacao: { type: "STRING", description: "Código de 4 dígitos. Na segunda chamada, envie só isso." }
            }
          }
        },
        {
          name: "criarOuAtualizarRegistro",
          description: "Cria um novo registro do Life Hub (meta, viagem, item de mercado ou manutenção) ou atualiza um existente (se 'id' for informado). Antes de criar, observe via consultarDados o formato de registros existentes do mesmo tipo em 'diarios_e_listas'.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "ID do registro a atualizar. Deixe vazio para criar um novo." },
              tipo: { type: "STRING", description: "Tipo do registro: 'meta', 'viagem', 'mercado' ou 'manutencao'" },
              dados: { type: "STRING", description: "Objeto JSON, como texto, com os campos do registro, seguindo o mesmo formato de registros existentes do mesmo tipo." }
            },
            required: ["tipo", "dados"]
          }
        },
        {
          name: "excluirRegistro",
          description: "Solicita exclusão de um registro do Life Hub. Primeira chamada: informe o id. Segunda chamada: informe SOMENTE o codigoConfirmacao digitado pelo usuário.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "ID do registro. Obrigatório apenas na primeira chamada." },
              codigoConfirmacao: { type: "STRING", description: "Código de 4 dígitos. Na segunda chamada, envie só isso." }
            }
          }
        }
      ]
    }];

    const chat = ai.chats.create({
      model: "gemini-3.5-flash-lite",
      config: {
        systemInstruction: systemInstruction,
        tools: tools
      },
      history: historyForGemini
    });

    let result = await chat.sendMessage({ message });
    let functionCall = result.functionCalls && result.functionCalls[0];
    let uiAction = null;

    while (functionCall) {
      const args = functionCall.args || {};
      let toolResponse = {};

      if (functionCall.name === 'consultarDados') {
        const txs = await readJSON(STORE, 'transactions.json', []);
        const settings = await readJSON(STORE, 'settings.json', {});
        const records = await readJSON(STORE, 'records.json', []);
        const resumoMensal = buildMonthlySummary(txs, settings);
        toolResponse = { resumoMensal, transacoes: txs, configuracoes: settings, diarios_e_listas: records };
      }

      else if (functionCall.name === 'criarLancamento') {
        const list = await readJSON(STORE, 'transactions.json', []);
        const newItem = {
          id: crypto.randomUUID(), ...args,
          status: 'aberto', createdBy: 'IA Assistente', createdAt: new Date().toISOString()
        };
        list.push(newItem);
        await writeJSON(STORE, 'transactions.json', list);
        await appendAudit(user, 'create', 'transaction', newItem.id, null, newItem);
        toolResponse = { sucesso: true, id: newItem.id };
        uiAction = 'RELOAD_DATA';
      }

      else if (functionCall.name === 'editarLancamento') {
        const list = await readJSON(STORE, 'transactions.json', []);
        const idx = list.findIndex(t => t.id === args.id);
        if (idx > -1) {
          const before = { ...list[idx] };
          const { id, ...changes } = args;
          list[idx] = { ...list[idx], ...changes, updatedAt: new Date().toISOString(), updatedBy: 'IA Assistente' };
          await writeJSON(STORE, 'transactions.json', list);
          await appendAudit(user, 'update', 'transaction', args.id, before, list[idx]);
          toolResponse = { sucesso: true, lancamento: list[idx] };
          uiAction = 'RELOAD_DATA';
        } else {
          toolResponse = { sucesso: false, erro: 'ID não encontrado' };
        }
      }

      else if (functionCall.name === 'excluirLancamento') {
        if (args.codigoConfirmacao) {
          const match = await resolveDeletionCode('transaction', args.codigoConfirmacao);
          if (!match) {
            toolResponse = { sucesso: false, erro: 'Código inválido ou expirado. Peça a exclusão de novo informando o item.' };
          } else {
            const list = await readJSON(STORE, 'transactions.json', []);
            const idx = list.findIndex(t => t.id === match.id);
            if (idx === -1) {
              toolResponse = { sucesso: false, erro: 'Lançamento não encontrado (já pode ter sido excluído antes).' };
            } else {
              const before = list[idx];
              list.splice(idx, 1);
              await writeJSON(STORE, 'transactions.json', list);
              await appendAudit(user, 'delete', 'transaction', match.id, before, null);
              toolResponse = { sucesso: true, mensagem: 'Excluído com sucesso' };
              uiAction = 'RELOAD_DATA';
            }
          }
        } else {
          const list = await readJSON(STORE, 'transactions.json', []);
          const idx = list.findIndex(t => t.id === args.id);
          if (idx === -1) {
            toolResponse = { sucesso: false, erro: 'ID não encontrado' };
          } else {
            const item = list[idx];
            toolResponse = await requestDeletionCode('transaction', args.id, {
              descricao: item.description, valor: item.amount, data: item.date
            });
          }
        }
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
          } else {
            toolResponse = { sucesso: false, erro: 'ID não encontrado' };
          }
        } else {
          const newRecord = {
            id: crypto.randomUUID(),
            type: args.tipo,
            ...dadosParsed,
            createdBy: 'IA Assistente',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
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
          if (!match) {
            toolResponse = { sucesso: false, erro: 'Código inválido ou expirado. Peça a exclusão de novo informando o item.' };
          } else {
            const list = await readJSON(STORE, 'records.json', []);
            const idx = list.findIndex(r => r.id === match.id);
            if (idx === -1) {
              toolResponse = { sucesso: false, erro: 'Registro não encontrado (já pode ter sido excluído antes).' };
            } else {
              const before = list[idx];
              const filtered = list.filter(r => r.id !== match.id);
              await writeJSON(STORE, 'records.json', filtered);
              await appendAudit(user, 'delete', 'record', match.id, before, null);
              toolResponse = { sucesso: true, mensagem: 'Excluído com sucesso' };
              uiAction = 'RELOAD_DATA';
            }
          }
        } else {
          const list = await readJSON(STORE, 'records.json', []);
          const idx = list.findIndex(r => r.id === args.id);
          if (idx === -1) {
            toolResponse = { sucesso: false, erro: 'ID não encontrado' };
          } else {
            toolResponse = await requestDeletionCode('record', args.id, list[idx]);
          }
        }
      }

      result = await chat.sendMessage({
        message: [{
          functionResponse: { name: functionCall.name, response: toolResponse }
        }]
      });
      functionCall = result.functionCalls && result.functionCalls[0];
    }

    // ---------- Persiste a troca na sessão ----------
    const now = new Date().toISOString();
    session.messages.push({ role: 'user', text: message, timestamp: now });
    session.messages.push({ role: 'model', text: result.text, timestamp: now });
    session.updatedAt = now;

    if (!session.title) {
      session.title = await generateTitle(ai, message, result.text);
    }

    await saveSessions(sessions);

    return Response.json({
      text: result.text,
      uiAction,
      chatId: session.id
    }, { status: 200, headers });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers });
  }
};
