import {
  computeMonth, todayStr, daysInMonth, disposableOf, fixedTotal, upsertSnapshot, monthBases,
  monthKey, extrasTotal,
} from './logic.js';
import {
  firebaseEnabled, watchAuth, startLocal, signInEmail, signUpEmail, signInGoogle, signOut,
  storeFor, authErrorMessage,
} from './store.js';

const $app = document.getElementById('app');
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const num = (n) => Math.round(n).toLocaleString('ko-KR');
const cellNum = (n) => (Math.abs(n) >= 1_000_000 ? `${Math.floor(n / 10_000).toLocaleString('ko-KR')}만` : num(n));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseMoney = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const S = {
  user: null,
  store: null,
  data: null,
  tab: 'home',
  view: null, // { y, m }
};

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1600);
}

// 금액 입력칸: 입력하는 동안 쉼표 표시
function bindMoneyInputs(root) {
  root.querySelectorAll('input[data-money]').forEach((el) => {
    el.addEventListener('input', () => {
      const v = parseMoney(el.value);
      el.value = v ? v.toLocaleString('ko-KR') : '';
    });
  });
}

// ---------------- 로그인 ----------------
function renderLogin(mode = 'signin', err = '') {
  const signup = mode === 'signup';
  $app.innerHTML = `
    <div class="login">
      <img class="logo" src="icon.svg" alt="" />
      <h1>하루가계부</h1>
      <p class="lead">월급에서 고정지출을 빼고,<br/>남은 돈을 하루 단위로 나눠 써요.</p>
      ${firebaseEnabled ? `
        <form id="f">
          <div class="field"><input class="input" name="email" type="email" autocomplete="email" placeholder="이메일" required /></div>
          <div class="field"><input class="input" name="pw" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="비밀번호 (6자 이상)" required minlength="6" /></div>
          <div class="err">${esc(err)}</div>
          <button class="btn" type="submit">${signup ? '회원가입' : '로그인'}</button>
        </form>
        <button class="link" id="toggle">${signup ? '이미 계정이 있어요 · 로그인' : '처음이에요 · 회원가입'}</button>
        <div class="or">또는</div>
        <button class="btn ghost" id="google">Google로 계속하기</button>
      ` : `
        <div class="notice">
          아직 로그인 서버(Firebase)가 연결되지 않았어요.<br/>
          <b>firebase-config.js</b>에 설정값을 넣으면 로그인과 기기 간 동기화가 켜져요.
          지금은 이 기기에만 저장되는 체험 모드로 쓸 수 있어요.
        </div>
        <button class="btn" id="local">체험 모드로 시작</button>
      `}
    </div>`;

  if (!firebaseEnabled) {
    document.getElementById('local').onclick = async () => { await startLocal(); boot(); };
    return;
  }
  document.getElementById('toggle').onclick = () => renderLogin(signup ? 'signin' : 'signup');
  document.getElementById('google').onclick = async () => {
    try { await signInGoogle(); } catch (e) { renderLogin(mode, authErrorMessage(e)); }
  };
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const btn = ev.target.querySelector('button');
    btn.disabled = true;
    try {
      if (signup) await signUpEmail(fd.get('email'), fd.get('pw'));
      else await signInEmail(fd.get('email'), fd.get('pw'));
    } catch (e) {
      renderLogin(mode, authErrorMessage(e));
    }
  };
}

// ---------------- 공통 레이아웃 ----------------
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

function render() {
  const body = S.tab === 'home' ? homeHTML() : settingsHTML();
  $app.innerHTML = `
    ${body}
    <nav class="tabbar"><div class="inner">
      <button class="tab ${S.tab === 'home' ? 'on' : ''}" data-tab="home">${ICONS.home}홈</button>
      <button class="tab ${S.tab === 'settings' ? 'on' : ''}" data-tab="settings">${ICONS.settings}설정</button>
    </div></nav>`;
  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
  if (S.tab === 'home') bindHome(); else bindSettings();
}

// ---------------- 홈 ----------------
function homeHTML() {
  const { y, m } = S.view;
  const today = todayStr();
  const mo = computeMonth(S.data, y, m, today);
  const isThisMonth = today.startsWith(`${y}-${String(m).padStart(2, '0')}`);

  let summary = '';
  if (mo && isThisMonth) {
    const t = mo.days.find((d) => d.status === 'today');
    summary = `
      <section class="card summary">
        <div class="label">오늘 남은 돈</div>
        <div class="big num ${t.remaining < 0 ? 'neg' : ''}">${won(t.remaining)}</div>
        <div class="row num">
          <span>오늘 가용 <b>${num(t.available)}</b></span>
          <span>사용 <b>${num(t.spent)}</b></span>
          <span>하루 기본 <b>${num(t.base)}</b></span>
        </div>
      </section>`;
  } else if (mo) {
    summary = `
      <section class="card summary">
        <div class="label">${m}월 예산</div>
        <div class="big num">${won(mo.budget)}</div>
        <div class="row num">
          <span>지난달 이월 <b>${num(mo.carryIn)}</b></span>
          <span>사용 <b>${num(mo.spent)}</b></span>
        </div>
      </section>`;
  }

  const first = new Date(y, m - 1, 1).getDay();
  const N = daysInMonth(y, m);
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<div class="cell empty"></div>';
  for (let d = 1; d <= N; d++) {
    const dow = (first + d - 1) % 7;
    const cls = ['cell', dow === 0 ? 'sun' : '', dow === 6 ? 'sat' : ''];
    let inner = `<span class="d">${d}</span>`;
    if (mo) {
      const x = mo.days[d - 1];
      if (x.status === 'today') cls.push('today');
      if (x.status === 'inactive') {
        cls.push('inactive');
      } else if (x.status === 'future') {
        inner += `<span class="v base num">${cellNum(x.base)}</span>`;
        if (x.spent) inner += `<span class="v spent num">-${cellNum(x.spent)}</span>`;
      } else {
        inner += `<span class="v avail num">${cellNum(x.available)}</span>`;
        if (x.spent) inner += `<span class="v spent num">-${cellNum(x.spent)}</span>`;
        inner += `<span class="v rem num ${x.remaining < 0 ? 'neg' : ''}">${cellNum(x.remaining)}</span>`;
      }
    }
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells += `<button class="${cls.join(' ')}" data-date="${date}" aria-label="${m}월 ${d}일">${inner}</button>`;
  }

  return `
    <main class="page">
      ${summary}
      <section class="card">
        <div class="cal-head">
          <button class="icon-btn" id="prev" aria-label="이전 달">‹</button>
          <div class="month">${y}년 ${m}월</div>
          <button class="icon-btn" id="next" aria-label="다음 달">›</button>
        </div>
        ${mo ? `
          <div class="grid">
            ${['일', '월', '화', '수', '목', '금', '토'].map((w, i) => `<div class="wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}
            ${cells}
          </div>
          <div class="legend">
            <span><i style="background:var(--sub)"></i>가용</span>
            <span><i style="background:var(--red)"></i>사용</span>
            <span><i style="background:var(--blue)"></i>남은 돈 (다음 날로)</span>
            <span><i style="background:var(--faint)"></i>기본 금액</span>
          </div>` : `
          <div class="empty-state">
            ${S.data.snapshots.length ? '이 달은 가계부를 시작하기 전이에요.' : '먼저 설정에서 월급과 고정지출을 입력해주세요.'}
            ${S.data.snapshots.length ? '' : '<div style="margin-top:14px"><button class="btn small" id="goSettings">설정하러 가기</button></div>'}
          </div>`}
      </section>
    </main>`;
}

function bindHome() {
  const move = (delta) => {
    let { y, m } = S.view;
    m += delta;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    S.view = { y, m };
    render();
  };
  document.getElementById('prev').onclick = () => move(-1);
  document.getElementById('next').onclick = () => move(1);
  const go = document.getElementById('goSettings');
  if (go) go.onclick = () => { S.tab = 'settings'; render(); };
  $app.querySelectorAll('.cell[data-date]').forEach((c) => (c.onclick = () => openDay(c.dataset.date)));
}

// ---------------- 날짜 상세 (바텀시트) ----------------
function openDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  const close = () => { bg.remove(); sheet.remove(); render(); };

  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.onclick = close;
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  document.body.append(bg, sheet);

  const draw = () => {
    const mo = computeMonth(S.data, y, m);
    const x0 = mo?.days[d - 1];
    const x = x0?.status === 'inactive' ? null : x0;
    const items = S.data.days[date] || [];
    const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
    sheet.innerHTML = `
      <div class="grab"></div>
      <h3>${m}월 ${d}일 (${dow})</h3>
      ${x ? `
        <div class="stats num">
          <div class="stat"><small>${x.status === 'future' ? '기본 금액' : '가용 금액'}</small><b>${num(x.status === 'future' ? x.base : x.available)}</b></div>
          <div class="stat"><small>사용</small><b style="color:var(--red)">${num(x.spent)}</b></div>
          ${x.status === 'future' ? '' : `<div class="stat"><small>남은 돈</small><b style="color:${x.remaining < 0 ? 'var(--red)' : 'var(--blue)'}">${num(x.remaining)}</b></div>`}
        </div>` : `<p class="muted">${x0 ? '가계부 시작 전 날짜예요. 기록은 남길 수 있지만 계산에는 들어가지 않아요.' : '설정을 먼저 입력하면 가용 금액이 계산돼요.'}</p>`}
      <ul class="list">
        ${items.length ? items.map((it) => `
          <li><span class="name">${esc(it.memo || '지출')}</span><span class="amt red num">-${num(it.amount)}</span>
          <button class="del" data-id="${it.id}" aria-label="삭제">×</button></li>`).join('')
          : '<li class="muted">아직 사용 내역이 없어요.</li>'}
      </ul>
      <form id="addForm" style="margin-top:14px">
        <div class="field"><input class="input" name="memo" placeholder="내역 (예: 점심)" maxlength="40" /></div>
        <div class="inline">
          <div class="money" style="flex:1"><input class="input num" name="amount" data-money inputmode="numeric" placeholder="금액" required /></div>
          <button class="btn small" type="submit">추가</button>
        </div>
      </form>`;
    bindMoneyInputs(sheet);
    sheet.querySelectorAll('.del').forEach((b) => (b.onclick = async () => {
      const next = items.filter((i) => i.id !== b.dataset.id);
      await saveDay(date, next);
      draw();
    }));
    sheet.querySelector('#addForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const amount = parseMoney(fd.get('amount'));
      if (!amount) return;
      await saveDay(date, [...items, { id: uid(), memo: String(fd.get('memo') || '').trim(), amount }]);
      draw();
      toast('기록했어요');
    };
  };
  draw();
}

async function saveDay(date, items) {
  if (items.length) S.data.days[date] = items; else delete S.data.days[date];
  try { await S.store.saveDay(date, items); } catch { toast('저장에 실패했어요'); }
}

// ---------------- 설정 ----------------
function settingsHTML() {
  const st = S.data.settings;
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const N = daysInMonth(y, m);
  const disp = disposableOf(st);
  const curKey = monthKey(y, m);
  const extras = st.extras || [];
  const exThis = extrasTotal(extras, curKey);
  const bases = monthBases(S.data.snapshots, y, m, extras);
  const todayBase = bases ? bases[now.getDate() - 1] : Math.floor((disp - exThis) / N);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return { key: monthKey(d.getFullYear(), d.getMonth() + 1), label: `${d.getFullYear() !== y ? `${d.getFullYear()}년 ` : ''}${d.getMonth() + 1}월` };
  });
  const labelOf = (k) => { const [yy, mm] = k.split('-').map(Number); return `${yy !== y ? `${yy}년 ` : ''}${mm}월`; };
  const shownExtras = extras.filter((e) => e.month >= curKey).sort((a, b) => (a.month < b.month ? -1 : 1));

  return `
    <main class="page">
      <div class="page-title">설정</div>
      <section class="card">
        <h2>월급</h2>
        <div class="money"><input class="input num" id="salary" data-money inputmode="numeric" value="${st.salary ? num(st.salary) : ''}" placeholder="0" /></div>
      </section>

      <section class="card">
        <h2>고정 지출</h2>
        <ul class="list" id="fixedList">
          ${(st.fixed || []).map((f) => `
            <li><span class="name">${esc(f.name)}</span><span class="amt num">${num(f.amount)}원</span>
            <button class="del" data-id="${f.id}" aria-label="삭제">×</button></li>`).join('')
            || '<li class="muted">투자, 월세, 통신비처럼 매달 나가는 돈을 추가하세요.</li>'}
        </ul>
        <form id="fixedForm" style="margin-top:12px">
          <div class="field"><input class="input" name="name" placeholder="항목 (예: 투자)" maxlength="30" required /></div>
          <div class="inline">
            <div class="money" style="flex:1"><input class="input num" name="amount" data-money inputmode="numeric" placeholder="금액" required /></div>
            <button class="btn small" type="submit">추가</button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2>추가 대지출</h2>
        <p class="muted" style="margin:-4px 0 6px">그 달에만 나가는 큰 돈 (경조사비, 여행, 보험 연납 등). 그 달 남은 날짜에서 나눠 빠져요.</p>
        <ul class="list" id="extraList">
          ${shownExtras.map((e) => `
            <li><span class="chip">${labelOf(e.month)}</span><span class="name">${esc(e.name)}</span><span class="amt num">${num(e.amount)}원</span>
            <button class="del" data-id="${e.id}" aria-label="삭제">×</button></li>`).join('')
            || '<li class="muted">등록된 추가 대지출이 없어요.</li>'}
        </ul>
        <form id="extraForm" style="margin-top:12px">
          <div class="inline field">
            <select class="input" name="month" style="flex:0 0 112px">
              ${months.map((mo) => `<option value="${mo.key}">${mo.label}</option>`).join('')}
            </select>
            <input class="input" name="name" placeholder="항목 (예: 결혼식)" maxlength="30" required style="flex:1" />
          </div>
          <div class="inline">
            <div class="money" style="flex:1"><input class="input num" name="amount" data-money inputmode="numeric" placeholder="금액" required /></div>
            <button class="btn small" type="submit">추가</button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2>이번 달 계산 (${m}월 · ${N}일)</h2>
        <div class="calc-row"><span>월급</span><b class="num">${won(st.salary || 0)}</b></div>
        <div class="calc-row"><span>고정 지출</span><b class="num">-${won(fixedTotal(st))}</b></div>
        ${exThis ? `<div class="calc-row"><span>추가 대지출</span><b class="num">-${won(exThis)}</b></div>` : ''}
        <div class="calc-row"><span>남는 금액</span><b class="num">${won(disp - exThis)}</b></div>
        <div class="calc-row total"><span>오늘 하루 기본 금액</span><b class="num">${won(todayBase)}</b></div>
        <p class="muted" style="margin:10px 0 0">월 중간에 바꾸면 오늘부터 남은 날짜에 나눠서 반영돼요. 원 단위 이하는 내림해요.</p>
      </section>

      <section class="card">
        <h2>계정</h2>
        <div class="calc-row"><span>${S.user.local ? '체험 모드 (이 기기에만 저장)' : esc(S.user.email || S.user.name || '')}</span></div>
        <button class="btn ghost" id="logout" style="margin-top:8px">${S.user.local ? '체험 모드 종료' : '로그아웃'}</button>
      </section>
    </main>`;
}

async function saveSettings(settings) {
  S.data.settings = settings;
  S.data.snapshots = upsertSnapshot(S.data.snapshots, todayStr(), disposableOf(settings));
  try { await S.store.saveSettings(settings, S.data.snapshots); toast('저장했어요'); }
  catch { toast('저장에 실패했어요'); }
}

function bindSettings() {
  bindMoneyInputs($app);
  const sal = document.getElementById('salary');
  sal.onchange = async () => {
    await saveSettings({ ...S.data.settings, salary: parseMoney(sal.value) });
    render();
  };
  sal.onkeydown = (e) => { if (e.key === 'Enter') sal.blur(); };
  document.getElementById('extraForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const amount = parseMoney(fd.get('amount'));
    const name = String(fd.get('name') || '').trim();
    if (!name || !amount) return;
    const st = S.data.settings;
    const item = { id: uid(), month: String(fd.get('month')), name, amount, added: todayStr() };
    await saveSettings({ ...st, extras: [...(st.extras || []), item] });
    render();
  };
  $app.querySelectorAll('#extraList .del').forEach((b) => (b.onclick = async () => {
    const st = S.data.settings;
    await saveSettings({ ...st, extras: (st.extras || []).filter((e) => e.id !== b.dataset.id) });
    render();
  }));
  document.getElementById('fixedForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const amount = parseMoney(fd.get('amount'));
    const name = String(fd.get('name') || '').trim();
    if (!name || !amount) return;
    const st = S.data.settings;
    await saveSettings({ ...st, fixed: [...(st.fixed || []), { id: uid(), name, amount }] });
    render();
  };
  $app.querySelectorAll('#fixedList .del').forEach((b) => (b.onclick = async () => {
    const st = S.data.settings;
    await saveSettings({ ...st, fixed: st.fixed.filter((f) => f.id !== b.dataset.id) });
    render();
  }));
  document.getElementById('logout').onclick = async () => {
    if (!confirm(S.user.local ? '체험 모드를 종료할까요? (기록은 이 기기에 남아요)' : '로그아웃할까요?')) return;
    await signOut(S.user);
  };
}

// ---------------- 시작 ----------------
function boot() {
  watchAuth(async (user) => {
    if (!user) { S.user = null; renderLogin(); return; }
    S.user = user;
    S.store = storeFor(user);
    $app.innerHTML = '<div class="splash">불러오는 중…</div>';
    try { S.data = await S.store.load(); }
    catch { $app.innerHTML = '<div class="splash">데이터를 불러오지 못했어요. 새로고침 해주세요.</div>'; return; }
    const now = new Date();
    S.view = { y: now.getFullYear(), m: now.getMonth() + 1 };
    S.tab = S.data.snapshots.length ? 'home' : 'settings';
    render();
  }).catch(() => { $app.innerHTML = '<div class="splash">로그인 서버에 연결하지 못했어요.</div>'; });
}

// 앱을 켜둔 채 날짜가 바뀌거나, 다시 앱으로 돌아왔을 때 '오늘'을 갱신
let lastDay = todayStr();
const refreshIfNewDay = () => {
  const t = todayStr();
  if (t !== lastDay && S.data && !document.querySelector('.sheet')) {
    lastDay = t;
    const now = new Date();
    S.view = { y: now.getFullYear(), m: now.getMonth() + 1 };
    render();
  }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfNewDay(); });
setInterval(refreshIfNewDay, 60_000);

boot();
