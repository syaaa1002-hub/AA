// SQLite 연결, 테이블 생성, 상품·판매 데이터 공통 검증 함수
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  price          INTEGER NOT NULL,
  sale_price     INTEGER,
  image          TEXT NOT NULL DEFAULT '',
  link           TEXT NOT NULL DEFAULT '',
  target_gender  TEXT NOT NULL,
  target_ages    TEXT NOT NULL,
  purposes       TEXT NOT NULL,
  recommend_text TEXT NOT NULL DEFAULT '',
  stock          INTEGER NOT NULL DEFAULT 0,
  memo           TEXT NOT NULL DEFAULT '',
  updated_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales (
  product_id TEXT NOT NULL,
  week       TEXT NOT NULL,
  gender     TEXT NOT NULL,
  age_group  TEXT NOT NULL,
  purpose    TEXT NOT NULL,
  quantity   INTEGER NOT NULL,
  PRIMARY KEY (product_id, week, gender, age_group, purpose)
);
CREATE INDEX IF NOT EXISTS idx_sales_week ON sales(week);
`);

const CODES = {
  genders: ['남성', '여성'],
  targetGenders: ['남성', '여성', '공용'],
  ages: ['10대', '20대', '30대', '40대', '50대', '60대 이상'],
  purposes: ['본인용', '선물용'],
  categories: ['패션', '뷰티', '건강식품', '전자기기', '리빙'],
};

const DEFAULT_IMAGE = 'images/default.svg';

// 엑셀·폼 입력에서 흔히 쓰는 줄임말을 표준 코드로 맞춘다
const ALIASES = {
  남: '남성', 여: '여성', 남자: '남성', 여자: '여성', 공통: '공용',
  본인: '본인용', 선물: '선물용',
  '60대이상': '60대 이상', '60대+': '60대 이상', '60대': '60대 이상',
};
function normCode(v) {
  const s = String(v ?? '').trim();
  return ALIASES[s] || ALIASES[s.replace(/\s/g, '')] || s;
}

function splitList(v) {
  if (Array.isArray(v)) return v.map(normCode).filter(Boolean);
  return String(v ?? '').split(/[,，、/]/).map(normCode).filter(Boolean);
}

function toInt(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v);
  const s = String(v).replace(/[,\s원개]/g, '');
  if (!/^-?\d+$/.test(s)) return NaN;
  return parseInt(s, 10);
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ISO 주차 문자열 (예: 2026-W44)
function isoWeek(date) {
  const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function isValidWeek(w) {
  const m = /^(\d{4})-W(\d{2})$/.exec(w);
  return !!m && +m[2] >= 1 && +m[2] <= 53;
}

const ID_RE = /^[A-Za-z0-9_-]{1,20}$/;

function rowToProduct(r) {
  if (!r) return null;
  return {
    ...r,
    target_ages: r.target_ages ? r.target_ages.split(',') : [],
    purposes: r.purposes ? r.purposes.split(',') : [],
  };
}

function getProduct(id) {
  return rowToProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}

function nextProductId(extraIds = []) {
  let max = 0;
  const ids = db.prepare('SELECT id FROM products').pluck().all().concat(extraIds);
  for (const id of ids) {
    const m = /^P(\d+)$/.exec(id);
    if (m) max = Math.max(max, +m[1]);
  }
  return 'P' + String(max + 1).padStart(3, '0');
}

// 입력값을 검증하고 저장 가능한 상품 객체로 바꾼다. { value, errors }
function validateProduct(input) {
  const errors = [];
  const v = {};

  v.id = String(input.id ?? '').trim();
  if (v.id && !ID_RE.test(v.id)) errors.push('상품ID는 영문·숫자·-·_ 20자 이내여야 합니다');

  v.name = String(input.name ?? '').trim();
  if (!v.name) errors.push('상품명이 비어 있습니다');

  v.category = String(input.category ?? '').trim();
  if (!v.category) errors.push('카테고리가 비어 있습니다');

  v.price = toInt(input.price);
  if (!(v.price > 0)) errors.push('정가는 0보다 큰 숫자여야 합니다');

  if (isBlank(input.sale_price)) {
    v.sale_price = null;
  } else {
    v.sale_price = toInt(input.sale_price);
    if (!(v.sale_price > 0)) errors.push('할인가는 0보다 큰 숫자여야 합니다');
    else if (v.price > 0 && v.sale_price >= v.price) errors.push('할인가는 정가보다 낮아야 합니다');
  }

  v.image = String(input.image ?? '').trim() || DEFAULT_IMAGE;
  v.link = String(input.link ?? '').trim();

  v.target_gender = normCode(input.target_gender);
  if (!CODES.targetGenders.includes(v.target_gender)) {
    errors.push(`추천성별 "${input.target_gender ?? ''}"은(는) 남성/여성/공용 중 하나여야 합니다`);
  }

  v.target_ages = [...new Set(splitList(input.target_ages))];
  const badAges = v.target_ages.filter((a) => !CODES.ages.includes(a));
  if (!v.target_ages.length) errors.push('추천연령대를 하나 이상 지정해야 합니다');
  if (badAges.length) errors.push(`알 수 없는 연령대: ${badAges.join(', ')}`);
  v.target_ages.sort((a, b) => CODES.ages.indexOf(a) - CODES.ages.indexOf(b));

  v.purposes = [...new Set(splitList(input.purposes))];
  const badPurposes = v.purposes.filter((p) => !CODES.purposes.includes(p));
  if (!v.purposes.length) errors.push('용도를 하나 이상 지정해야 합니다');
  if (badPurposes.length) errors.push(`알 수 없는 용도: ${badPurposes.join(', ')}`);
  v.purposes.sort((a, b) => CODES.purposes.indexOf(a) - CODES.purposes.indexOf(b));

  v.recommend_text = String(input.recommend_text ?? '').trim();

  v.stock = isBlank(input.stock) ? 0 : toInt(input.stock);
  if (!(v.stock >= 0)) errors.push('재고는 0 이상의 정수여야 합니다');

  v.memo = String(input.memo ?? '').trim();

  return { value: v, errors };
}

const upsertStmt = db.prepare(`
INSERT INTO products (id, name, category, price, sale_price, image, link, target_gender,
  target_ages, purposes, recommend_text, stock, memo, updated_at)
VALUES (@id, @name, @category, @price, @sale_price, @image, @link, @target_gender,
  @target_ages, @purposes, @recommend_text, @stock, @memo, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name, category = excluded.category, price = excluded.price,
  sale_price = excluded.sale_price, image = excluded.image, link = excluded.link,
  target_gender = excluded.target_gender, target_ages = excluded.target_ages,
  purposes = excluded.purposes, recommend_text = excluded.recommend_text,
  stock = excluded.stock, memo = excluded.memo, updated_at = excluded.updated_at
`);

function saveProduct(p) {
  const link = p.link || `/shop.html?id=${encodeURIComponent(p.id)}`;
  upsertStmt.run({
    ...p,
    link,
    target_ages: p.target_ages.join(','),
    purposes: p.purposes.join(','),
    updated_at: nowStr(),
  });
  return getProduct(p.id);
}

// 판매 행 검증. { value, errors }
function validateSale(input) {
  const errors = [];
  const v = {
    product_id: String(input.product_id ?? '').trim(),
    week: String(input.week ?? '').trim().toUpperCase().replace(/^(\d{4})-?W(\d)$/, '$1-W0$2'),
    gender: normCode(input.gender),
    age_group: normCode(input.age_group),
    purpose: normCode(input.purpose),
    quantity: toInt(input.quantity),
  };
  if (!v.product_id) errors.push('상품ID가 비어 있습니다');
  if (!isValidWeek(v.week)) errors.push(`주차 "${input.week ?? ''}" 형식이 틀렸습니다 (예: 2026-W44)`);
  if (!CODES.genders.includes(v.gender)) errors.push(`성별 "${input.gender ?? ''}"은(는) 남성/여성 중 하나여야 합니다`);
  if (!CODES.ages.includes(v.age_group)) errors.push(`연령대 "${input.age_group ?? ''}"을(를) 알 수 없습니다`);
  if (!CODES.purposes.includes(v.purpose)) errors.push(`용도 "${input.purpose ?? ''}"은(는) 본인용/선물용 중 하나여야 합니다`);
  if (!(v.quantity >= 0)) errors.push('판매수량은 0 이상의 정수여야 합니다');
  return { value: v, errors };
}

const saleUpsertStmt = db.prepare(`
INSERT INTO sales (product_id, week, gender, age_group, purpose, quantity)
VALUES (@product_id, @week, @gender, @age_group, @purpose, @quantity)
ON CONFLICT(product_id, week, gender, age_group, purpose) DO UPDATE SET quantity = excluded.quantity
`);
const saleDeleteStmt = db.prepare(`
DELETE FROM sales WHERE product_id = @product_id AND week = @week AND gender = @gender
  AND age_group = @age_group AND purpose = @purpose
`);

// 수량 0은 행을 지워 테이블을 깔끔하게 유지한다
function saveSale(s) {
  if (s.quantity === 0) saleDeleteStmt.run(s);
  else saleUpsertStmt.run(s);
}

module.exports = {
  db, CODES, DEFAULT_IMAGE,
  isoWeek, isValidWeek, nowStr, toInt, isBlank,
  getProduct, nextProductId, validateProduct, saveProduct, validateSale, saveSale,
};
