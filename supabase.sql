-- NS Embalagens · base sincronizada
-- Execute uma única vez no Supabase > SQL Editor.

create table if not exists public.ns_embalagens_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.ns_embalagens_state enable row level security;

-- Não criamos política pública. O navegador nunca recebe a Service Role Key.
-- A API da Vercel acessa esta tabela com SUPABASE_SERVICE_ROLE_KEY.
