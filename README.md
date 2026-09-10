# Matheus — Inteligência Aplicada

Chatbot profissional, minimalista e sofisticado. HTML + CSS + JS puros, com:

- **IA:** Groq `openai/gpt-oss-20b` (rápido) / `openai/gpt-oss-120b` (profundo), com streaming em tempo real
- **Memória:** Supabase (`conversations` + `messages`), com fallback para memória local
- **Hospedagem:** Cloudflare Pages + Functions (proxy seguro `/api/chat`)
- **Design:** editorial, papel quente + verde-biblioteca + latão, Fraunces + Inter, animações sutis

## 1. Estrutura

```
index.html              → layout (sidebar + chat + modal)
styles.css              → design system + animações + responsivo
app.js                  → Supabase + Groq + streaming + UI
config.js               → valores padrão (URL Supabase, modelo, system prompt)
functions/api/chat.js   → proxy Cloudflare → Groq (mantém a API key no servidor)
supabase-schema.sql     → tabelas + RLS
wrangler.toml           → config Cloudflare
```

## 2. Configurar o Supabase (5 min)

1. Crie um projeto em https://supabase.com → **Settings → API** e anote:
   - `Project URL` → `SUPABASE_URL`
   - `anon public key` → `SUPABASE_ANON_KEY`
2. Vá em **SQL Editor → New query**, cole o conteúdo de `supabase-schema.sql` e clique em **Run**.
3. Abra o site, clique na **engrenagem → Configurações** e preencha URL + chave → **Salvar e conectar**.
   - O ponto verde “Supabase conectado” confirma a memória persistente.

> Sem Supabase configurado, o app funciona com memória local (localStorage).

## 3. Rodar localmente

```powershell
# qualquer servidor estático; exemplo com Python:
python -m http.server 5500
# abra http://localhost:5500
```

Para testar a IA localmente, informe a **Groq API Key** (`gsk_…` de https://console.groq.com/keys)
no painel de Configurações. Em produção, **não** exponha a chave: use o proxy.

## 4. Publicar na Cloudflare (recomendado)

**Via dashboard (mais simples):**

1. Suba esta pasta para um repositório GitHub.
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build command: *(vazio)* · Output directory: `/`.
4. Em **Settings → Environment variables**, adicione o secret:
   - `GROQ_API_KEY = gsk_…` (marque **Encrypt**; adicione em Production + Preview).
5. **Retry deployment**. O frontend chamará automaticamente `POST /api/chat`
   (arquivo `functions/api/chat.js`), sem expor sua chave.

**Via CLI:**

```bash
npm i -g wrangler
wrangler pages deploy ./ --project-name matheus-chat
wrangler pages secret put GROQ_API_KEY --project-name matheus-chat
```

## 5. Personalização

- **Modelo:** seletor no topo (`gpt-oss 20B` rápido · `120B` profundo).
- **Personalidade:** Configurações → *Instrução de sistema*.
- **Tema:** botão de lua/sol na barra lateral (claro/escuro).
- **Cores/fontes:** variáveis CSS em `:root` no `styles.css`.

## 6. Segurança

- A Groq key **nunca** vai no código em produção — fica como secret `GROQ_API_KEY` na Cloudflare.
- As policies RLS do `supabase-schema.sql` são abertas (demo sem login). Com autenticação,
  restrinja por `auth.uid()` e adicione uma coluna `user_id`.
