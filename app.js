/* ============================================================
   Matheus Chat — frontend vanilla
   - Conversas + mensagens persistidas no Supabase (fallback local)
   - Respostas via Groq gpt-oss (proxy /api/chat na Cloudflare,
     ou direto via GROQ_API_KEY no modo local)
   - Streaming SSE com efeito de digitação
   ============================================================ */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const chatScroll = $("#chatScroll"), chatInner = $("#chatInner"), hero = $("#hero");
  const input = $("#input"), sendBtn = $("#sendBtn"), stopBtn = $("#stopBtn");
  const convList = $("#convList"), searchInput = $("#searchInput");
  const chatTitle = $("#chatTitle"), chatMeta = $("#chatMeta");
  const modelSelect = $("#modelSelect");
  const sidebar = $("#sidebar"), scrim = $("#scrim");

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
    raw(k) { return localStorage.getItem(k) || ""; }
  };

  const cfg = {
    get supabaseUrl() { return store.raw("cfg_supabase_url") || (window.APP_CONFIG?.SUPABASE_URL || ""); },
    get supabaseKey() { return store.raw("cfg_supabase_key") || (window.APP_CONFIG?.SUPABASE_ANON_KEY || ""); },
    get groqKey() { return store.raw("cfg_groq_key") || (window.APP_CONFIG?.GROQ_API_KEY || ""); },
    get system() { return store.raw("cfg_system") || (window.APP_CONFIG?.SYSTEM_PROMPT || ""); },
    get model() { return store.raw("cfg_model") || (window.APP_CONFIG?.DEFAULT_MODEL || "openai/gpt-oss-20b"); }
  };

  let sb = null;               // supabase client
  let conversations = [];      // {id,title,created_at,updated_at}
  let activeId = null;
  let messages = [];           // mensagens da conversa ativa
  let aborter = null;
  let sending = false;

  /* ---------------- utils ---------------- */
  function toast(msg, err = false) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, 2800);
  }
  function uid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); }
  function esc(s) { return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function renderMarkdown(src) {
    try {
      const html = marked.parse(src || "", { breaks: true });
      return DOMPurify.sanitize(html);
    } catch { return "<p>" + esc(src || "") + "</p>"; }
  }
  function scrollBottom(force) {
    const nearBottom = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 220;
    if (force || nearBottom) chatScroll.scrollTop = chatScroll.scrollHeight;
  }
  function timeAgo(iso) {
    const d = new Date(iso), now = new Date();
    const s = Math.floor((now - d) / 1000);
    if (s < 60) return "agora";
    if (s < 3600) return Math.floor(s / 60) + " min";
    if (s < 86400) return Math.floor(s / 3600) + " h";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  /* ---------------- Supabase / storage ---------------- */
  function initSupabase() {
    sb = null;
    if (cfg.supabaseUrl && cfg.supabaseKey && window.supabase) {
      try {
        sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      } catch (e) { console.warn("Supabase init falhou:", e); sb = null; }
    }
    updateStatus();
  }
  function updateStatus() {
    const dot = $("#statusDot"), title = $("#statusTitle"), sub = $("#statusSub");
    if (sb) { dot.classList.add("on"); title.textContent = "Supabase conectado"; sub.textContent = "Memória persistente ativa"; }
    else { dot.classList.remove("on"); title.textContent = "Memória local"; sub.textContent = "Conecte o Supabase"; }
  }

  async function dbListConversations() {
    if (sb) {
      const { data, error } = await sb.from("conversations").select("*").order("updated_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    }
    return store.get("local_conversations", []);
  }
  async function dbCreateConversation(title) {
    const row = { id: uid(), title: title || "Nova conversa", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (sb) {
      const { error } = await sb.from("conversations").insert(row);
      if (error) throw error;
    } else {
      const all = store.get("local_conversations", []);
      all.unshift(row); store.set("local_conversations", all);
    }
    return row;
  }
  async function dbUpdateConversation(id, patch) {
    if (sb) {
      const { error } = await sb.from("conversations").update(patch).eq("id", id);
      if (error) throw error;
    } else {
      const all = store.get("local_conversations", []);
      const i = all.findIndex(c => c.id === id);
      if (i >= 0) { all[i] = { ...all[i], ...patch }; store.set("local_conversations", all); }
    }
  }
  async function dbDeleteConversation(id) {
    if (sb) {
      await sb.from("messages").delete().eq("conversation_id", id);
      const { error } = await sb.from("conversations").delete().eq("id", id);
      if (error) throw error;
    } else {
      store.set("local_conversations", store.get("local_conversations", []).filter(c => c.id !== id));
      const m = store.get("local_messages", {});
      delete m[id]; store.set("local_messages", m);
    }
  }
  async function dbListMessages(convId) {
    if (sb) {
      const { data, error } = await sb.from("messages").select("*").eq("conversation_id", convId).order("created_at", { ascending: true }).limit(500);
      if (error) throw error;
      return data;
    }
    return (store.get("local_messages", {})[convId] || []);
  }
  async function dbInsertMessage(convId, role, content) {
    const row = { id: uid(), conversation_id: convId, role, content, created_at: new Date().toISOString() };
    if (sb) {
      const { error } = await sb.from("messages").insert(row);
      if (error) throw error;
    } else {
      const m = store.get("local_messages", {});
      (m[convId] = m[convId] || []).push(row);
      store.set("local_messages", m);
    }
    return row;
  }

  /* ---------------- UI: lista de conversas ---------------- */
  function paintList(filter = "") {
    convList.innerHTML = "";
    const f = filter.trim().toLowerCase();
    const items = conversations.filter(c => !f || (c.title || "").toLowerCase().includes(f));
    if (!items.length) {
      convList.innerHTML = `<div class="conv-empty">Nenhuma conversa encontrada.<br>Clique em <b>Nova conversa</b> para começar.</div>`;
      return;
    }
    items.forEach(c => {
      const b = document.createElement("div");
      b.className = "conv-item" + (c.id === activeId ? " active" : "");
      b.innerHTML = `<span class="t">${esc(c.title || "Sem título")}</span>
        <span class="d"><span>${timeAgo(c.updated_at || c.created_at)}</span>
        <span class="row">
          <button class="mini-btn" data-act="rename" title="Renomear">✎</button>
          <button class="mini-btn" data-act="del" title="Excluir">🗑</button>
        </span></span>`;
      b.onclick = (e) => {
        const act = e.target.dataset?.act;
        if (act === "del") { e.stopPropagation(); deleteConversation(c.id); return; }
        if (act === "rename") { e.stopPropagation(); renameConversation(c.id); return; }
        openConversation(c.id);
      };
      convList.appendChild(b);
    });
  }

  async function refreshConversations() {
    try { conversations = await dbListConversations(); }
    catch (e) { console.warn(e); toast("Falha ao carregar conversas: " + e.message, true); conversations = []; }
    paintList(searchInput.value);
  }

  async function deleteConversation(id) {
    if (!confirm("Excluir esta conversa e todo o histórico?")) return;
    await dbDeleteConversation(id);
    if (activeId === id) { activeId = null; messages = []; paintChat(); }
    await refreshConversations();
    if (!conversations.length) startNewChat();
    toast("Conversa excluída.");
  }
  async function renameConversation(id) {
    const c = conversations.find(x => x.id === id);
    const name = prompt("Renomear conversa:", c?.title || "");
    if (!name) return;
    await dbUpdateConversation(id, { title: name.slice(0, 80), updated_at: new Date().toISOString() });
    await refreshConversations();
    if (id === activeId) chatTitle.textContent = name.slice(0, 80);
  }

  /* ---------------- UI: chat ---------------- */
  function paintChat() {
    // limpa mensagens (mantém hero se vazio)
    chatInner.querySelectorAll(".msg").forEach(n => n.remove());
    const has = messages.length > 0;
    hero.style.display = has ? "none" : "";
    messages.forEach(m => appendBubble(m.role, m.content, false));
    const active = conversations.find(c => c.id === activeId);
    chatTitle.textContent = active?.title || "Nova conversa";
    chatMeta.textContent = has ? `${messages.length} mensagens · ${cfg.model.replace("openai/", "")}` : "Pronto para começar";
    scrollBottom(true);
  }

  function appendBubble(role, content, animate = true) {
    hero.style.display = "none";
    const wrap = document.createElement("div");
    wrap.className = "msg " + (role === "user" ? "user" : "assistant");
    if (!animate) wrap.style.animation = "none";
    const avatar = role === "user" ? "Você" : "M";
    wrap.innerHTML = `
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-body">
        <div class="msg-label">${role === "user" ? "Você" : "Matheus · IA"}</div>
        <div class="bubble">${renderMarkdown(content)}</div>
        <div class="msg-actions">
          <button class="mini-btn" data-copy>Copiar</button>
        </div>
      </div>`;
    wrap.querySelector("[data-copy]").onclick = () => {
      navigator.clipboard.writeText(content).then(() => toast("Copiado."));
    };
    chatInner.appendChild(wrap);
    scrollBottom(true);
    return wrap;
  }

  function appendStreamingShell() {
    hero.style.display = "none";
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    wrap.innerHTML = `
      <div class="msg-avatar">M</div>
      <div class="msg-body">
        <div class="msg-label">Matheus · IA</div>
        <div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>
      </div>`;
    chatInner.appendChild(wrap);
    scrollBottom(true);
    return wrap;
  }

  /* ---------------- Groq via proxy / direto ---------------- */
  async function callGroq(history, onToken) {
    aborter = new AbortController();
    const body = {
      model: modelSelect.value || cfg.model,
      messages: [{ role: "system", content: cfg.system }, ...history.map(m => ({ role: m.role, content: m.content }))],
      temperature: 0.7,
      max_tokens: 2048,
      stream: true
    };

    // 1) Tenta o proxy da Cloudflare (/api/chat) — funciona em produção sem expor chave
    const tryProxy = async () => {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: aborter.signal
      });
      // 404 = rodando localmente sem functions → cai para modo direto
      if (r.status === 404) throw new Error("NO_PROXY");
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t.slice(0, 300) || ("Proxy retornou " + r.status));
      }
      return r;
    };

    // 2) Modo direto (dev local com chave no painel)
    const tryDirect = async () => {
      if (!cfg.groqKey) throw new Error("Configure a Groq API Key em Configurações (ou publique na Cloudflare com GROQ_API_KEY).");
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.groqKey },
        body: JSON.stringify(body),
        signal: aborter.signal
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error("Groq " + r.status + ": " + t.slice(0, 300));
      }
      return r;
    };

    let res;
    try { res = await tryProxy(); }
    catch (e) {
      if (e.message === "NO_PROXY" || String(e.message).includes("Failed to fetch")) res = await tryDirect();
      else throw e;
    }

    // Lê SSE (stream) ou JSON (fallback)
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream")) {
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content || "(resposta vazia)";
      onToken(text, true);
      return text;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = "", buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const p of parts) {
        const line = p.trim().split("\n").find(l => l.startsWith("data:"));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content || "";
          if (delta) { full += delta; onToken(full, false); }
        } catch { /* ignora keep-alive */ }
      }
    }
    onToken(full, true);
    return full;
  }

  /* ---------------- envio ---------------- */
  async function ensureConversation() {
    if (activeId) return activeId;
    const row = await dbCreateConversation("Nova conversa");
    conversations.unshift(row);
    activeId = row.id;
    paintList(searchInput.value);
    return activeId;
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text || sending) return;
    sending = true;
    sendBtn.disabled = true;
    stopBtn.classList.remove("hidden");

    try {
      const convId = await ensureConversation();
      input.value = ""; autoGrow();

      appendBubble("user", text);
      messages.push({ role: "user", content: text });
      await dbInsertMessage(convId, "user", text);

      // título automático na primeira mensagem
      if (messages.length === 1) {
        const title = text.length > 48 ? text.slice(0, 48) + "…" : text;
        await dbUpdateConversation(convId, { title, updated_at: new Date().toISOString() });
        conversations = conversations.map(c => c.id === convId ? { ...c, title } : c);
        paintList(searchInput.value);
        chatTitle.textContent = title;
      }

      const shell = appendStreamingShell();
      const bubble = shell.querySelector(".bubble");
      let first = true;

      const history = messages.slice(-20); // janela de contexto
      const finalText = await callGroq(history, (partial, done) => {
        if (first && partial) first = false;
        bubble.innerHTML = renderMarkdown(partial) + (done ? "" : '<span class="caret"></span>');
        scrollBottom(false);
      });

      // troca o shell por bolha final com ação de copiar
      shell.remove();
      appendBubble("assistant", finalText || "(sem resposta)");
      messages.push({ role: "assistant", content: finalText });
      await dbInsertMessage(convId, "assistant", finalText);
      await dbUpdateConversation(convId, { updated_at: new Date().toISOString() });
      await refreshConversations();
      // mantém a conversa ativa selecionada após refresh
      activeId = convId;
      paintList(searchInput.value);
      chatMeta.textContent = `${messages.length} mensagens · ${modelSelect.value.replace("openai/", "")}`;
    } catch (e) {
      if (e.name === "AbortError") { toast("Geração interrompida."); }
      else { console.error(e); toast("Erro: " + e.message, true); appendBubble("assistant", "⚠️ " + esc(e.message)); }
    } finally {
      sending = false;
      sendBtn.disabled = false;
      stopBtn.classList.add("hidden");
      aborter = null;
    }
  }

  async function openConversation(id) {
    activeId = id;
    try { messages = await dbListMessages(id); }
    catch (e) { toast("Falha ao abrir conversa.", true); messages = []; }
    paintList(searchInput.value);
    paintChat();
    closeSidebarMobile();
  }

  function startNewChat() {
    activeId = null; messages = [];
    paintList(searchInput.value);
    paintChat();
    input.focus();
    closeSidebarMobile();
  }

  /* ---------------- eventos ---------------- */
  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  sendBtn.onclick = () => send(input.value);
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  stopBtn.onclick = () => aborter?.abort();

  $("#newChatBtn").onclick = startNewChat;
  searchInput.oninput = () => paintList(searchInput.value);
  modelSelect.onchange = () => { store.set("cfg_model", modelSelect.value); paintChat(); };

  document.querySelectorAll(".chip").forEach(ch => {
    ch.onclick = () => { input.value = ch.dataset.prompt; autoGrow(); input.focus(); };
  });

  $("#exportBtn").onclick = () => {
    if (!messages.length) return toast("Nada para exportar.");
    const title = chatTitle.textContent || "conversa";
    const md = `# ${title}\n\n` + messages.map(m => `**${m.role === "user" ? "Você" : "Matheus"}:**\n${m.content}\n`).join("\n---\n\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = title.toLowerCase().replace(/[^a-z0-9]+/gi, "-") + ".md";
    a.click();
    toast("Conversa exportada.");
  };

  // tema
  const themeBtn = $("#themeBtn");
  function applyTheme(t) { document.documentElement.dataset.theme = t; store.set("theme", t); }
  themeBtn.onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  applyTheme(store.get("theme", "light"));

  // sidebar mobile
  function closeSidebarMobile() { sidebar.classList.remove("open"); scrim.classList.remove("show"); }
  $("#menuBtn").onclick = () => { sidebar.classList.add("open"); scrim.classList.add("show"); };
  $("#sidebarClose").onclick = closeSidebarMobile;
  scrim.onclick = closeSidebarMobile;

  // settings modal
  const modal = $("#settingsModal");
  const openSettings = () => {
    $("#cfgSupabaseUrl").value = cfg.supabaseUrl;
    $("#cfgSupabaseKey").value = cfg.supabaseKey;
    $("#cfgGroqKey").value = cfg.groqKey;
    $("#cfgSystem").value = cfg.system;
    modal.classList.add("open");
  };
  $("#settingsBtn").onclick = openSettings;
  $("#settingsClose").onclick = () => modal.classList.remove("open");
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });
  $("#cfgSave").onclick = async () => {
    localStorage.setItem("cfg_supabase_url", $("#cfgSupabaseUrl").value.trim());
    localStorage.setItem("cfg_supabase_key", $("#cfgSupabaseKey").value.trim());
    localStorage.setItem("cfg_groq_key", $("#cfgGroqKey").value.trim());
    localStorage.setItem("cfg_system", $("#cfgSystem").value.trim());
    modal.classList.remove("open");
    initSupabase();
    await refreshConversations();
    toast(sb ? "Conectado ao Supabase." : "Salvo. Usando memória local.");
  };
  $("#cfgClear").onclick = () => {
    if (!confirm("Apagar conversas locais e configurações?")) return;
    Object.keys(localStorage).filter(k => k.startsWith("local_") || k.startsWith("cfg_")).forEach(k => localStorage.removeItem(k));
    location.reload();
  };

  /* ---------------- boot ---------------- */
  (async function boot() {
    modelSelect.value = cfg.model;
    initSupabase();
    await refreshConversations();
    paintChat();
    autoGrow();
  })();
})();
