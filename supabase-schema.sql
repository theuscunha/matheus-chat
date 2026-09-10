-- ============================================================
-- Supabase — esquema de memória do chatbot
-- Como aplicar: Supabase Dashboard → SQL Editor → New query → colar → Run
-- ============================================================

-- Conversas
create table if not exists public.conversations (
  id uuid primary key,
  title text not null default 'Nova conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mensagens
create table if not exists public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_conv on public.messages(conversation_id, created_at);
create index if not exists idx_conversations_updated on public.conversations(updated_at desc);

-- Atualiza updated_at automaticamente
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_conversations on public.conversations;
create trigger trg_touch_conversations
  before update on public.conversations
  for each row execute function public.touch_updated_at();

-- RLS: habilita e libera acesso ao anon key (adequado para demo sem login).
-- Para produção com login, troque por policies com auth.uid().
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "public all conversations" on public.conversations;
create policy "public all conversations" on public.conversations
  for all using (true) with check (true);

drop policy if exists "public all messages" on public.messages;
create policy "public all messages" on public.messages
  for all using (true) with check (true);
