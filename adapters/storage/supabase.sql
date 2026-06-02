-- auto-geo Supabase table.
-- Run once in your Supabase SQL editor before using `createSupabaseStore`.

create table if not exists auto_geo_resources (
  slug          text primary key,
  payload       jsonb not null,
  published_at  timestamptz not null,
  stored_at     timestamptz not null default now()
);

create index if not exists auto_geo_resources_published_at_idx
  on auto_geo_resources (published_at desc);

-- Optional: if you want public reads via the anon key, enable RLS and
-- add a SELECT policy. The service-role key bypasses RLS, so the
-- publish adapter (using service-role) is unaffected.
--
-- alter table auto_geo_resources enable row level security;
-- create policy "Public read" on auto_geo_resources for select using (true);
