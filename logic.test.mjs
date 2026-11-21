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

console.log('all logic tests passed');
