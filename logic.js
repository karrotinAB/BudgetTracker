// 가계부 계산 로직 (DOM 없음 — 브라우저와 Node 테스트에서 함께 사용)
//
// snapshots: [{ date: 'YYYY-MM-DD', disposable: number }]
//   설정(월급/고정지출)을 저장할 때마다 그날 날짜로 "월급 - 고정지출" 값을 기록한다.
//   같은 날 여러 번 저장하면 마지막 값으로 덮어쓴다.
// days: { 'YYYY-MM-DD': [{ id, memo, amount }] }

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // m: 1~12
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
export const todayStr = (now = new Date()) =>
  ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());

export const fixedTotal = (settings) =>
  (settings.fixed || []).reduce((a, f) => a + (Number(f.amount) || 0), 0);
export const disposableOf = (settings) => (Number(settings.salary) || 0) - fixedTotal(settings);

/** 설정 저장 시 스냅샷 갱신 (같은 날짜면 교체, 직전 값과 같으면 기록하지 않음) */
export function upsertSnapshot(snapshots, date, disposable) {
  const rest = sortSnaps(snapshots.filter((s) => s.date !== date));
  const prev = rest.filter((s) => s.date < date).pop();
  if (prev && prev.disposable === disposable) return rest;
  rest.push({ date, disposable });
  return sortSnaps(rest);
}

const sortSnaps = (snaps) => [...snaps].sort((a, b) => (a.date < b.date ? -1 : 1));

export const monthKey = (y, m) => `${y}-${pad(m)}`;
/** 해당 월의 추가 대지출 합계 */
export const extrasTotal = (extras, key) =>
  (extras || []).filter((e) => e.month === key).reduce((a, e) => a + (Number(e.amount) || 0), 0);

/**
 * 해당 월 각 날짜의 기본 금액 배열 (index 0 = 1일).
 * - 월초 기준 (월급 - 고정지출 - 그 달 추가 대지출) ÷ 일수, 원 단위 내림
 * - 월 중간에 설정이 바뀌거나 추가 대지출이 생기면:
 *   (새 남는 금액 - 이미 배정된 금액) ÷ 남은 일수 로 그날부터 재배정
 * - 첫 설정이 월 중간이면 그날부터 시작 (하루 금액은 동일, 그 이전 날짜는 0)
 * extras: [{ month: 'YYYY-MM', amount, added: 'YYYY-MM-DD' }]
 * 설정 이전 달이면 null.
 */
export function monthBases(snapshots, y, m, extras = []) {
  if (!snapshots || !snapshots.length) return null;
  const snaps = sortSnaps(snapshots);
  const N = daysInMonth(y, m);
  const start = ymd(y, m, 1);
  const end = ymd(y, m, N);
  if (snaps[0].date > end) return null;

  const startEff = snaps[0].date > start ? snaps[0].date : start;
  const key = monthKey(y, m);
  const ex = (extras || []).filter((e) => e.month === key).map((e) => ({
    amount: Number(e.amount) || 0,
    // 월 시작 전(미리 등록)이나 날짜가 없으면 그 달 처음부터 적용
    date: e.added && e.added > startEff && e.added <= end ? e.added : startEff,
  }));

  const dispAt = (date) => {
    let base = snaps[0].disposable;
    for (const s of snaps) if (s.date <= date) base = s.disposable;
    return base - ex.filter((e) => e.date <= date).reduce((a, e) => a + e.amount, 0);
  };

  const changeDays = new Set();
  for (const s of snaps) if (s.date > startEff && s.date <= end) changeDays.add(Number(s.date.slice(8)));
  for (const e of ex) if (e.date > startEff) changeDays.add(Number(e.date.slice(8)));

  let allocated = 0;
  let daily = Math.floor(dispAt(startEff) / N);
  const bases = [];
  for (let d = 1; d <= N; d++) {
    if (changeDays.has(d)) daily = Math.floor((dispAt(ymd(y, m, d)) - allocated) / (N - d + 1));
    bases.push(daily);
    allocated += daily;
  }
  // 가계부 시작 전 날짜는 예산 없음
  if (startEff > start) {
    const firstDay = Number(startEff.slice(8));
    for (let d = 1; d < firstDay; d++) bases[d - 1] = 0;
  }
  return bases;
}

export const daySpend = (days, date) =>
  (days[date] || []).reduce((a, e) => a + (Number(e.amount) || 0), 0);

function monthSpendTotal(days, y, m) {
  const prefix = `${y}-${pad(m)}-`;
  let t = 0;
  for (const k of Object.keys(days)) if (k.startsWith(prefix)) t += daySpend(days, k);
  return t;
}

/** 이전 달들에서 넘어오는 이월금 (남은 돈/초과 지출 모두 이월) */
export function carryInto(snapshots, days, y, m, extras = []) {
  if (!snapshots || !snapshots.length) return 0;
  const first = sortSnaps(snapshots)[0].date;
  let cy = Number(first.slice(0, 4));
  let cm = Number(first.slice(5, 7));
  let carry = 0;
  while (cy < y || (cy === y && cm < m)) {
    const bases = monthBases(snapshots, cy, cm, extras);
    if (bases) carry += bases.reduce((a, b) => a + b, 0) - monthSpendTotal(days, cy, cm);
    cm++;
    if (cm > 12) { cm = 1; cy++; }
  }
  return carry;
}

/**
 * 달력 한 달치 계산.
 * available(d) = 이월금 + Σbase(1..d) - Σspent(1..d-1)
 * remaining(d) = available(d) - spent(d)  → 다음 날 가용금액에 더해짐 (음수면 빠짐)
 */
export function computeMonth(state, y, m, today = todayStr()) {
  const extras = state.settings?.extras || [];
  const bases = monthBases(state.snapshots, y, m, extras);
  if (!bases) return null;
  const carryIn = carryInto(state.snapshots, state.days, y, m, extras);
  let acc = carryIn;
  const out = [];
  const startDate = [...state.snapshots].sort((a, b) => (a.date < b.date ? -1 : 1))[0].date;
  bases.forEach((base, i) => {
    const date = ymd(y, m, i + 1);
    if (date < startDate) {
      out.push({ date, day: i + 1, base: 0, spent: 0, available: 0, remaining: 0, status: 'inactive' });
      return;
    }
    const spent = daySpend(state.days, date);
    const available = acc + base;
    const remaining = available - spent;
    acc = remaining;
    out.push({
      date, day: i + 1, base, spent, available, remaining,
      status: date < today ? 'past' : date === today ? 'today' : 'future',
    });
  });
  return {
    carryIn,
    days: out,
    budget: bases.reduce((a, b) => a + b, 0),
    spent: out.reduce((a, d) => a + d.spent, 0),
  };
}
