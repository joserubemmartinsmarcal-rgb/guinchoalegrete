// GF · envio dos avisos ao celular (Web Push).
// Chamada só pelo banco (gf__avisar, via pg_net) com o cabeçalho x-gf-segredo.
// Segredos (Supabase → Edge Functions → Secrets): GF_AVISOS_SEGREDO, GF_VAPID_PUBLICA,
// GF_VAPID_PRIVADA, GF_VAPID_CONTATO (ex.: mailto:contato@appdoguincheiro.com).
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em toda Edge Function.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => Deno.env.get(k) ?? '';
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

function iguais(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { error: 'Use POST.' });
  if (!iguais(req.headers.get('x-gf-segredo') ?? '', env('GF_AVISOS_SEGREDO'))) return resposta(401, { error: 'Não autorizado.' });
  let avisoId = '';
  try { avisoId = String((await req.json()).aviso_id ?? ''); } catch { /* corpo inválido */ }
  if (!/^[0-9a-f-]{36}$/.test(avisoId)) return resposta(400, { error: 'aviso_id inválido.' });

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: aviso, error } = await sb.from('gf_avisos').select('id,user_id,tipo,titulo,corpo,url,enviado_em').eq('id', avisoId).maybeSingle();
  if (error) return resposta(500, { error: 'Falha ao ler o aviso.' });
  if (!aviso) return resposta(404, { error: 'Aviso não encontrado.' });
  if (aviso.enviado_em) return resposta(200, { aparelhos: 0, repetido: true });

  const { data: aparelhos } = await sb.from('gf_push').select('endpoint,p256dh,auth').eq('user_id', aviso.user_id);
  webpush.setVapidDetails(env('GF_VAPID_CONTATO') || 'mailto:contato@appdoguincheiro.com', env('GF_VAPID_PUBLICA'), env('GF_VAPID_PRIVADA'));
  const conteudo = JSON.stringify({ id: aviso.id, title: aviso.titulo, body: aviso.corpo ?? '', url: '/app' + (aviso.url ?? '#avisos'), tag: aviso.tipo });

  let enviados = 0;
  for (const a of aparelhos ?? []) {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, conteudo, { TTL: 60 * 60 * 24 });
      enviados++;
    } catch (e) {
      const codigo = (e as { statusCode?: number }).statusCode;
      if (codigo === 404 || codigo === 410) await sb.from('gf_push').delete().eq('endpoint', a.endpoint); // aparelho desinscrito
    }
  }
  if (enviados) await sb.from('gf_avisos').update({ enviado_em: new Date().toISOString() }).eq('id', aviso.id);
  return resposta(200, { aparelhos: enviados });
});
