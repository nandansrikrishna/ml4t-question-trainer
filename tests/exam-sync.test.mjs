import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createExam,scoreExam} from '../lib/practice-exam.ts';
import {acceptCloud,applyEdits,decodeCloudExam,itemEdits,mergeDeletedExams,mergeExamRecords,missingFromListing,readDeletedExams,visibleExam,withoutDeleted} from '../lib/exam-sync.ts';
import {withoutDeletedExamAttempts} from '../lib/answer-history.ts';
const pool=JSON.parse(readFileSync(new URL('../app/data/questions.json',import.meta.url)));
const withdrawn=JSON.parse(readFileSync(new URL('../app/data/withdrawn-questions.json',import.meta.url)));
const record=()=>({cloud:createExam(pool,1,1000),revision:0,edits:[],acknowledged:[],submittedAt:null});
const edit=(id,statement,value)=>({id,position:0,kind:'answer',statement,value,at:new Date(2000).toISOString()});
test('local edits preserve True, False, unclassified and pins through serialization',()=>{
  const r=record();const item=r.cloud.items[0];const changed={...item,answers:[true,false,null,true,false],pinned:true};
  r.edits=itemEdits(item,changed,0,2000);
  const restored=JSON.parse(JSON.stringify(r));
  assert.deepEqual(visibleExam(restored).items[0].answers,changed.answers);
  assert.equal(visibleExam(restored).items[0].pinned,true);
  assert.deepEqual(r.cloud.items[0].answers,[null,null,null,null,null]);
});
test('sync response acknowledges only its flight; newer edits remain queued',()=>{
  const r=record();r.edits=[edit('first',0,true),edit('second',1,false)];
  const flight={id:'request',revision:0,edits:[r.edits[0]],submittedAt:null};
  const cloud={...r,cloud:applyEdits(r.cloud,flight.edits),revision:1};
  const next=acceptCloud(r,cloud,{acknowledged:true},flight);
  assert.deepEqual(next.edits.map(e=>e.id),['second']);
  assert.deepEqual(visibleExam(next).items[0].answers.slice(0,2),[true,false]);
});
test('two tabs do not resurrect acknowledged events and keep disjoint pending edits',()=>{
  const a=record();a.edits=[edit('first',0,true)];
  const b={...a,revision:1,acknowledged:['first'],edits:[edit('second',1,false)]};
  const merged=mergeExamRecords(a,b);
  assert.equal(merged.revision,1);assert.deepEqual(merged.edits.map(e=>e.id),['second']);
});
test('revision conflict reloads cloud state without discarding local edits',()=>{
  const r=record();r.edits=[edit('local',0,true)];
  const remote={...r,cloud:applyEdits(r.cloud,[edit('remote',1,false)]),revision:2};
  const merged=acceptCloud(r,remote,{conflict:true});
  assert.equal(merged.revision,2);assert.deepEqual(visibleExam(merged).items[0].answers.slice(0,2),[true,false]);
});
test('submission elsewhere remains authoritative while unsynced edits are preserved for recovery',()=>{
  const r=record();r.edits=[edit('local',0,true)];
  const final={...r,cloud:{...r.cloud,submittedAt:3000},revision:3};
  const result=acceptCloud(r,final,{finalizedElsewhere:true});
  assert.equal(visibleExam(result).submittedAt,3000);assert.equal(result.edits.length,0);
  assert.equal(result.recoveredEdits[0].id,'local');
});
test('cloud review uses finalized scores and distinguishes unanswered from false',()=>{
  const r=record();const byKey=new Map(r.cloud.items.map((i,n)=>[n,i.question]));
  const response={id:r.cloud.id,exam:1,started_at:new Date(1000).toISOString(),deadline:new Date(r.cloud.deadline).toISOString(),submitted_at:new Date(3000).toISOString(),revision:1,
    items:r.cloud.items.map((item,n)=>({question_key:n,position:n,statement_order:item.order,answer_mask:1,answered_mask:3,pinned:false,score:1}))};
  const decoded=decodeCloudExam(response,byKey);
  assert.deepEqual(decoded.cloud.items[0].answers,[true,false,null,null,null]);assert.equal(scoreExam(decoded.cloud),40);
});

test('historical cloud exams can still decode a withdrawn question',()=>{
  const r=record();
  const historical=withdrawn[0];
  const questions=[historical,...r.cloud.items.slice(1).map(item=>item.question)];
  const byKey=new Map(questions.map((question,index)=>[index+1,question]));
  const response={id:r.cloud.id,exam:1,started_at:new Date(1000).toISOString(),deadline:new Date(r.cloud.deadline).toISOString(),submitted_at:new Date(3000).toISOString(),revision:1,
    items:r.cloud.items.map((item,index)=>({question_key:index+1,position:index,statement_order:item.order,answer_mask:0,answered_mask:0,pinned:false,score:0}))};
  const decoded=decodeCloudExam(response,byKey);
  assert.equal(decoded.cloud.items[0].question.id,historical.id);
  assert.equal(decoded.cloud.items.length,40);
});

test('auth return paths allow only app tabs',async()=>{
  const {authReturnPath}=await import('../lib/auth-return.ts');
  assert.equal(authReturnPath('/practice-exam'),'/practice-exam');
  assert.equal(authReturnPath('/review'),'/review');
  for(const path of ['https://evil.example','//evil.example','/\\evil.example','/unknown',null])assert.equal(authReturnPath(path),'/');
});

test('same-millisecond edits keep input order and a finalized snapshot clears stale flights',()=>{
  const a=record();a.edits=[edit('z-first',0,true),edit('a-second',0,false)];
  const merged=mergeExamRecords(a,{...a,edits:[]});
  assert.equal(visibleExam(merged).items[0].answers[0],false);
  const flight={id:'request',revision:0,edits:a.edits,submittedAt:3000};
  const final={...a,cloud:{...a.cloud,submittedAt:3000},revision:1,acknowledged:a.edits.map(e=>e.id),edits:[]};
  const restored=mergeExamRecords({...a,flight},final);
  assert.equal(restored.flight,undefined);assert.equal(restored.edits.length,0);
});
test('deleted-exam ledger hides cached exams and keeps server confirmation sticky',()=>{
  const a=record(),b=record();
  const ledger=mergeDeletedExams(readDeletedExams(JSON.stringify({[a.cloud.id]:true,bad:1})),{[a.cloud.id]:false,[b.cloud.id]:false});
  assert.deepEqual(ledger,{[a.cloud.id]:true,[b.cloud.id]:false});
  assert.deepEqual(withoutDeleted([a,b,record()],ledger).length,1);
  assert.deepEqual(readDeletedExams('not json'),{});
});
test('listing prunes only older exams it does not contain',()=>{
  const listed=record(),gone=record(),fresh={...record(),cloud:{...record().cloud,startedAt:100_000}};
  assert.deepEqual(missingFromListing([listed,gone,fresh],new Set([listed.cloud.id]),120_000),[gone.cloud.id]);
});
test('cached exam attempts missing from the cloud are dropped; practice attempts stay',()=>{
  const at=(id,examSessionId)=>({id,questionCode:'ML-D1G1Q1',answerMask:0,score:0,answeredAt:1,source:examSessionId?'exam':'practice',examSessionId});
  const cached={kept:at('kept','s1'),deleted:at('deleted','s2'),practice:at('practice')};
  assert.deepEqual(Object.keys(withoutDeletedExamAttempts(cached,{kept:cached.kept})),['kept','practice']);
});
