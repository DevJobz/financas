const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const { readJSON, writeJSON } = require('./_shared/blobStore');
const { verifyToken, cors } = require('./_shared/authMiddleware');

const STORE = 'financas';

async function appendAudit(user, action, entity, entityId, before, after) {
  const log = await readJSON(STORE, 'audit.json', []);
  log.unshift({
    id: crypto.randomUUID(), timestamp: new Date().toISOString(),
    userId: user.sub, userName: user.name, action, entity, entityId, before, after,
  });
  await writeJSON(STORE, 'audit.json', log.slice(0, 1000));
}

exports.handler = async (event) => {
  const headers = cors();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const user = verifyToken(event);
  if (!user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autenticado' }) };

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };

  try {
    const { message, history } = JSON.parse(event.body);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Instruções rigorosas de comportamento e segurança usando variáveis de ambiente
    const u1 = process.env.USER1_NAME || 'Pessoa 1';
    const u2 = process.env.USER2_NAME || 'Pessoa 2';

    const systemInstruction = `Você é o assistente financeiro integrado do casal ${u1} e ${u2}. 
    Seu papel é analisar dados, responder dúvidas e automatizar lançamentos de forma amigável.
    REGRA DE OURO 1: Você NUNCA deve executar a função de excluir sem antes perguntar explicitamente ao usuário e receber um "sim" de confirmação.
    REGRA DE OURO 2: Se o usuário pedir um resumo ou perguntar sobre gastos, sempre chame a função consultarDados para ler a base de dados atualizada antes de responder.
    REGRA DE OURO 3: Seja claro, verdadeiro e amigável. Formate valores monetários sempre em R$.`;

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

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction, tools });
    const chat = model.startChat({ history: history || [] });
    
    let result = await chat.sendMessage(message);
    let functionCall = result.response.functionCalls && result.response.functionCalls()[0];
    let uiAction = null; // Para avisar o frontend para recarregar a tela

    // Se o Gemini decidir que precisa de uma ferramenta, nós executamos aqui
    if (functionCall) {
      const args = functionCall.args;
      let toolResponse = {};

      if (functionCall.name === 'consultarDados') {
        const txs = await readJSON(STORE, 'transactions.json', []);
        const settings = await readJSON(STORE, 'settings.json', {});
        toolResponse = { transacoes: txs, configuracoes: settings };
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

      // Devolvemos o resultado para o Gemini gerar a resposta final em português
      result = await chat.sendMessage([{
        functionResponse: { name: functionCall.name, response: toolResponse }
      }]);
    }

    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ 
        text: result.response.text(), 
        uiAction 
      }) 
    };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
