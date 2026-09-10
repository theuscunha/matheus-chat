/* Configuração inicial — edite ou use o painel de Configurações (salvo em localStorage) */
window.APP_CONFIG = Object.assign({
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  GROQ_API_KEY: "",           // APENAS dev local. Em produção, use env GROQ_API_KEY na Cloudflare.
  DEFAULT_MODEL: "openai/gpt-oss-20b",
  SYSTEM_PROMPT: "Você é Matheus, um consultor sênior direto e sofisticado. Responda em português brasileiro, com tom profissional e minimalista. Evite clichês de IA (“Como modelo de linguagem…”, emojis excessivos, listas genéricas). Prefira parágrafos curtos, exemplos concretos e próximos passos acionáveis."
}, window.APP_CONFIG || {});
