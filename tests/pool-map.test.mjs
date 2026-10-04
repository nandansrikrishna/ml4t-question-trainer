import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPoolMap,filterPoolDomains,poolStatus,tileMatches,totalCounts} from '../lib/pool-map.ts';
import {buildQuestionQueue} from '../lib/review-queue.ts';
const pool=JSON.parse(readFileSync(new URL('../app/data/questions.json',import.meta.url)));
const progress=(lastScore,nextDue)=>({attempts:1,statementCorrect:lastScore,statementTotal:5,lastScore,lastAnswered:0,nextDue});
test('status follows the last answer and its review date',()=>{
  assert.equal(poolStatus(undefined,10),'unseen');
  assert.equal(poolStatus(progress(4,99),10),'missed');
  assert.equal(poolStatus(progress(4,5),10),'due');
  assert.equal(poolStatus(progress(4,10),10),'due');
  assert.equal(poolStatus(progress(5,10),10),'mastered');
  assert.equal(poolStatus(progress(5,0),10),'mastered');
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
  const domains=buildPoolMap(pool,1,{[a.id]:progress(3,200),[b.id]:progress(5,1e12)},{[b.id]:{saved:true,changedAt:1},[c.id]:{saved:false,changedAt:2}},100);
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

test('unseen ML1 practice intersects exam, area, domain and status without QF questions',()=>{
  for (const exam of [1,2]) {
    const ml1=pool.filter(q=>q.exam===exam && q.area==='Machine Learning' && q.domainIndex===1);
    const reviews={ [ml1[0].id]:progress(3,0), [ml1[1].id]:progress(5,0) };
    const domains=buildPoolMap(pool,exam,reviews,{},100);
    const filtered=filterPoolDomains(domains,'Machine Learning',`${exam}-Machine Learning-1`);
    assert.equal(filtered.length,1);
    const matching=filtered.flatMap(d=>d.groups.flat()).filter(t=>tileMatches(t,new Set(['unseen']),false));
    const indexes=buildQuestionQueue(matching.map(t=>({item:pool[t.index],index:t.index})),reviews,100).slice(0,50);
    assert.equal(indexes.length,Math.min(50,ml1.length-2));
    for (const index of indexes) {
      assert.equal(pool[index].exam,exam);
      assert.equal(pool[index].area,'Machine Learning');
      assert.equal(pool[index].domainIndex,1);
      assert.equal(reviews[pool[index].id],undefined);
    }
    assert.equal(totalCounts(filtered).due,1);
    assert.equal(totalCounts(filtered).mastered,1);
    assert.equal(filterPoolDomains(domains,'all','all').length,20);
    assert.equal(filterPoolDomains(domains,'Quantitative Finance','all').length,10);
    assert.equal(filterPoolDomains(domains,'all',`${exam}-Quantitative Finance-1`).length,1);
  }
});

test('saved-only and empty status matches remain restricted to the selected domain',()=>{
  const question=pool.find(q=>q.exam===1 && q.area==='Machine Learning' && q.domainIndex===1);
  const domains=buildPoolMap(pool,1,{[question.id]:progress(4,0)},{[question.id]:{saved:true,changedAt:1}},100);
  const tiles=filterPoolDomains(domains,'Machine Learning','1-Machine Learning-1').flatMap(d=>d.groups.flat());
  assert.deepEqual(tiles.filter(t=>tileMatches(t,new Set(),true)).map(t=>t.id),[question.id]);
  assert.deepEqual(tiles.filter(t=>tileMatches(t,new Set(['unseen']),true)),[]);
});
