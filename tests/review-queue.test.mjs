import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewBatch, REVIEW_BATCH_SIZE } from '../lib/review-queue.ts';

const candidates = Array.from({ length: 25 }, (_, index) => ({ item: { id: `q${index}` }, index }));
const state = (nextDue) => ({ attempts: 1, lastScore: 3, nextDue, lastAnswered: 0, statementCorrect: 3, statementTotal: 5 });

test('refill excludes queued questions and continues beyond the initial batch', () => {
  const first = buildReviewBatch(candidates, {}, [], [], 100, true, () => 0);
  const second = buildReviewBatch(candidates, {}, first.slice(0, 7), first.slice(7), 100, true, () => 0);
  assert.equal(first.length, REVIEW_BATCH_SIZE);
  assert.equal(second.length, REVIEW_BATCH_SIZE);
  assert.deepEqual(second, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
});

test('unseen questions precede due and future reviews', () => {
  const batch = buildReviewBatch(candidates.slice(0, 3), { q0: state(50), q1: state(200) }, [], [], 100, true, () => 0);
  assert.deepEqual(batch, [2, 0, 1]);
});

test('skipped unseen questions do not crowd out fresh questions', () => {
  const batch = buildReviewBatch(candidates.slice(0, 3), {}, [0], [], 100, true, () => 0);
  assert.deepEqual(batch, [1, 2, 0]);
});

test('small decks wait until the current question is finished before repeating', () => {
  const single = candidates.slice(0, 1);
  assert.deepEqual(buildReviewBatch(single, {}, [], [0], 100, false), []);
  assert.deepEqual(buildReviewBatch(single, {}, [0], [], 100, false), [0]);
  assert.deepEqual(buildReviewBatch([], {}, [0], [], 100, false), []);
});

test('repeated questions favor the least recently served', () => {
  assert.deepEqual(buildReviewBatch(candidates.slice(0, 3), {}, [2, 0, 1], [], 100, true, () => 0), [2, 0, 1]);
});
