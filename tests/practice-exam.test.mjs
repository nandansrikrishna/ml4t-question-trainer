import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createExam, finishExam, scoreExam, completeQuestion, readExams, EXAM_DURATION, shuffle } from '../lib/practice-exam.ts';
const pool = JSON.parse(readFileSync(new URL('../app/data/questions.json', import.meta.url)));
for (const exam of [1, 2]) {
  test(`Exam ${exam} samples two unique questions per domain and preserves shuffled statement identities`, () => {
    for (let run = 0; run < 20; run++) {
      const session = createExam(pool, exam, 1000);
      assert.equal(session.items.length, 40);
      assert.equal(new Set(session.items.map(i => i.question.id)).size, 40);
      assert.equal(session.deadline, 1000 + EXAM_DURATION);
      const domains = new Map();
      for (const item of session.items) {
        assert.equal(item.question.exam, exam);
        const key = `${item.question.area}:${item.question.domainIndex}`;
        domains.set(key, (domains.get(key) ?? 0) + 1);
        assert.deepEqual([...item.order].sort(), [0, 1, 2, 3, 4]);
        assert.equal(completeQuestion(item), false);
      }
      assert.equal(domains.size, 20);
      assert.ok([...domains.values()].every(count => count === 2));
      assert.deepEqual(readExams(JSON.stringify([session])), [session]);
    }
  });
}
test('scoring distinguishes unanswered from false and retains partial credit', () => {
  const session = createExam(pool, 1);
  assert.equal(scoreExam(session), 0);
  session.items.forEach(item => { item.answers = item.question.statements.map(s => s.answer); });
  assert.equal(scoreExam(session), 200);
  assert.ok(session.items.every(completeQuestion));
  session.items[0].answers[session.items[0].order[0]] = null;
  assert.equal(scoreExam(session), 199);
  assert.equal(completeQuestion(session.items[0]), false);
});
test('submission is idempotent, timeout is capped at 90 minutes, and storage preserves answers and pins', () => {
  const session = createExam(pool, 2, 1000);
  session.items[0].pinned = true;
  session.items[0].answers[2] = false;
  const submitted = finishExam(session, 61000);
  assert.equal(submitted.submittedAt, 61000);
  assert.equal(finishExam(submitted, 90000), submitted);
  assert.equal(finishExam(session, session.deadline + 100000).submittedAt, session.deadline);
  assert.deepEqual(readExams(JSON.stringify([submitted])), [submitted]);
});
test('invalid pool and corrupt session data fail explicitly', () => {
  assert.throws(() => createExam([], 1));
  assert.throws(() => readExams('{'));
  assert.throws(() => readExams('[{}]'));
  const session = createExam(pool, 1);
  session.items[0].order = [0, 0, 0, 0, 0];
  assert.throws(() => readExams(JSON.stringify([session])));
  assert.deepEqual(readExams(null), []);
});
test('shuffle uses an independent array and changes order', () => {
  const original = [0, 1, 2, 3, 4];
  assert.notDeepEqual(shuffle(original, () => 0), original);
  assert.deepEqual(original, [0, 1, 2, 3, 4]);
});
