/* Configuração inicial — o usuário comum NÃO vê estes valores.
   Supabase/Groq ficam na aba Administração (protegida por senha).
   Em produção, a GROQ_API_KEY vai como secret na Cloudflare. */
window.APP_CONFIG = Object.assign({
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  GROQ_API_KEY: "",
  ADMIN_PASSWORD: "ina-admin-2026", // TROQUE antes de publicar!
  DEFAULT_MODEL: "openai/gpt-oss-20b",
  SYSTEM_PROMPT: "Você é o INA (Inteligência não Artificial), um consultor sênior direto e sofisticado. Responda em português brasileiro, com tom profissional e minimalista. Evite clichês de IA (“Como modelo de linguagem…”, emojis excessivos, listas genéricas). Prefira parágrafos curtos, exemplos concretos e próximos passos acionáveis."
}, window.APP_CONFIG || {});
