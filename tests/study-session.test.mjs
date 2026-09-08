import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStudySession, sessionStorageKey } from '../lib/study-session.ts';

const codes = new Set(['one', 'two', 'three']);
const date = '2026-09-08';
const draft = {
  version: 1, dateKey: date, questionCodes: ['two', 'one', 'three'],
  kind: 'custom', current: 1, selected: [0, 4], revealed: false, done: false,
  correct: 3, statements: 5, skipped: 0, dailyReplay: false,
};
const read = (value) => parseStudySession(JSON.stringify(value), codes, date);

test('restores order, position, selections and totals for desktop or mobile', () => {
  assert.deepEqual(read(draft), draft);
});
test('restores the revealed state so reopening does not require submission again', () => {
  const revealed = { ...draft, revealed: true, correct: 7, statements: 10 };
  assert.deepEqual(read(revealed), revealed);
});
test('retains custom sessions across dates, but expires yesterday’s Daily 5', () => {
  assert.ok(read({ ...draft, dateKey: '2026-09-07' }));
  assert.equal(read({ ...draft, kind: 'daily', dateKey: '2026-09-07' }), null);
});
test('accepts skipped and completed sessions without treating skips as answers', () => {
  assert.ok(read({ ...draft, statements: 0, correct: 0, skipped: 1 }));
  assert.ok(read({ ...draft, done: true, current: 2, statements: 10, skipped: 1 }));
});
test('rejects corrupt, inconsistent, and outdated browser state', () => {
  for (const value of [null, {}, { ...draft, version: 2 }, { ...draft, current: 3 },
    { ...draft, selected: [5] }, { ...draft, selected: [1, 1] },
    { ...draft, questionCodes: ['missing'] }, { ...draft, questionCodes: ['one', 'one'] },
    { ...draft, correct: 6 }, { ...draft, statements: 3 }, { ...draft, done: true },
    { ...draft, revealed: 'true' }]) assert.equal(read(value), null);
  assert.equal(parseStudySession('invalid json', codes, date), null);
});
test('isolates anonymous sessions and different accounts', () => {
  assert.notEqual(sessionStorageKey(), sessionStorageKey('alice'));
  assert.notEqual(sessionStorageKey('alice'), sessionStorageKey('bob'));
});
