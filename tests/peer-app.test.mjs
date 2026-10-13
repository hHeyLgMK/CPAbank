import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {chapters as accountingChapters,questions as accountingQuestions} from '../dist/questions.js';
import {extraSubjects} from '../dist/extra-subjects.js';
import {strategySubject} from '../dist/strategy.js';
import {questionNumbers} from '../dist/question-numbers.js';
import {attachProgression,progressionQuestions,progressionPlan} from '../dist/progression.js';
import {readProgress,writeProgress} from '../dist/progress.js';

const foundationSubjects={accounting:{questions:accountingQuestions},...extraSubjects,strategy:strategySubject};
const expectedCounts=Object.fromEntries(Object.entries(foundationSubjects).map(([id,subject])=>[id,new Set([...subject.questions,...(progressionQuestions[id] || [])].map(q=>q.id)).size]));
const expectedTotal=Object.values(expectedCounts).reduce((sum,count)=>sum+count,0);
const source = fs.readFileSync(new URL('../native/web/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
// Run the production application with an in-memory DOM and persistent storage.
// A fresh VM represents reopening the application; no session variables survive.
function boot(disk=new Map(), script=source, syncFactory) {
  const nodes = new Map(), events = {}, timers = new Map();
  let timerId=0;
  class Node {
    constructor() {
      this.children=[];this.hidden=true;this.value='';this.textContent='';this.listeners={};this.attrs={};
      this.style={setProperty(){}};
      const classes=new Set();
      this.classList={add:(c)=>classes.add(c),remove:(c)=>classes.delete(c),
        toggle:(c,enabled)=>{const on=enabled??!classes.has(c);on?classes.add(c):classes.delete(c);return on;}};
    }
    set id(id){this._id=id;nodes.set(id,this);} get id(){return this._id;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k]??null;}
    addEventListener(k,fn){this.listeners[k]=fn;}
    querySelector(){return new Node();}
    focus(){} closest(){return null;}
  }
  const node = id => {if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  const document={getElementById:node,createElement:()=>new Node(),createTextNode:text=>({textContent:text}),
    querySelector:node,querySelectorAll:()=>[],activeElement:null,hidden:false,
    addEventListener:(name,fn)=>{events[name]=fn;}};
  let peerHooks;
  const context=vm.createContext({document,navigator:{userAgent:'Test'},crypto:globalThis.crypto,createPeerSync:hooks=>{peerHooks=hooks;return null;},
    window:{addEventListener:(name,fn)=>{events[name]=fn;}},
    localStorage:{getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)},
    setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id),
    createLanSync:syncFactory,matchMedia:()=>({matches:false}),accountingChapters,accountingQuestions,extraSubjects,strategySubject,questionNumbers,attachProgression,progressionPlan,readProgress,writeProgress,
    URL:{createObjectURL:()=> 'blob:test'},Blob,Uint8Array,atob});
  vm.runInContext(script,context,{timeout:10000});
  return {disk,nodes,events,timers,hooks:peerHooks,run:code=>vm.runInContext(code,context),
    json:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context))};
}

test('new native app retains all six banks and restarts at draft without duplicate outcomes',()=>{
  let app=boot();app.run("openSubject('strategy');selectChoice(current(),current().answer);submitAnswer();navigate(3);selectChoice(current(),0)");
  const expected=app.json('({data,session})');app=boot(app.disk);
  assert.deepEqual(app.json('({data,session})'),expected);
  assert.equal(app.run('Object.values(subjects).reduce((n,s)=>n+s.questions.length,0)'),expectedTotal);
  app.run('navigate(0);submitAnswer()');assert.deepEqual(app.json('data.records'),expected.data.records);
});
test('two offline devices merge repeatedly, resume drafts, and preserve the three-correct removal rule',()=>{
  const a=boot(),b=boot();a.run("openSubject('strategy');selectChoice(current(),(current().answer+1)%4);submitAnswer();navigate(3);selectChoice(current(),2)");
  b.run("openSubject('law');selectChoice(current(),0);submitAnswer()");
  const settings={marks:[],shuffle:false};
  const fromA=a.hooks.snapshot();b.hooks.validate(fromA);b.hooks.merge(fromA,settings);b.hooks.apply(fromA);
  assert.equal(b.run('subjectId'),'strategy');assert.equal(b.run('session.index'),3);
  assert.deepEqual(b.json('answerFor(current()).choices'),[2]);
  for(let i=0;i<4;i++){a.hooks.merge(b.hooks.snapshot(),settings);b.hooks.merge(a.hooks.snapshot(),settings);}
  assert.equal(a.run('data.sync.events.length'),2);assert.equal(b.run('data.sync.events.length'),2);
  assert.deepEqual(a.json('data.records'),b.json('data.records'));
  const wrong=b.run('session.items[0].id');
  for(let i=0;i<3;i++){b.run('startWrong();selectChoice(current(),current().answer);submitAnswer()');a.hooks.merge(b.hooks.snapshot(),settings);}
  assert.equal(a.run('data.records['+JSON.stringify(wrong)+'].wrong'),false);
  assert.equal(a.run('data.records['+JSON.stringify(wrong)+'].attempts'),4);
});
test('both devices submit a shared resumed question once, and invalid progress preserves stored keys',()=>{
  const a=boot(),b=boot();a.run("openSubject('strategy')");b.hooks.merge(a.hooks.snapshot(),{marks:[],shuffle:false});b.hooks.apply(a.hooks.snapshot());
  a.run('selectChoice(current(),current().answer);submitAnswer()');b.run('selectChoice(current(),current().answer);submitAnswer()');
  a.hooks.merge(b.hooks.snapshot(),{marks:[],shuffle:false});b.hooks.merge(a.hooks.snapshot(),{marks:[],shuffle:false});
  assert.equal(a.run('data.records[current().id].attempts'),1);assert.equal(b.run('data.records[current().id].attempts'),1);
  const before=new Map(b.disk);assert.throws(()=>b.hooks.apply({progress:'bad'}));assert.deepEqual(b.disk,before);
});
test('written draft and mock timer survive native handoff and reopening',()=>{
  const a=boot(),b=boot();a.run("openSubject('law');startChapter(0,'__all__');navigate(session.items.findIndex(q=>q.type==='written'))");
  a.nodes.get('writtenInput').listeners.input({target:{value:'跨设备草稿\n100 × 20%'}});
  b.hooks.merge(a.hooks.snapshot(),{marks:[],shuffle:true});b.hooks.apply(a.hooks.snapshot());
  assert.equal(b.run('answerFor(current()).text'),'跨设备草稿\n100 × 20%');
  b.run('startMock();session.seconds=2367;saveProgress()');
  const snapshot=b.hooks.snapshot();a.hooks.merge(snapshot,{marks:[],shuffle:true});a.hooks.apply(snapshot);
  const reopened=boot(a.disk);assert.equal(reopened.run('session.seconds'),2367);
  assert.deepEqual(a.json('session.orders'),b.json('session.orders'));
});
test('conflicting submissions of the same resumed question converge to one outcome',()=>{
  const a=boot(),b=boot();a.run("openSubject('strategy')");b.hooks.merge(a.hooks.snapshot(),{marks:[],shuffle:false});b.hooks.apply(a.hooks.snapshot());
  a.run('selectChoice(current(),current().answer);submitAnswer()');b.run('selectChoice(current(),(current().answer+1)%4);submitAnswer()');
  const x=a.hooks.snapshot(),y=b.hooks.snapshot();a.hooks.merge(y,{marks:[],shuffle:false});b.hooks.merge(x,{marks:[],shuffle:false});
  assert.deepEqual(a.json('data.records'),b.json('data.records'));assert.equal(a.run('data.records[current().id].attempts'),1);
});
test('embedded Windows bank and native application initialize and preserve a written draft',()=>{
  const html=fs.readFileSync(new URL('../work/peer-build/index.html',import.meta.url),'utf8');
  const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let app=boot(new Map(),code);assert.equal(app.run('Object.values(subjects).reduce((n,s)=>n+s.questions.length,0)'),expectedTotal);
  app.run("openSubject('law');startChapter(0,'__all__');navigate(session.items.findIndex(q=>q.type==='written'))");
  app.nodes.get('writtenInput').listeners.input({target:{value:'EXE 中的退出续答草稿'}});
  app=boot(app.disk,code);assert.equal(app.run('answerFor(current()).text'),'EXE 中的退出续答草稿');
  app.run("openSubject('accounting');startPlannedPaper(progressionPlan.papers.find(p=>p.subjectId==='accounting'))");
  assert.match(app.run('numberFor(current())'),/^ACC-\d{5}$/);
  app.run('session.seconds=7055;saveProgress()');app=boot(app.disk,code);
  assert.equal(app.run('session.seconds'),7055);
  assert.ok(app.run('session.paperLabel'));
});
test('upgrade from the actual 3.0.3 APK retains statistics, wrong book, marks and history',()=>{
  let oldSource=fs.readFileSync(new URL('../native/tests/fixtures/3.0.3-app.js',import.meta.url),'utf8');
  oldSource=oldSource.replace('registerWebMCP();','registerWebMCP();globalThis.oldAPI={openSubject,selectChoice,submitAnswer,navigate,current,save,get:()=>({data,session})};');
  const old=boot(new Map(),oldSource);
  old.run("oldAPI.openSubject('strategy');oldAPI.selectChoice(oldAPI.current(),(oldAPI.current().answer+1)%4);oldAPI.submitAnswer();oldAPI.get().data.marks.push(oldAPI.current().id);oldAPI.save()");
  const before=old.json('oldAPI.get().data');
  const upgraded=boot(old.disk);
  assert.deepEqual(upgraded.json('data.records'),before.records);
  assert.deepEqual(upgraded.json('data.history'),before.history);
  assert.deepEqual(upgraded.json('data.marks'),before.marks);
  const latest=JSON.parse(fs.readFileSync(new URL('../content/android-import.json',import.meta.url),'utf8')).questionDataSha256;
  assert.equal(upgraded.run('Object.values(subjects).reduce((n,s)=>n+s.questions.length,0)'),expectedTotal);
  upgraded.run("openSubject('strategy');navigate(4);selectChoice(current(),1)");
  const question=upgraded.run('current().id'),reopened=boot(upgraded.disk);
  assert.equal(reopened.run('current().id'),question);assert.deepEqual(reopened.json('answerFor(current()).choices'),[1]);
});

test('native level filtering resumes advanced drafts and keeps an empty selected level explicit',()=>{
  let app=boot();app.run("openSubject('tax');changePracticeStage('chapter')");
  const chapter=app.run("questions.find(q=>q.practiceStage==='chapter').chapterIndex");
  app.run(`startChapter(${chapter});answerFor(current()).text='手机综合题草稿';saveProgress()`);
  assert.equal(app.run('sectionName'),'__all__');
  assert.equal(app.run("session.items.every(q=>q.practiceStage==='chapter')"),true);
  const id=app.run('current().id');app=boot(app.disk);
  assert.equal(app.run('practiceStage'),'chapter');assert.equal(app.run('current().id'),id);
  assert.equal(app.run('answerFor(current()).text'),'手机综合题草稿');
  assert.doesNotMatch(app.nodes.get('questionContent').children[0].textContent,/章内小综合 · 章内小综合/);
  app.run('submitAnswer()');
  assert.equal(app.run('data.history[0].practiceStage'),'chapter');
  const backup=app.run('exportProgress()');app.run('mergeProgress(normalizeBackup('+JSON.stringify(backup)+'))');
  assert.equal(app.run('data.history[0].practiceStage'),'chapter');
  app.run("openSubject('law')");
  assert.equal(app.run('practiceStage'),'chapter');assert.equal(app.run('session.items.length'),0);
  assert.equal(app.nodes.get('questionContent').children[0].children[0].textContent,'当前筛选暂无题目');
  app=boot(app.disk);assert.equal(app.run('practiceStage'),'chapter');assert.equal(app.run('session.items.length'),0);
});

test('native planned paper keeps its two-hour clock, fixed questions and backup metadata',()=>{
  let app=boot();app.run("openSubject('strategy')");
  const paper=progressionPlan.papers.find(p=>p.subjectId==='strategy');
  app.run('startPlannedPaper('+JSON.stringify(paper)+');answerFor(current()).text="限时草稿";session.seconds-=11;saveProgress()');
  app=boot(app.disk);assert.equal(app.run('session.seconds'),paper.minutes*60-11);
  assert.equal(app.run('session.paperLabel'),paper.label);
  assert.deepEqual(app.json('session.items.map(q=>q.id)'),paper.questionIds);
  app.run('session.items.forEach(q=>answerFor(q).text="已完成答案");finishMock(false)');
  assert.match(app.nodes.get('modalBody').children[0].textContent,/逐题对照自评/);
  assert.doesNotMatch(app.nodes.get('modalBody').children[0].textContent,/客观题成绩/);
  app.run('finishMock(true)');
  assert.match(app.nodes.get('result').children[1].textContent,/简答与应用题已填写/);
  assert.doesNotMatch(app.nodes.get('result').children[1].textContent,/客观题|0\s*\/\s*0/);
  const backup=app.run('exportProgress()');app.run('mergeProgress(normalizeBackup('+JSON.stringify(backup)+'))');
  assert.equal(app.run('data.history[0].paperLabel'),paper.label);
  assert.equal(app.run('data.history[0].paperMinutes'),paper.minutes);
  const actions=app.nodes.get('result').children.find(node=>node.className==='self-grade');
  assert.equal(actions.children[1].textContent,'重新练习本套');
  actions.children[1].onclick();
  assert.deepEqual(app.json('session.items.map(q=>q.id)'),paper.questionIds);
  assert.equal(app.run('session.seconds'),paper.minutes*60);
});
