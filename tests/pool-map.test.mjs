import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPoolMap,poolStatus,tileMatches,totalCounts} from '../lib/pool-map.ts';
const pool=JSON.parse(readFileSync(new URL('../app/data/questions.json',import.meta.url)));
const progress=(lastScore,nextDue)=>({attempts:1,statementCorrect:lastScore,statementTotal:5,lastScore,lastAnswered:0,nextDue});
test('status follows the last answer and its review date',()=>{
  assert.equal(poolStatus(undefined,10),'unseen');
  assert.equal(poolStatus(progress(4,99),10),'missed');
  assert.equal(poolStatus(progress(4,5),10),'missed');
  assert.equal(poolStatus(progress(5,10),10),'due');
  assert.equal(poolStatus(progress(5,11),10),'mastered');
});
test('map covers every question of one exam in domain and group order',()=>{
  for (const exam of [1,2]) {
    const domains=buildPoolMap(pool,exam,{},{},0);
    const tiles=domains.flatMap(d=>d.groups.flat());
    assert.equal(domains.length,20);
    assert.equal(tiles.length,pool.filter(q=>q.exam===exam).length);
    assert.equal(new Set(tiles.map(t=>t.index)).size,tiles.length);
    assert.deepEqual(domains.map(d=>d.area),[...Array(10).fill('Machine Learning'),...Array(10).fill('Quantitative Finance')]);
    for (const d of domains) for (const g of d.groups) assert.equal(new Set(g.map(t=>pool[t.index].groupIndex)).size,1);
  }
});
test('counts, saved markers and filters reflect progress',()=>{
  const [a,b,c]=pool.filter(q=>q.exam===1);
  const domains=buildPoolMap(pool,1,{[a.id]:progress(3,0),[b.id]:progress(5,1e12)},{[b.id]:{saved:true,changedAt:1},[c.id]:{saved:false,changedAt:2}},100);
  const counts=totalCounts(domains);
  assert.equal(counts.missed,1);assert.equal(counts.mastered,1);assert.equal(counts.due,0);
  assert.equal(counts.unseen,pool.filter(q=>q.exam===1).length-2);
  const tiles=domains.flatMap(d=>d.groups.flat());
  assert.deepEqual(tiles.filter(t=>t.saved).map(t=>t.id),[b.id]);
  const tile=tiles.find(t=>t.id===a.id);
  assert.equal(tileMatches(tile,new Set(),false),true);
  assert.equal(tileMatches(tile,new Set(['missed']),false),true);
  assert.equal(tileMatches(tile,new Set(['unseen']),false),false);
  assert.equal(tileMatches(tile,new Set(['missed']),true),false);
});
