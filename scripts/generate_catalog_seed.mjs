import { readFile, writeFile } from "node:fs/promises";

const questionsUrl = new URL("../app/data/questions.json", import.meta.url);
const keysUrl = new URL("../app/data/question-keys.json", import.meta.url);
const seedUrl = new URL("../supabase/seed.sql", import.meta.url);

const questions = JSON.parse(await readFile(questionsUrl, "utf8"));
const codes = questions.map((question) => question.id);

if (new Set(codes).size !== codes.length) {
  throw new Error("Question codes must be unique before generating the catalog seed.");
}

let questionKeys = {};
try {
  questionKeys = JSON.parse(await readFile(keysUrl, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const assignedKeys = new Set(Object.values(questionKeys));
if (assignedKeys.size !== Object.keys(questionKeys).length) {
  throw new Error("Every persisted question code must have a unique key.");
}

let nextKey = Math.max(0, ...assignedKeys) + 1;
for (const code of codes) {
  if (!questionKeys[code]) questionKeys[code] = nextKey++;
}

const entries = Object.entries(questionKeys).sort((left, right) => left[1] - right[1]);
if (entries.some(([, key]) => !Number.isInteger(key) || key < 1 || key > 32767)) {
  throw new Error("The question catalog no longer fits in a Postgres smallint.");
}

const values = entries
  .map(([code, key]) => `  (${key}, '${code.replaceAll("'", "''")}')`)
  .join(",\n");

const sql = `-- Generated from app/data/questions.json by scripts/generate_catalog_seed.mjs.
-- Existing assignments are immutable; future pool additions belong in a new migration
-- starting after question_key ${entries.at(-1)?.[1] ?? 0}.
insert into public.question_catalog (question_key, code)
values
${values};
`;

await writeFile(keysUrl, `${JSON.stringify(questionKeys, null, 2)}\n`);
await writeFile(seedUrl, sql);
