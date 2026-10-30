// 추천 화면과 관리 화면이 함께 쓰는 함수
const TOKEN_KEY = 'staffToken';

const Staff = {
  get token() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set token(v) {
    try {
      if (v) sessionStorage.setItem(TOKEN_KEY, v);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* 저장소를 못 쓰면 이 페이지에서만 유지 */ }
  },
};

class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function api(url, { method = 'GET', body, raw, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (Staff.token) opts.headers['X-Staff-Token'] = Staff.token;
  if (body !== undefined) {
    if (raw) {
      opts.body = body;
      opts.headers['Content-Type'] = 'application/octet-stream';
    } else {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.blob();
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `요청 실패 (${res.status})`, data);
  return data;
}

async function login(pin) {
  const { token } = await api('/api/auth', { method: 'POST', body: { pin } });
  Staff.token = token;
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* 이미 만료 */ }
  Staff.token = null;
}

const won = (n) => Number(n).toLocaleString('ko-KR');
const finalPrice = (p) => (p.sale_price != null ? p.sale_price : p.price);
const discountRate = (p) => (p.sale_price != null ? Math.round((1 - p.sale_price / p.price) * 100) : 0);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer;
function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
}

// 사내망(http)에서는 navigator.clipboard를 못 쓰므로 textarea 방식으로 대체한다
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 아래로 */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// PIN 입력 대화상자. 성공하면 true
function askPin() {
  return new Promise((resolve) => {
    const dlg = document.getElementById('pinDialog');
    const form = dlg.querySelector('form');
    const input = dlg.querySelector('input');
    const err = dlg.querySelector('.pin-error');
    const cancel = dlg.querySelector('[data-cancel]');
    input.value = '';
    err.textContent = '';
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      resolve(ok);
    };
    const onSubmit = async (e) => {
      e.preventDefault();
      if (!/^\d{4}$/.test(input.value)) { err.textContent = '숫자 4자리를 입력해 주세요'; return; }
      try {
        await login(input.value);
        finish(true);
      } catch (ex) {
        err.textContent = ex.message;
        input.select();
      }
    };
    const onCancel = () => finish(false);
    const onClose = () => finish(false);

    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    input.focus();
  });
}
