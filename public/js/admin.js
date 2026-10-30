// 관리 화면: 상품 편집, 재고·판매 직접 수정, 엑셀 업로드
const $ = (s) => document.querySelector(s);
let meta = null;
let products = [];

// ---------------------------------------------------------------- 잠금

function handleError(e) {
  if (e.status === 401) {
    Staff.token = null;
    showLock();
    toast('인증이 만료되었습니다. PIN을 다시 입력해 주세요', 'warn');
    return;
  }
  toast(e.message || '오류가 발생했습니다', 'error');
}

function showLock() {
  $('#lock').hidden = false;
  $('#app').hidden = true;
  $('#logoutBtn').hidden = true;
}

async function unlock() {
  if (!Staff.token && !(await askPin())) return;
  try {
    meta = await api('/api/staff/meta');
  } catch (e) {
    if (e.status === 401) { Staff.token = null; showLock(); return unlock(); }
    return toast(e.message, 'error');
  }
  $('#lock').hidden = true;
  $('#app').hidden = false;
  $('#logoutBtn').hidden = false;
  setupForm();
  await loadProducts();
  fillSalesControls();
}

$('#unlockBtn').addEventListener('click', unlock);
$('#logoutBtn').addEventListener('click', async () => {
  await logout();
  showLock();
});

// ---------------------------------------------------------------- 탭

document.querySelector('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t === tab));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab.dataset.tab;
  if (tab.dataset.tab === 'sales') loadSales();
});

// ---------------------------------------------------------------- 상품 목록

async function loadProducts() {
  try {
    const data = await api('/api/staff/products');
    products = data.items.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    renderProducts();
  } catch (e) { handleError(e); }
}

function renderProducts() {
  const q = $('#productSearch').value.trim().toLowerCase();
  const list = products.filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  $('#productCount').textContent = `${products.length}개`;
  $('#productRows').innerHTML = list.map((p) => `
    <tr class="${p.stock === 0 ? 'row-out' : ''}" data-id="${esc(p.id)}">
      <td>${esc(p.id)}</td>
      <td><img class="thumb-sm" src="${esc(p.image)}" alt=""></td>
      <td>${esc(p.name)}
        ${p.sale_price != null ? `<span class="pill pill-sale">${discountRate(p)}% 할인</span>` : ''}
        ${p.stock === 0 ? '<span class="pill pill-out">품절</span>' : ''}</td>
      <td>${esc(p.category)}</td>
      <td><span class="pill">${esc(p.target_gender)}</span><span class="pill">${esc(ageRange(p.target_ages))}</span>${p.purposes.map((x) => `<span class="pill">${esc(x)}</span>`).join('')}</td>
      <td class="num">${won(finalPrice(p))}원</td>
      <td class="num"><input class="input stock-input" type="number" min="0" value="${p.stock}" data-stock aria-label="${esc(p.name)} 재고"></td>
      <td class="num">${won(p.stats.total)}</td>
      <td><div class="row-actions">
        <button class="btn btn-sm" type="button" data-edit>수정</button>
        <button class="btn btn-sm" type="button" data-sales>판매</button>
        <button class="btn btn-sm btn-danger" type="button" data-delete>삭제</button>
      </div></td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">상품이 없습니다.</td></tr>';
}

function ageRange(ages) {
  if (ages.length === meta.codes.ages.length) return '전 연령';
  return ages.join(',');
}

$('#productSearch').addEventListener('input', renderProducts);

$('#productRows').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const p = products.find((x) => x.id === tr.dataset.id);
  if (e.target.closest('[data-edit]')) openProductForm(p);
  else if (e.target.closest('[data-sales]')) {
    $('#salesProduct').value = p.id;
    document.querySelector('.tab[data-tab="sales"]').click();
  } else if (e.target.closest('[data-delete]')) {
    if (!confirm(`"${p.name}" 상품을 삭제할까요?\n이 상품의 판매 데이터도 함께 지워지고 되돌릴 수 없습니다.`)) return;
    try {
      await api(`/api/staff/products/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      toast('삭제했습니다');
      await loadProducts();
      fillSalesControls();
    } catch (ex) { handleError(ex); }
  }
});

// 재고 칸: 값을 바꾸고 포커스를 옮기거나 Enter를 누르면 저장
$('#productRows').addEventListener('change', async (e) => {
  if (!e.target.matches('[data-stock]')) return;
  const id = e.target.closest('tr').dataset.id;
  const stock = Number(e.target.value);
  if (!Number.isInteger(stock) || stock < 0) { toast('재고는 0 이상의 정수로 입력해 주세요', 'error'); return; }
  try {
    const saved = await api(`/api/staff/products/${encodeURIComponent(id)}`, { method: 'PUT', body: { stock } });
    const p = products.find((x) => x.id === id);
    Object.assign(p, saved);
    renderProducts();
    toast(`재고 저장: ${saved.name} ${won(saved.stock)}개`);
  } catch (ex) { handleError(ex); }
});
$('#productRows').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-stock]')) e.target.blur();
});

// ---------------------------------------------------------------- 상품 편집

const dlg = $('#productDialog');
const form = $('#productForm');
const F = form.elements; // form.id·form.name은 폼 자체 속성이라 elements로 접근
let editingId = null;

function setupForm() {
  const group = (name, values, type) => {
    form.querySelector(`[data-group="${name}"]`).innerHTML = values.map((v) => `
      <label><input type="${type}" name="${name}" value="${esc(v)}"> ${esc(v)}</label>`).join('');
  };
  group('target_gender', meta.codes.targetGenders, 'radio');
  group('purposes', meta.codes.purposes, 'checkbox');
  group('target_ages', meta.codes.ages, 'checkbox');
  $('#categoryList').innerHTML = meta.codes.categories.map((c) => `<option value="${esc(c)}">`).join('');
  F.image.innerHTML = meta.images.map((i) => `<option value="${esc(i)}">${esc(i.replace('images/', ''))}</option>`).join('');
}

F.image.addEventListener('change', () => { $('#imgPreview').src = F.image.value; });

function openProductForm(p) {
  editingId = p ? p.id : null;
  $('#productDialogTitle').textContent = p ? `상품 수정 · ${p.id}` : '상품 추가';
  $('#productError').textContent = '';
  form.reset();
  F.id.disabled = !!p;
  const v = p || { stock: 0, image: 'images/default.svg', target_gender: '공용', target_ages: [], purposes: [] };
  for (const k of ['id', 'name', 'category', 'price', 'sale_price', 'recommend_text', 'stock', 'link', 'memo']) {
    F[k].value = v[k] ?? '';
  }
  if (!meta.images.includes(v.image)) {
    F.image.insertAdjacentHTML('beforeend', `<option value="${esc(v.image)}">${esc(v.image)}</option>`);
  }
  F.image.value = v.image;
  $('#imgPreview').src = v.image;
  for (const el of form.querySelectorAll('[name="target_gender"]')) el.checked = el.value === v.target_gender;
  for (const el of form.querySelectorAll('[name="target_ages"]')) el.checked = v.target_ages.includes(el.value);
  for (const el of form.querySelectorAll('[name="purposes"]')) el.checked = v.purposes.includes(el.value);
  dlg.showModal();
  (p ? F.name : F.id).focus();
}

$('#addProductBtn').addEventListener('click', () => openProductForm(null));
dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const body = {
    name: fd.get('name'),
    category: fd.get('category'),
    price: fd.get('price'),
    sale_price: fd.get('sale_price'),
    target_gender: fd.get('target_gender') || '',
    target_ages: fd.getAll('target_ages'),
    purposes: fd.getAll('purposes'),
    recommend_text: fd.get('recommend_text'),
    stock: fd.get('stock'),
    link: fd.get('link'),
    image: fd.get('image'),
    memo: fd.get('memo'),
  };
  try {
    if (editingId) {
      await api(`/api/staff/products/${encodeURIComponent(editingId)}`, { method: 'PUT', body });
      toast('수정했습니다');
    } else {
      const id = (fd.get('id') || '').trim();
      const saved = await api(id ? `/api/staff/products/${encodeURIComponent(id)}` : '/api/staff/products',
        { method: 'POST', body });
      toast(`추가했습니다 (${saved.id})`);
    }
    dlg.close();
    await loadProducts();
    fillSalesControls();
  } catch (ex) {
    if (ex.status === 401) { dlg.close(); handleError(ex); return; }
    $('#productError').textContent = ex.message;
  }
});

// ---------------------------------------------------------------- 판매 데이터

function fillSalesControls() {
  const sel = $('#salesProduct');
  const cur = sel.value;
  sel.innerHTML = products.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} ${esc(p.name)}</option>`).join('');
  if (cur && products.some((p) => p.id === cur)) sel.value = cur;
  const weeks = [...new Set([meta.lastWeek, meta.currentWeek, ...meta.weeks])].sort().reverse();
  $('#weekList').innerHTML = weeks.map((w) => `<option value="${w}">`).join('');
  if (!$('#salesWeek').value) $('#salesWeek').value = meta.weeks[0] || meta.lastWeek;
}

const COLS = [['남성', '본인용'], ['남성', '선물용'], ['여성', '본인용'], ['여성', '선물용']];

async function loadSales() {
  const product_id = $('#salesProduct').value;
  const week = $('#salesWeek').value.trim().toUpperCase();
  if (!product_id) return;
  if (!/^\d{4}-W\d{2}$/.test(week)) { toast('주차를 2026-W44 형식으로 입력해 주세요', 'error'); return; }
  $('#salesWeek').value = week;
  try {
    const rows = await api(`/api/staff/sales?product_id=${encodeURIComponent(product_id)}&week=${week}`);
    const q = new Map(rows.map((r) => [`${r.gender}|${r.age_group}|${r.purpose}`, r.quantity]));
    $('#salesRows').innerHTML = meta.codes.ages.map((age) => `
      <tr><th>${esc(age)}</th>
        ${COLS.map(([g, pu]) => `<td class="num"><input class="input qty-input" type="number" min="0"
          data-gender="${g}" data-age="${esc(age)}" data-purpose="${pu}" value="${q.get(`${g}|${age}|${pu}`) || 0}"></td>`).join('')}
        <td class="num" data-rowsum></td></tr>`).join('');
    updateSalesTotal();
  } catch (e) { handleError(e); }
}

function updateSalesTotal() {
  let total = 0;
  for (const tr of $('#salesRows').querySelectorAll('tr')) {
    let s = 0;
    for (const i of tr.querySelectorAll('input')) s += Number(i.value) || 0;
    tr.querySelector('[data-rowsum]').textContent = won(s);
    total += s;
  }
  $('#salesTotal').textContent = `이 주 합계 ${won(total)}개`;
}

$('#salesRows').addEventListener('input', updateSalesTotal);
$('#salesLoadBtn').addEventListener('click', loadSales);
$('#salesProduct').addEventListener('change', loadSales);
$('#salesWeek').addEventListener('change', loadSales);

$('#salesSaveBtn').addEventListener('click', async () => {
  const product_id = $('#salesProduct').value;
  const week = $('#salesWeek').value.trim().toUpperCase();
  const rows = [...$('#salesRows').querySelectorAll('input')].map((i) => ({
    product_id, week, gender: i.dataset.gender, age_group: i.dataset.age, purpose: i.dataset.purpose,
    quantity: i.value === '' ? 0 : Number(i.value),
  }));
  if (!rows.length) return;
  try {
    await api('/api/staff/sales', { method: 'PUT', body: { rows } });
    toast(`${week} 판매 데이터를 저장했습니다`);
    meta = await api('/api/staff/meta');
    fillSalesControls();
    loadProducts();
  } catch (e) { handleError(e); }
});

// ---------------------------------------------------------------- 엑셀

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

$('#templateBtn').addEventListener('click', async () => {
  try {
    const blob = await api('/api/staff/template.xlsx');
    downloadBlob(blob, `상품추천_양식_${meta.lastWeek}.xlsx`);
  } catch (e) { handleError(e); }
});

let uploadBuf = null;

function resetUpload() {
  uploadBuf = null;
  $('#uploadInput').value = '';
  $('#uploadName').textContent = '';
  $('#preview').hidden = true;
}

$('#uploadInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('#uploadName').textContent = file.name;
  uploadBuf = await file.arrayBuffer();
  try {
    const r = await api('/api/staff/upload?dryRun=true', { method: 'POST', body: uploadBuf, raw: true });
    showPreview(r);
  } catch (ex) {
    resetUpload();
    handleError(ex);
  }
});

function showPreview(r) {
  const s = r.summary;
  const card = (label, n, cls = '') => `<div class="summary-card ${cls}"><span class="muted">${label}</span><b>${won(n)}</b></div>`;
  $('#summaryCards').innerHTML = [
    card('상품 추가', s.products.add),
    card('상품 수정', s.products.update),
    card('상품 변경 없음', s.products.unchanged),
    card('판매 행 추가', s.sales.add),
    card('판매 행 수정', s.sales.update),
    card('오류(건너뜀)', r.errors.length, r.errors.length ? 'err' : ''),
  ].join('');
  $('#errorBox').hidden = !r.errors.length;
  $('#errorRows').innerHTML = r.errors.map((e) => `<tr><td>${esc(e.sheet)}</td><td>${e.row}</td><td>${esc(e.message)}</td></tr>`).join('');
  const changes = s.products.add + s.products.update + s.sales.add + s.sales.update;
  $('#applyUploadBtn').disabled = changes === 0;
  $('#applyUploadBtn').textContent = changes ? `반영하기 (${won(changes)}건)` : '바뀐 내용 없음';
  $('#preview').hidden = false;
}

$('#cancelUploadBtn').addEventListener('click', resetUpload);

$('#applyUploadBtn').addEventListener('click', async () => {
  if (!uploadBuf) return;
  $('#applyUploadBtn').disabled = true;
  try {
    const r = await api('/api/staff/upload?dryRun=false', { method: 'POST', body: uploadBuf, raw: true });
    const s = r.summary;
    toast(`반영 완료: 상품 ${s.products.add + s.products.update}건, 판매 ${s.sales.add + s.sales.update}건`);
    resetUpload();
    meta = await api('/api/staff/meta');
    await loadProducts();
    fillSalesControls();
  } catch (ex) {
    $('#applyUploadBtn').disabled = false;
    handleError(ex);
  }
});

// ---------------------------------------------------------------- 시작

if (Staff.token) unlock();
else { showLock(); unlock(); }
