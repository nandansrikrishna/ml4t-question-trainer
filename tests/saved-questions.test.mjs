import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSavedQuestions, readSavedQuestions, savedQuestionIndexes, savedQuestionsKey } from '../lib/saved-questions.ts';
import { summarizeQuestion } from '../lib/answer-history.ts';

const keys = { q1: 1, q2: 2 };
test('saved questions remain eligible after a perfect answer and a reload', () => {
  const saved = readSavedQuestions(JSON.stringify({ q1: { saved: true, changedAt: 1 } }), keys);
  const before = JSON.stringify(saved);
  const progress = summarizeQuestion([{ id: 'a', questionCode: 'q1', score: 5, answerMask: 31, answeredAt: 1000, source: 'exam' }]);
  assert.equal(progress.lastScore, 5);
  assert.deepEqual(savedQuestionIndexes([{ id: 'q1' }, { id: 'q2' }], saved), [0]);
  assert.equal(JSON.stringify(saved), before);
});
test('removed questions do not return when an old device reconnects', () => {
  const old = { q1: { saved: true, changedAt: 1 } };
  const removed = { q1: { saved: false, changedAt: 2 } };
  for (const merged of [mergeSavedQuestions(old, removed), mergeSavedQuestions(removed, old)]) {
    assert.deepEqual(savedQuestionIndexes([{ id: 'q1' }], merged), []);
    assert.deepEqual(merged, removed);
  }
  assert.deepEqual(mergeSavedQuestions(removed, { q1: { saved: true, changedAt: 3 } }).q1, { saved: true, changedAt: 3 });
});
test('simultaneous removal wins regardless of merge direction', () => {
  const yes = { q1: { saved: true, changedAt: 5 } };
  const no = { q1: { saved: false, changedAt: 5 } };
  assert.deepEqual(mergeSavedQuestions(yes, no), no);
  assert.deepEqual(mergeSavedQuestions(no, yes), no);
});
test('invalid caches and unknown questions are ignored', () => {
  for (const raw of ['bad', 'null', '[]', '42']) assert.deepEqual(readSavedQuestions(raw, keys), {});
  assert.deepEqual(readSavedQuestions(JSON.stringify({ q1: { saved: true, changedAt: -1 }, q2: { saved: 'true', changedAt: 1 }, unknown: { saved: true, changedAt: 1 } }), keys), {});
});
test('guest and account caches never share an identity', () => {
  assert.equal(new Set([savedQuestionsKey(null), savedQuestionsKey('user-a'), savedQuestionsKey('user-b')]).size, 3);
});
