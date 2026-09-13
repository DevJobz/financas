import { readJSON, writeJSON } from './_shared/blobStore.js';
import { verifyToken, cors } from './_shared/authMiddleware.js';

const STORE = 'financas';

function summarize(session) {
  const last = session.messages[session.messages.length - 1];
  return {
    id: session.id,
    title: session.title || 'Nova conversa',
    updatedAt: session.updatedAt,
    preview: last ? String(last.text || '').slice(0, 80) : ''
  };
}

export default async (req) => {
  const headers = cors();
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers });

  const user = verifyToken({ headers: Object.fromEntries(req.headers) });
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401, headers });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  let sessions = await readJSON(STORE, 'chat_sessions.json', []);

  if (req.method === 'GET') {
    if (id) {
      const session = sessions.find(s => s.id === id);
      if (!session) return Response.json({ error: 'Conversa não encontrada' }, { status: 404, headers });
      return Response.json(session, { status: 200, headers });
    }
    const list = sessions
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map(summarize);
    return Response.json(list, { status: 200, headers });
  }

  if (req.method === 'DELETE') {
    if (!id) return Response.json({ error: 'id é obrigatório' }, { status: 400, headers });
    sessions = sessions.filter(s => s.id !== id);
    await writeJSON(STORE, 'chat_sessions.json', sessions);
    return Response.json({ sucesso: true }, { status: 200, headers });
  }

  if (req.method === 'PATCH') {
    // Renomear uma conversa manualmente (opcional, o front pode usar isso se quiser deixar editar o título)
    if (!id) return Response.json({ error: 'id é obrigatório' }, { status: 400, headers });
    const { title } = await req.json();
    const session = sessions.find(s => s.id === id);
    if (!session) return Response.json({ error: 'Conversa não encontrada' }, { status: 404, headers });
    session.title = title;
    await writeJSON(STORE, 'chat_sessions.json', sessions);
    return Response.json({ sucesso: true }, { status: 200, headers });
  }

  return Response.json({ error: 'Método não permitido' }, { status: 405, headers });
};