import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { readJSON, writeJSON } from './_shared/blobStore.js';
import { verifyToken, cors } from './_shared/authMiddleware.js';

const STORE = 'financas';

async function appendAudit(user, action, entity, entityId, before, after) {
  const log = await readJSON(STORE, 'audit.json', []);
  log.unshift({
    id: crypto.randomUUID(), timestamp: new Date().toISOString(),
    userId: user.sub, userName: user.name, action, entity, entityId, before, after,
  });
  await writeJSON(STORE, 'audit.json', log.slice(0, 1000));
}

export default async (req) => {
  const headers = cors();
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers });

  const user = verifyToken({ headers: Object.fromEntries(req.headers) });
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401, headers });
  if (req.method !== 'POST') return Response.json({ error: 'Método não permitido' }, { status: 405, headers });

  try {
    const { message, history } = await req.json();

    // NOVO: Instanciação do SDK atualizado
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const u1 = process.env.USER1_NAME || 'Pessoa 1';
    const u2 = process.env.USER2_NAME || 'Pessoa 2';

    const systemInstruction = `Você é o assistente financeiro e organizador de vida do casal ${u1} e ${u2}.
    Seu papel é analisar os dados financeiros e ajudar na gestão do "Life Hub" (Viagens, Metas, Mercado e Manutenções).
    REGRA DE OURO 1: Você NUNCA deve executar exclusões sem confirmação explícita.
    REGRA DE OURO 2: Se o usuário pedir planejamento de viagem, perguntar sobre o progresso das metas, ou checar o mercado, chame a função consultarDados para ler a base atualizada (objeto 'diarios_e_listas').
    REGRA DE OURO 3: Você pode sugerir de forma proativa se o casal consegue atingir uma Meta cruzando o "Saldo Restante" do mês com o valor faltante da meta.
    REGRA DE OURO 4: Seja claro, analítico, verdadeiro e amigável. Formate valores monetários sempre em R$.`;

    const tools = [{
      functionDeclarations: [
        {
          name: "consultarDados",
          description: "Retorna todos os lançamentos financeiros, categorias e pessoas configuradas no sistema para você basear suas respostas."
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
          name: "excluirLancamento",
          description: "Exclui um lançamento do banco de dados. Exige confirmação prévia no chat.",
          parameters: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "ID do lançamento a ser excluído" }
            },
            required: ["id"]
          }
        }
      ]
    }];

    // NOVO: Estrutura do chat via ai.chats.create
    const chat = ai.chats.create({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: systemInstruction,
        tools: tools
      },
      history: history || []
    });

    let result = await chat.sendMessage({ message });
    // NOVO: functionCalls agora é uma propriedade direta, não uma função invocável
    let functionCall = result.functionCalls && result.functionCalls[0];
    let uiAction = null;

    if (functionCall) {
      const args = functionCall.args;
      let toolResponse = {};

      if (functionCall.name === 'consultarDados') {
        const txs = await readJSON(STORE, 'transactions.json', []);
        const settings = await readJSON(STORE, 'settings.json', {});
        const records = await readJSON(STORE, 'records.json', []);
        toolResponse = { transacoes: txs, configuracoes: settings, diarios_e_listas: records };
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

      else if (functionCall.name === 'excluirLancamento') {
        const list = await readJSON(STORE, 'transactions.json', []);
        const idx = list.findIndex(t => t.id === args.id);
        if (idx > -1) {
          const before = list[idx];
          list.splice(idx, 1);
          await writeJSON(STORE, 'transactions.json', list);
          await appendAudit(user, 'delete', 'transaction', args.id, before, null);
          toolResponse = { sucesso: true, mensagem: 'Excluído com sucesso' };
          uiAction = 'RELOAD_DATA';
        } else {
          toolResponse = { sucesso: false, erro: 'ID não encontrado' };
        }
      }

      // NOVO: Envio da resposta da ferramenta no novo formato
      result = await chat.sendMessage({
        message: [{
          functionResponse: { name: functionCall.name, response: toolResponse }
        }]
      });
    }

    return Response.json({
      text: result.text, // NOVO: 'text' é uma propriedade e não mais .text()
      uiAction
    }, { status: 200, headers });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers });
  }
};