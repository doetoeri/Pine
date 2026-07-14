-- Pine 다기기 실시간 동기화 설정
-- Supabase Dashboard > SQL Editor에서 이 파일 전체를 한 번 실행하세요.

create extension if not exists pgcrypto;

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  category text not null check (category in ('학사', '행사', '동아리', '대회', '진로', '봉사', '기타')),
  summary text check (summary is null or char_length(summary) <= 500),
  organization text not null check (char_length(organization) between 1 and 50),
  location text check (location is null or char_length(location) <= 50),
  event_date date not null,
  image_url text,
  external_url text,
  tags text[] not null default '{}',
  popularity integer not null default 0 check (popularity >= 0),
  created_at timestamptz not null default now()
);

create index if not exists notices_created_at_idx on public.notices (created_at desc);
create index if not exists notices_event_date_idx on public.notices (event_date asc);
create index if not exists notices_category_idx on public.notices (category);

alter table public.notices enable row level security;

drop policy if exists "notices are publicly readable" on public.notices;
create policy "notices are publicly readable"
on public.notices for select
to anon, authenticated
using (true);

drop policy if exists "anyone can submit a notice" on public.notices;
create policy "anyone can submit a notice"
on public.notices for insert
to anon, authenticated
with check (
  char_length(title) between 1 and 80
  and char_length(organization) between 1 and 50
  and category in ('학사', '행사', '동아리', '대회', '진로', '봉사', '기타')
  and event_date >= current_date
  and cardinality(tags) <= 6
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'flyers',
  'flyers',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "flyers are publicly readable" on storage.objects;
create policy "flyers are publicly readable"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'flyers');

drop policy if exists "anyone can upload a flyer" on storage.objects;
create policy "anyone can upload a flyer"
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'flyers'
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);

-- Realtime publication에 이미 포함된 경우 발생하는 중복 오류를 피합니다.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notices'
  ) then
    alter publication supabase_realtime add table public.notices;
  end if;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert on table public.notices to anon, authenticated;
