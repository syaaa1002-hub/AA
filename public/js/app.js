// 추천 화면 (상담원 모드 포함)
const OPTIONS = {
  gender: ['남성', '여성'],
  age: ['10대', '20대', '30대', '40대', '50대', '60대 이상'],
  purpose: ['본인용', '선물용'],
};

const params = new URLSearchParams(location.search);
const state = {
  gender: OPTIONS.gender.includes(params.get('gender')) ? params.get('gender') : '',
  age: OPTIONS.age.includes(params.get('age')) ? params.get('age') : '',
  purpose: OPTIONS.purpose.includes(params.get('purpose')) ? params.get('purpose') : '',
  staff: !!Staff.token,
};

const $ = (s) => document.querySelector(s);
const grid = $('#grid');
let items = [];
let loadSeq = 0;

function renderChips() {
  for (const box of document.querySelectorAll('[data-filter]')) {
    const key = box.dataset.filter;
    box.innerHTML = ['', ...OPTIONS[key]].map((v) => `
      <button type="button" class="chip" data-value="${esc(v)}" aria-pressed="${state[key] === v}">
        ${v ? esc(v) : '전체'}
      </button>`).join('');
  }
}

document.querySelector('.filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const key = chip.parentElement.dataset.filter;
  state[key] = chip.dataset.value;
  renderChips();
  syncUrl();
  load();
});

function syncUrl() {
  const q = new URLSearchParams();
  for (const k of ['gender', 'age', 'purpose']) if (state[k]) q.set(k, state[k]);
  const s = q.toString();
  history.replaceState(null, '', s ? `?${s}` : location.pathname);
}

function titleText() {
  const parts = [state.gender, state.age, state.purpose].filter(Boolean);
  return parts.length ? `${parts.join(' · ')} 추천 상품` : '전체 추천 상품';
}

async function load() {
  const seq = ++loadSeq;
  const q = new URLSearchParams();
  if (state.gender) q.set('gender', state.gender);
  if (state.age) q.set('age', state.age);
  if (state.purpose) q.set('purpose', state.purpose);
  const url = `${state.staff ? '/api/staff/products' : '/api/products'}?${q}`;
  try {
    const data = await api(url);
    if (seq !== loadSeq) return;
    items = data.items;
    const w = data.weeks;
    $('#resultTitle').textContent = titleText();
    $('#resultMeta').textContent = `${items.length}개 · 최근 4주 판매순${w.length ? ` (${w[w.length - 1]}~${w[0]})` : ''}`;
    render();
  } catch (e) {
    if (e.status === 401 && state.staff) {
      setStaff(false);
      toast('상담원 인증이 만료되어 고객 화면으로 돌아갑니다', 'warn');
      return;
    }
    if (seq !== loadSeq) return;
    // 빈 화면 대신 무엇이 문제인지 목록 자리에 보여 준다
    items = [];
    grid.innerHTML = '';
    $('#resultTitle').textContent = titleText();
    $('#resultMeta').textContent = '';
    $('#empty').textContent = `상품 목록을 불러오지 못했습니다. ${e.message || ''}`;
    $('#empty').hidden = false;
  }
}

function priceHtml(p) {
  if (p.sale_price == null) return `<div class="price"><strong>${won(p.price)}원</strong></div>`;
  return `<div class="price">
    <span class="rate">${discountRate(p)}%</span>
    <strong>${won(p.sale_price)}원</strong>
    <del>${won(p.price)}원</del>
  </div>`;
}

function ratioBar(label, a, b, aName, bName) {
  const total = a + b;
  const pa = total ? Math.round((a / total) * 100) : 0;
  const pb = total ? 100 - pa : 0;
  return `<div class="ratio">
    <div class="ratio-label"><span>${label}</span><span>${aName} ${pa}% · ${bName} ${pb}%</span></div>
    <div class="ratio-bar" aria-hidden="true"><i style="width:${pa}%"></i></div>
  </div>`;
}

function staffHtml(p) {
  const s = p.stats;
  const low = p.stock > 0 && p.stock <= 10;
  return `<div class="staff-info">
    <div class="staff-row">
      <span class="stock ${p.stock === 0 ? 'out' : low ? 'low' : ''}">재고 ${won(p.stock)}개</span>
      <span>선택 조건 최근 4주 판매 <b>${won(p.sold)}</b>개</span>
    </div>
    ${p.memo ? `<p class="memo">📝 ${esc(p.memo)}</p>` : ''}
    ${ratioBar('성별', s.gender['남성'], s.gender['여성'], '남', '여')}
    ${ratioBar('용도', s.purpose['본인용'], s.purpose['선물용'], '본인', '선물')}
    <button type="button" class="btn btn-primary btn-block" data-copy="${esc(p.id)}">안내 문구 복사</button>
  </div>`;
}

function cardHtml(p) {
  const soldOut = p.stock === 0;
  const badges = [
    p.rank && p.rank <= 3 ? `<span class="badge badge-rank">판매 ${p.rank}위</span>` : '',
    p.sale_price != null ? '<span class="badge badge-sale">할인</span>' : '',
    soldOut ? '<span class="badge badge-out">품절</span>' : '',
  ].join('');
  return `<article class="card${soldOut ? ' soldout' : ''}">
    <a class="card-link" href="${esc(p.link)}" target="_blank" rel="noopener">
      <div class="thumb">
        <img src="${esc(p.image)}" alt="" loading="lazy">
        <div class="badges">${badges}</div>
      </div>
      <div class="card-body">
        <span class="category">${esc(p.category)}</span>
        <h3 class="name">${esc(p.name)}</h3>
        <p class="reco">${esc(p.recommend_text)}</p>
        ${priceHtml(p)}
      </div>
    </a>
    ${state.staff ? staffHtml(p) : ''}
  </article>`;
}

function render() {
  grid.innerHTML = items.map(cardHtml).join('');
  $('#empty').textContent = '조건에 맞는 상품이 없습니다. 조건을 바꿔 보세요.';
  $('#empty').hidden = items.length > 0;
}

function guideText(p) {
  const link = new URL(p.link, location.href).href;
  return `${p.name} ${won(finalPrice(p))}원 / ${p.recommend_text} / ${link}`;
}

grid.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const p = items.find((x) => x.id === btn.dataset.copy);
  if (!p) return;
  if (await copyText(guideText(p))) toast('복사됨');
  else toast('복사하지 못했습니다. 브라우저 설정을 확인해 주세요', 'error');
});

function setStaff(on) {
  state.staff = on;
  if (!on) Staff.token = null;
  const t = $('#staffToggle');
  t.setAttribute('aria-checked', String(on));
  $('#adminLink').hidden = !on;
  $('#staffBanner').hidden = !on;
  document.body.classList.toggle('is-staff', on);
}

$('#staffToggle').addEventListener('click', async () => {
  if (state.staff) {
    await logout();
    setStaff(false);
    toast('상담원 모드를 껐습니다');
  } else {
    if (!(await askPin())) return;
    setStaff(true);
    toast('상담원 모드를 켰습니다');
  }
  load();
});

renderChips();
setStaff(state.staff);
load();
