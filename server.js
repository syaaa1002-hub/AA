// Express 서버와 API. 로컬에서는 `npm start`로 실행하고, Vercel에서는 내보낸 app을 함수로 실행한다.
require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const express = require('express');
const XLSX = require('xlsx');
const {
  sql, CODES, isoWeek, isValidWeek, isBlank,
  getProduct, allProducts, nextProductId, validateProduct, saveProduct, validateSale, saveSales,
} = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const IS_VERCEL = !!process.env.VERCEL;

// 설정이 빠져도 서버(화면)는 뜨게 하고, 상담원 기능만 막은 채 무엇이 빠졌는지 알려 준다
const STAFF_PIN = String(process.env.STAFF_PIN || '').trim();
const configProblems = [];
if (!/^\d{4,12}$/.test(STAFF_PIN)) configProblems.push('STAFF_PIN(숫자 4~12자리)');

// 토큰 서명 키. PIN을 바꾸면 기존 토큰도 함께 무효가 된다.
let AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  if (IS_VERCEL) {
    configProblems.push('AUTH_SECRET');
  } else {
    AUTH_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('AUTH_SECRET이 없어 임시 값을 씁니다. 서버를 다시 시작하면 상담원 모드가 풀립니다.');
  }
}
if (configProblems.length) console.error(`환경 변수가 없거나 잘못되었습니다: ${configProblems.join(', ')}`);
const SIGN_KEY = crypto.createHash('sha256').update(`${AUTH_SECRET}:${STAFF_PIN}`).digest();

const app = express();
if (IS_VERCEL) app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // Vercel에서는 무시되고 public/을 CDN이 제공

// Vercel은 /를 이 함수로 보내므로 추천 화면을 직접 돌려준다 (주소가 /index.html로 바뀌지 않게)
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
app.get('/', (req, res) => res.type('html').send(INDEX_HTML));

// ---------------------------------------------------------------- 추천 목록

// 최근 4주 = 판매 데이터에 있는 가장 최근 주차 4개
async function recentWeeks() {
  return (await sql`SELECT DISTINCT week FROM sales ORDER BY week DESC LIMIT 4`).map((r) => r.week);
}

function readFilters(q) {
  const pick = (v, list) => (list.includes(v) ? v : '');
  return {
    gender: pick(q.gender, CODES.genders),
    age: pick(q.age, CODES.ages),
    purpose: pick(q.purpose, CODES.purposes),
  };
}

function matchesFilters(p, f) {
  if (f.gender && p.target_gender !== f.gender && p.target_gender !== '공용') return false;
  if (f.age && !p.target_ages.includes(f.age)) return false;
  if (f.purpose && !p.purposes.includes(f.purpose)) return false;
  return true;
}

// 필터에 맞는 상품을 판매순으로 정렬해 돌려준다
async function recommend(f, { includeSoldOut }) {
  const weeks = await recentWeeks();
  const [products, soldRows] = await Promise.all([
    allProducts(),
    weeks.length ? sql`
      SELECT product_id, SUM(quantity)::int AS q FROM sales
      WHERE week IN ${sql(weeks)}
        ${f.gender ? sql`AND gender = ${f.gender}` : sql``}
        ${f.age ? sql`AND age_group = ${f.age}` : sql``}
        ${f.purpose ? sql`AND purpose = ${f.purpose}` : sql``}
      GROUP BY product_id` : [],
  ]);
  const sold = new Map(soldRows.map((r) => [r.product_id, r.q]));

  const items = products
    .filter((p) => matchesFilters(p, f) && (includeSoldOut || p.stock > 0))
    .map((p) => ({ ...p, sold: sold.get(p.id) || 0 }));

  items.sort((a, b) => b.sold - a.sold
    || (b.sale_price != null) - (a.sale_price != null)
    || a.name.localeCompare(b.name, 'ko'));

  let rank = 0;
  for (const p of items) p.rank = p.sold > 0 ? ++rank : null;
  return { weeks, items };
}

const PUBLIC_FIELDS = ['id', 'name', 'category', 'price', 'sale_price', 'image', 'link',
  'target_gender', 'target_ages', 'purposes', 'recommend_text'];
function publicView(p) {
  const o = {};
  for (const k of PUBLIC_FIELDS) o[k] = p[k];
  return o;
}

app.get('/api/products', async (req, res) => {
  const { weeks, items } = await recommend(readFilters(req.query), { includeSoldOut: false });
  res.json({ weeks, items: items.map((p) => ({ ...publicView(p), rank: p.rank })) });
});

app.get('/api/products/:id', async (req, res) => {
  const p = await getProduct(req.params.id);
  if (!p || p.stock <= 0) return res.status(404).json({ error: '상품을 찾을 수 없습니다' });
  res.json(publicView(p));
});

// ---------------------------------------------------------------- PIN 인증

const TOKEN_TTL = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MINUTES = 5;

const hmac = (s) => crypto.createHmac('sha256', SIGN_KEY).update(String(s)).digest();

// 토큰 = "만료시각.서명". 서버에 저장하지 않으므로 서버가 여러 대여도 동작한다
function issueToken() {
  const exp = Date.now() + TOKEN_TTL;
  return `${exp}.${hmac(exp).toString('base64url')}`;
}
function verifyToken(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  const given = Buffer.from(sig, 'base64url');
  const expected = hmac(exp);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Vercel은 x-real-ip를 실제 접속 IP로 덮어쓰므로 믿을 수 있다. 로컬에서는 소켓 주소를 쓴다
function clientIp(req) {
  return (IS_VERCEL && req.get('x-real-ip')) || req.ip || 'unknown';
}

app.post('/api/auth', async (req, res) => {
  if (configProblems.length) {
    return res.status(503).json({ error: `상담원 모드를 쓸 수 없습니다. 관리자가 환경 변수 ${configProblems.join(', ')}를 설정해야 합니다.` });
  }
  const ip = clientIp(req);
  const [lock] = await sql`
    SELECT EXTRACT(EPOCH FROM (locked_until - now()))::int AS sec
    FROM login_attempts WHERE ip = ${ip} AND locked_until > now()`;
  if (lock) {
    return res.status(429).json({ error: `PIN을 여러 번 틀렸습니다. ${Math.max(lock.sec, 1)}초 뒤에 다시 시도해 주세요` });
  }

  const pin = String(req.body?.pin ?? '');
  const ok = crypto.timingSafeEqual(hmac(pin), hmac(STAFF_PIN)); // 길이가 달라도 같은 시간에 비교
  if (!ok) {
    await sql`
      INSERT INTO login_attempts (ip, fail_count) VALUES (${ip}, 1)
      ON CONFLICT (ip) DO UPDATE SET
        fail_count = CASE WHEN login_attempts.fail_count + 1 >= ${MAX_FAILS} THEN 0 ELSE login_attempts.fail_count + 1 END,
        locked_until = CASE WHEN login_attempts.fail_count + 1 >= ${MAX_FAILS}
          THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE login_attempts.locked_until END`;
    return res.status(401).json({ error: 'PIN이 맞지 않습니다' });
  }
  await sql`DELETE FROM login_attempts WHERE ip = ${ip}`;
  res.json({ token: issueToken() });
});

// 토큰을 서버에 저장하지 않으므로 화면에서 토큰을 지우는 것으로 충분하다
app.post('/api/auth/logout', (req, res) => res.json({ ok: true }));

app.use('/api/staff', (req, res, next) => {
  // 서명 키가 갖춰지지 않았으면 토큰을 위조할 수 있으므로 상담원 API 전체를 막는다
  if (configProblems.length) return res.status(401).json({ error: '상담원 인증이 필요합니다' });
  if (!verifyToken(req.get('x-staff-token'))) return res.status(401).json({ error: '상담원 인증이 필요합니다' });
  next();
});

// ---------------------------------------------------------------- 상담원 API

// public/images 목록. Vercel 함수 안에서는 폴더가 안 보일 수 있어 DB에 쓰인 이미지와 합친다
let imageFiles = [];
try {
  imageFiles = fs.readdirSync(path.join(__dirname, 'public', 'images'))
    .filter((n) => /\.(svg|png|jpe?g|gif|webp)$/i.test(n))
    .map((n) => `images/${n}`);
} catch { /* 폴더 없음 */ }

app.get('/api/staff/meta', async (req, res) => {
  const [weekRows, imageRows, recent] = await Promise.all([
    sql`SELECT DISTINCT week FROM sales ORDER BY week DESC`,
    sql`SELECT DISTINCT image FROM products`,
    recentWeeks(),
  ]);
  const images = [...new Set([...imageFiles, ...imageRows.map((r) => r.image), 'images/default.svg'])].sort();
  const today = new Date();
  res.json({
    codes: CODES,
    images,
    weeks: weekRows.map((r) => r.week),
    recentWeeks: recent,
    currentWeek: isoWeek(today),
    lastWeek: isoWeek(new Date(today.getTime() - 7 * 86400000)),
  });
});

const emptyStats = () => ({ total: 0, gender: { 남성: 0, 여성: 0 }, purpose: { 본인용: 0, 선물용: 0 } });

app.get('/api/staff/products', async (req, res) => {
  const { weeks, items } = await recommend(readFilters(req.query), { includeSoldOut: true });

  // 성별·용도별 판매 비율 (최근 4주, 상품 전체 조건)
  const stats = new Map();
  const rows = weeks.length ? await sql`
    SELECT product_id, gender, purpose, SUM(quantity)::int AS q FROM sales
    WHERE week IN ${sql(weeks)} GROUP BY product_id, gender, purpose` : [];
  for (const { product_id: pid, gender, purpose, q } of rows) {
    if (!stats.has(pid)) stats.set(pid, emptyStats());
    const s = stats.get(pid);
    s.total += q; s.gender[gender] += q; s.purpose[purpose] += q;
  }

  res.json({ weeks, items: items.map((p) => ({ ...p, stats: stats.get(p.id) || emptyStats() })) });
});

function sendValidation(res, errors) {
  return res.status(400).json({ error: errors.join(' / '), errors });
}

async function createProduct(req, res) {
  const { value, errors } = validateProduct({ ...req.body, id: req.params.id ?? req.body.id });
  if (errors.length) return sendValidation(res, errors);
  if (!value.id) value.id = await nextProductId();
  if (await getProduct(value.id)) return sendValidation(res, [`상품ID ${value.id}은(는) 이미 있습니다`]);
  res.status(201).json(await saveProduct(value));
}
app.post('/api/staff/products', createProduct);
app.post('/api/staff/products/:id', createProduct);

// 일부 필드만 보내도 된다 (예: 재고만 수정)
app.put('/api/staff/products/:id', async (req, res) => {
  const cur = await getProduct(req.params.id);
  if (!cur) return res.status(404).json({ error: '상품을 찾을 수 없습니다' });
  const { value, errors } = validateProduct({ ...cur, ...req.body, id: cur.id });
  if (errors.length) return sendValidation(res, errors);
  res.json(await saveProduct(value));
});

// 판매 데이터는 외래키(ON DELETE CASCADE)로 함께 지워진다
app.delete('/api/staff/products/:id', async (req, res) => {
  const r = await sql`DELETE FROM products WHERE id = ${req.params.id}`;
  if (!r.count) return res.status(404).json({ error: '상품을 찾을 수 없습니다' });
  res.json({ ok: true });
});

app.get('/api/staff/sales', async (req, res) => {
  const { product_id, week } = req.query;
  if (!product_id || !isValidWeek(String(week))) return res.status(400).json({ error: '상품과 주차를 지정해 주세요' });
  res.json(await sql`SELECT * FROM sales WHERE product_id = ${product_id} AND week = ${week}`);
});

// 조건별 판매 수량 일괄 저장. body: { rows: [{product_id, week, gender, age_group, purpose, quantity}] }
app.put('/api/staff/sales', async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'rows 배열이 필요합니다' });
  const ids = new Set((await sql`SELECT id FROM products`).map((r) => r.id));
  const valid = [];
  const errors = [];
  rows.forEach((r, i) => {
    const { value, errors: e } = validateSale(r);
    if (!e.length && !ids.has(value.product_id)) e.push(`없는 상품ID: ${value.product_id}`);
    if (e.length) errors.push(`${i + 1}번째 행: ${e.join(', ')}`);
    else valid.push(value);
  });
  if (errors.length) return sendValidation(res, errors);
  await sql.begin((tx) => saveSales(valid, tx));
  res.json({ saved: valid.length });
});

// ---------------------------------------------------------------- 엑셀

const PRODUCT_COLS = [
  ['상품ID', 'id'], ['상품명', 'name'], ['카테고리', 'category'], ['정가', 'price'],
  ['할인가', 'sale_price'], ['이미지', 'image'], ['링크', 'link'], ['추천성별', 'target_gender'],
  ['추천연령대', 'target_ages'], ['용도', 'purposes'], ['추천문구', 'recommend_text'],
  ['재고', 'stock'], ['내부메모', 'memo'],
];
const SALES_COLS = [
  ['상품ID', 'product_id'], ['주차', 'week'], ['성별', 'gender'], ['연령대', 'age_group'],
  ['용도', 'purpose'], ['판매수량', 'quantity'],
];

app.get('/api/staff/template.xlsx', async (req, res) => {
  const products = await allProducts();
  const lastWeek = isoWeek(new Date(Date.now() - 7 * 86400000));
  const cell = (v) => (Array.isArray(v) ? v.join(',') : (v ?? ''));

  const wsP = XLSX.utils.aoa_to_sheet([
    PRODUCT_COLS.map((c) => c[0]),
    ...products.map((p) => PRODUCT_COLS.map(([, k]) => cell(p[k]))),
  ]);
  wsP['!cols'] = [8, 26, 10, 10, 10, 20, 26, 9, 22, 16, 36, 7, 40].map((wch) => ({ wch }));

  // 예시 행을 두면 실수로 실제 데이터를 덮어쓸 수 있어 머리글만 둔다 (예시는 안내 시트)
  const wsS = XLSX.utils.aoa_to_sheet([SALES_COLS.map((c) => c[0])]);
  wsS['!cols'] = [10, 12, 8, 10, 10, 10].map((wch) => ({ wch }));

  const wsG = XLSX.utils.aoa_to_sheet([
    ['맞춤 상품 추천 도구 업로드 양식 안내'],
    [],
    ['시트', '설명'],
    ['상품', '상품ID가 있는 상품이면 수정, 상품ID가 비어 있거나 처음 보는 ID면 새 상품으로 추가합니다. 지운 행의 상품은 삭제되지 않습니다(삭제는 관리 화면에서).'],
    ['주간판매', '조건별 판매 수량. 같은 (상품ID, 주차, 성별, 연령대, 용도)는 덮어씁니다. 판매수량 0은 그 조건의 판매 기록을 지웁니다.'],
    ['주간판매 예시', `P001 | ${lastWeek} | 남성 | 50대 | 선물용 | 12`],
    [],
    ['항목', '입력할 수 있는 값'],
    ['추천성별', CODES.targetGenders.join(' / ')],
    ['성별(주간판매)', CODES.genders.join(' / ')],
    ['연령대', CODES.ages.join(' / ')],
    ['용도', CODES.purposes.join(' / ')],
    ['카테고리(예시)', CODES.categories.join(' / ')],
    ['주차', `YYYY-Www 형식. 지난주 = ${lastWeek}`],
    ['복수 값', '추천연령대·용도는 쉼표로 구분 (예: 30대,40대)'],
    ['할인가', '비우면 할인 없음. 정가보다 낮아야 합니다'],
    ['이미지·링크', '비우면 기존 값 유지(신규 상품은 기본 이미지·데모 링크)'],
  ]);
  wsG['!cols'] = [{ wch: 16 }, { wch: 100 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsP, '상품');
  XLSX.utils.book_append_sheet(wb, wsS, '주간판매');
  XLSX.utils.book_append_sheet(wb, wsG, '안내');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.attachment(`상품추천_양식_${lastWeek}.xlsx`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

function readSheet(wb, name, cols) {
  const ws = wb.Sheets[name];
  if (!ws) return { missing: true, rows: [] };
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: true });
  const header = (aoa[0] || []).map((h) => String(h).trim());
  const expected = cols.map((c) => c[0]);
  if (expected.some((h, i) => header[i] !== h)) {
    return { badHeader: `"${name}" 시트의 첫 줄 열 이름이 양식과 다릅니다. 양식을 다시 내려받아 사용해 주세요.`, rows: [] };
  }
  const rows = [];
  aoa.slice(1).forEach((arr, i) => {
    if (arr.every((v) => isBlank(v))) return;
    const o = {};
    cols.forEach(([, key], j) => { o[key] = typeof arr[j] === 'string' ? arr[j].trim() : arr[j]; });
    rows.push({ excelRow: i + 2, data: o });
  });
  return { rows };
}

const SAME_KEYS = ['name', 'category', 'price', 'sale_price', 'image', 'link', 'target_gender',
  'target_ages', 'purposes', 'recommend_text', 'stock', 'memo'];
function sameProduct(a, b) {
  return SAME_KEYS.every((k) => String(a[k] ?? '') === String(b[k] ?? ''));
}

const saleKey = (s) => [s.product_id, s.week, s.gender, s.age_group, s.purpose].join('|');

// 업로드 내용을 분석해 반영할 작업 목록과 요약을 만든다
async function analyzeUpload(buf) {
  let wb;
  try {
    wb = XLSX.read(buf, { type: 'buffer' });
  } catch {
    return { fatal: '엑셀 파일을 읽을 수 없습니다. .xlsx 파일인지 확인해 주세요.' };
  }
  const ps = readSheet(wb, '상품', PRODUCT_COLS);
  const ss = readSheet(wb, '주간판매', SALES_COLS);
  if (ps.missing && ss.missing) return { fatal: '"상품" 또는 "주간판매" 시트가 없습니다. 관리 화면에서 내려받은 양식을 사용해 주세요.' };
  if (ps.badHeader || ss.badHeader) return { fatal: ps.badHeader || ss.badHeader };

  const existing = new Map((await allProducts()).map((p) => [p.id, p]));
  const errors = [];
  const productOps = [];
  const summary = { products: { add: 0, update: 0, unchanged: 0 }, sales: { add: 0, update: 0 } };
  const seenIds = new Set();
  const newIds = [];

  for (const { excelRow, data } of ps.rows) {
    const id = String(data.id ?? '').trim();
    const cur = id ? existing.get(id) : null;
    const input = { ...data };
    if (cur) {
      if (isBlank(input.image)) input.image = cur.image;
      if (isBlank(input.link)) input.link = cur.link;
    }
    const { value, errors: e } = validateProduct(input);
    if (id && seenIds.has(id)) e.push(`상품ID ${id}이(가) 시트에 두 번 있습니다`);
    if (e.length) { errors.push({ sheet: '상품', row: excelRow, message: e.join(', ') }); continue; }

    if (!value.id) value.id = await nextProductId(newIds);
    seenIds.add(value.id);
    if (cur) {
      if (sameProduct(cur, value)) summary.products.unchanged += 1;
      else { summary.products.update += 1; productOps.push(value); }
    } else {
      newIds.push(value.id);
      summary.products.add += 1;
      productOps.push(value);
    }
  }

  const saleOps = new Map();
  for (const { excelRow, data } of ss.rows) {
    const { value, errors: e } = validateSale(data);
    if (!e.length && !existing.has(value.product_id) && !newIds.includes(value.product_id)) {
      e.push(`없는 상품ID: ${value.product_id}`);
    }
    if (e.length) { errors.push({ sheet: '주간판매', row: excelRow, message: e.join(', ') }); continue; }
    saleOps.set(saleKey(value), value);
  }

  const weeks = [...new Set([...saleOps.values()].map((s) => s.week))];
  const existingSales = new Set(weeks.length
    ? (await sql`SELECT product_id, week, gender, age_group, purpose FROM sales WHERE week IN ${sql(weeks)}`).map(saleKey)
    : []);
  for (const key of saleOps.keys()) {
    if (existingSales.has(key)) summary.sales.update += 1; else summary.sales.add += 1;
  }

  return { summary, errors, productOps, saleOps: [...saleOps.values()] };
}

app.post('/api/staff/upload',
  express.raw({ type: () => true, limit: '4mb' }), // Vercel 요청 크기 한도 4.5MB
  async (req, res) => {
    if (!req.body?.length) return res.status(400).json({ error: '파일이 비어 있습니다' });
    const r = await analyzeUpload(req.body);
    if (r.fatal) return res.status(400).json({ error: r.fatal });
    const dryRun = req.query.dryRun !== 'false';
    if (!dryRun) {
      await sql.begin(async (tx) => {
        for (const p of r.productOps) await saveProduct(p, tx);
        await saveSales(r.saleOps, tx);
      });
    }
    res.json({ applied: !dryRun, summary: r.summary, errors: r.errors });
  });

// ---------------------------------------------------------------- 시작

app.use('/api', (req, res) => res.status(404).json({ error: '없는 API입니다' }));
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const message = status === 413 ? '파일이 너무 큽니다'
    : status === 503 ? err.message
      : '서버 오류가 발생했습니다';
  res.status(status).json({ error: message });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
    console.log('맞춤 상품 추천 도구가 실행 중입니다.');
    console.log(`  이 PC:      http://localhost:${PORT}`);
    for (const ip of ips) console.log(`  사내망 PC:  http://${ip}:${PORT}`);
    console.log(`  관리 화면:  http://localhost:${PORT}/admin.html`);
  });
}
