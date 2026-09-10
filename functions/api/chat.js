// Cloudflare Pages Function — proxy seguro para a Groq.
// Rota: POST /api/chat
// A chave GROQ_API_KEY fica como variável de ambiente (secret) na Cloudflare,
// nunca exposta no frontend.
//
// Deploy (Pages): conecte o repositório, build = nenhum (site estático),
// output = "/". Depois: Settings → Environment variables → GROQ_API_KEY.

const ALLOWED_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);

export async function onRequestPost({ request, env }) {
  try {
    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "GROQ_API_KEY não configurada na Cloudflare (Settings → Environment variables)." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body?.messages?.length) {
      return Response.json({ error: "Campo 'messages' é obrigatório." }, { status: 400 });
    }

    const model = ALLOWED_MODELS.has(body.model) ? body.model : "openai/gpt-oss-20b";

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: body.messages.slice(-30),
        temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
        max_tokens: Math.min(body.max_tokens || 2048, 8192),
        stream: true,
      }),
    });

    if (!groqRes.ok || !groqRes.body) {
      const text = await groqRes.text().catch(() => "");
      return Response.json(
        { error: `Groq retornou ${groqRes.status}: ${text.slice(0, 400)}` },
        { status: 502 }
      );
    }

    // Repassa o stream SSE diretamente ao navegador
    return new Response(groqRes.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
