import assert from 'node:assert/strict';
import { monthBases, computeMonth, carryInto, upsertSnapshot } from './logic.js';

const snaps = [{ date: '2026-11-01', disposable: 2_000_000 }];

// 1) 300만 - 100만 = 200만 / 30일 → 66,666 (내림)
const b = monthBases(snaps, 2026, 11);
assert.equal(b.length, 30);
assert.ok(b.every((x) => x === 66_666));

// 2) 남은 금액 이월
const days = { '2026-11-01': [{ id: 'a', memo: '점심', amount: 20_000 }] };
let mo = computeMonth({ snapshots: snaps, days }, 2026, 11, '2026-11-02');
assert.equal(mo.days[0].available, 66_666);
assert.equal(mo.days[0].remaining, 46_666);
assert.equal(mo.days[1].available, 113_332);
assert.equal(mo.days[0].status, 'past');
assert.equal(mo.days[1].status, 'today');

// 3) 초과 지출은 다음 날에서 빠짐
const over = { '2026-11-01': [{ id: 'a', memo: '쇼핑', amount: 100_000 }] };
mo = computeMonth({ snapshots: snaps, days: over }, 2026, 11, '2026-11-02');
assert.equal(mo.days[0].remaining, -33_334);
assert.equal(mo.days[1].available, 33_332);

// 4) 월 중간 고정지출 추가 → 남은 날에서 차감
// 21일에 고정지출 10만 추가: 남는 돈 190만. 1~20일 배정 66,666*20=1,333,320
// 남은 10일: (1,900,000 - 1,333,320) / 10 = 56,668
const s2 = upsertSnapshot(snaps, '2026-11-21', 1_900_000);
const b2 = monthBases(s2, 2026, 11);
assert.equal(b2[19], 66_666);
assert.equal(b2[20], 56_668);
assert.equal(b2[29], 56_668);
// 다음 달은 새 금액 기준: 190만 / 31
assert.equal(monthBases(s2, 2026, 12)[0], Math.floor(1_900_000 / 31));

// 5) 월말 잔액은 다음 달로 이월
const carry = carryInto(snaps, days, 2026, 12);
assert.equal(carry, 66_666 * 30 - 20_000);
const dec = computeMonth({ snapshots: snaps, days }, 2026, 12, '2026-12-01');
assert.equal(dec.days[0].available, carry + Math.floor(2_000_000 / 31));

// 6) 첫 설정이 월 중간이면 그날부터 시작 (하루 금액은 동일)
const mid = [{ date: '2026-11-21', disposable: 2_000_000 }];
const bm = monthBases(mid, 2026, 11);
assert.equal(bm[19], 0);
assert.equal(bm[20], 66_666);
const mm = computeMonth({ snapshots: mid, days: {} }, 2026, 11, '2026-11-21');
assert.equal(mm.days[0].status, 'inactive');
assert.equal(mm.days[20].available, 66_666);
assert.equal(carryInto(mid, {}, 2026, 12), 66_666 * 10);
assert.equal(monthBases(mid, 2026, 10), null);

// 7) 같은 날 다시 저장하면 교체
assert.equal(upsertSnapshot(mid, '2026-11-21', 1).length, 1);

// 8) 직전과 같은 값이면 스냅샷을 추가하지 않음 (재계산 오차 방지)
assert.equal(upsertSnapshot(snaps, '2026-11-15', 2_000_000).length, 1);

// 9) 추가 대지출 — 미리 등록하면 그 달 처음부터 반영
const ex1 = [{ month: '2026-12', amount: 310_000, added: '2026-11-21' }];
assert.equal(monthBases(snaps, 2026, 12, ex1)[0], Math.floor((2_000_000 - 310_000) / 31));
// 다른 달엔 영향 없음
assert.equal(monthBases(snaps, 2027, 1, ex1)[0], Math.floor(2_000_000 / 31));

// 10) 추가 대지출 — 월 중간 등록이면 그날부터 남은 날에서 차감
// 21일에 30만: (2,000,000 - 300,000 - 1,333,320) / 10 = 36,668
const ex2 = [{ month: '2026-11', amount: 300_000, added: '2026-11-21' }];
const b3 = monthBases(snaps, 2026, 11, ex2);
assert.equal(b3[19], 66_666);
assert.equal(b3[20], 36_668);
const mo3 = computeMonth({ snapshots: snaps, days: {}, settings: { extras: ex2 } }, 2026, 11, '2026-11-21');
assert.equal(mo3.budget, 2_000_000 - 300_000);
// 다음 달 이월도 대지출 반영
assert.equal(carryInto(snaps, {}, 2026, 12, ex2), 1_700_000);

// 11) 지난달 초과 지출 → 다음 달 전체에 나눠 빠짐 (1일에 몰아서 빠지지 않음)
// 11월 예산 1,999,980 중 2,309,980 사용 → 31만 초과
const debtDays = { '2026-11-10': [{ id: 'x', memo: '큰 지출', amount: 2_309_980 }] };
const st11 = { snapshots: snaps, days: debtDays, settings: { extras: [] } };
const decM = computeMonth(st11, 2026, 12, '2026-12-01');
assert.equal(decM.debt, 310_000);
assert.equal(decM.carryIn, 0);
assert.equal(decM.days[0].base, Math.floor((2_000_000 - 310_000) / 31));
assert.equal(decM.days[0].available, decM.days[0].base);
// 12월을 예산대로 쓰면 1월엔 빚이 남지 않음
const janM = computeMonth(st11, 2027, 1, '2027-01-01');
assert.equal(janM.debt, 0);
assert.ok(janM.carryIn >= 0);

// 12) 시작일 이전 기록은 이월 계산에서도 제외
const midDays = { '2026-11-05': [{ id: 'y', memo: '시작 전', amount: 999_999 }] };
assert.equal(computeMonth({ snapshots: mid, days: midDays }, 2026, 12, '2026-12-01').debt, 0);

console.log('all logic tests passed');
