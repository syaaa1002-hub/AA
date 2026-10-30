-- 맞춤 상품 추천 도구 테이블. 여러 번 실행해도 안전하다 (npm run seed가 자동 실행).

create table if not exists products (
  id             text primary key,
  name           text not null,
  category       text not null,
  price          integer not null check (price > 0),
  sale_price     integer check (sale_price is null or sale_price > 0),
  image          text not null default '',
  link           text not null default '',
  target_gender  text not null,
  target_ages    text not null,          -- 쉼표 구분 (예: 30대,40대)
  purposes       text not null,          -- 쉼표 구분 (예: 본인용,선물용)
  recommend_text text not null default '',
  stock          integer not null default 0 check (stock >= 0),
  memo           text not null default '',
  updated_at     timestamptz not null default now()
);

create table if not exists sales (
  product_id text not null references products(id) on delete cascade,
  week       text not null,              -- 예: 2026-W44
  gender     text not null,
  age_group  text not null,
  purpose    text not null,
  quantity   integer not null check (quantity >= 0),
  primary key (product_id, week, gender, age_group, purpose)
);
create index if not exists sales_week_idx on sales (week);

-- PIN 오류 잠금 (서버 인스턴스가 여러 개여도 함께 센다)
create table if not exists login_attempts (
  ip           text primary key,
  fail_count   integer not null default 0,
  locked_until timestamptz
);

-- Supabase 공개 API(anon/authenticated 키)로는 어떤 테이블도 읽고 쓸 수 없게 막는다.
-- 서버는 DATABASE_URL의 postgres 계정(테이블 소유자)으로 접속하므로 영향이 없다.
alter table products       enable row level security;
alter table sales          enable row level security;
alter table login_attempts enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on products, sales, login_attempts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on products, sales, login_attempts from authenticated;
  end if;
end $$;
