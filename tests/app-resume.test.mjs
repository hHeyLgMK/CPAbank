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
const source = fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
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
  const context=vm.createContext({document,
    window:{addEventListener:(name,fn)=>{events[name]=fn;}},
    localStorage:{getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)},
    setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id),
    createLanSync:syncFactory,matchMedia:()=>({matches:false}),accountingChapters,accountingQuestions,extraSubjects,strategySubject,questionNumbers,attachProgression,progressionPlan,readProgress,writeProgress,
    URL:{createObjectURL:()=> 'blob:test'},Blob,Uint8Array,atob});
  vm.runInContext(script,context,{timeout:10000});
  return {disk,nodes,events,timers,run:code=>vm.runInContext(code,context),
    json:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context))};
}

test('real app restart returns to the same section/question and keeps submitted and draft answers',()=>{
  let app=boot();app.run("openAccounting();startChapter(4,'__all__');selectChoice(current(),0);submitAnswer();navigate(4);selectChoice(current(),1);");
  app.nodes.get('markBtn').onclick();
  const expected=app.json('({subjectId,chapterIndex,sectionName,session,data})');
  app.events.pagehide();app=boot(app.disk);
  const actual=app.json('({subjectId,chapterIndex,sectionName,session,data})');
  assert.equal(actual.subjectId,expected.subjectId);assert.equal(actual.chapterIndex,4);
  assert.equal(actual.sectionName,'__all__');assert.equal(actual.session.index,4);
  assert.deepEqual(actual.session.answers,expected.session.answers);
  assert.deepEqual(actual.data,expected.data);
  assert.equal(app.nodes.get('practiceApp').hidden,false);
  assert.equal(app.run('selectionOpen'),false);
});
test('real written input saves before navigation and all subjects remain available after reopening',()=>{
  let app=boot();app.run("openAccounting();navigate(3);openSubject('law');startChapter(0,'__all__');navigate(session.items.findIndex(q=>q.type==='written'));");
  const draft='尚未提交的草稿：收到订金不等于收入\n100 × 20% = 20';
  app.nodes.get('writtenInput').listeners.input({target:{value:draft}});
  const question=app.run('current().id');app=boot(app.disk);
  assert.equal(app.run('subjectId'),'law');assert.equal(app.run('current().id'),question);
  assert.equal(app.run('answerFor(current()).text'),draft);
  assert.equal(app.nodes.get('writtenInput').value,draft);
  app.run('openAccounting()');assert.equal(app.run('session.index'),3);
});
test('real mock restart preserves the drawn questions, order, answers and paused countdown',()=>{
  let app=boot();app.run('openAccounting();data.shuffle=true;startMock();selectChoice(current(),2);navigate(3);');
  for(let i=0;i<13;i++)for(const tick of app.timers.values())tick();
  const expected=app.json('({ids:session.items.map(q=>q.id),orders:session.orders,answers:session.answers,seconds:session.seconds})');
  app=boot(app.disk);
  assert.deepEqual(app.json('({ids:session.items.map(q=>q.id),orders:session.orders,answers:session.answers,seconds:session.seconds})'),expected);
  assert.equal(app.run('session.index'),3);
  for(const tick of app.timers.values())tick();
  assert.equal(app.run('session.seconds'),expected.seconds-1);
  app.run('finishMock(true)');const records=app.json('data.records');
  app=boot(app.disk);assert.equal(app.run('session.finished'),true);assert.equal(app.run('session.showResult'),true);
  app.run('finishMock(true)');assert.deepEqual(app.json('data.records'),records);
});
test('real app ignores malformed progress without losing existing practice statistics',()=>{
  let app=boot();app.run('openAccounting();selectChoice(current(),0);submitAnswer()');
  const records=app.json('data.records');app.disk.set('cpa-practice-sessions-v1','{bad');
  app=boot(app.disk);assert.deepEqual(app.json('data.records'),records);assert.equal(app.run('session.index'),0);
});
test('EXE HTML initializes the full bank and resumes production answers after restart',()=>{
  const html=fs.readFileSync(new URL('../work/windows-build/CPA_Accounting_Offline.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);
  let app=boot(new Map(),scripts[0][1]);assert.equal(app.run('Object.values(subjects).reduce((n,s)=>n+s.questions.length,0)'),expectedTotal);
  app.run('openAccounting();navigate(2);selectChoice(current(),1)');
  const expected=app.run('current().id');app=boot(app.disk,scripts[0][1]);
  assert.equal(app.run('current().id'),expected);assert.deepEqual(app.json('answerFor(current()).choices'),[1]);
  const downloads=fs.readdirSync(new URL('../dist/',import.meta.url)).filter(name=>/\.(csv|md)$/.test(name));
  assert.equal(app.run('Object.keys(offlineURLs).length'),downloads.length);
  for(const name of ['progression-guide.md','progression-plan.csv','knowledge-index.csv']) {
    assert.equal(app.run('typeof offlineURLs['+JSON.stringify(name)+']'),'string');
  }
});

test('six subjects and the latest tax supplement survive reopening with their displayed numbers',()=>{
  let app=boot();app.run("openSubject('strategy');navigate(4);selectChoice(current(),1);submitAnswer()");
  const strategy=app.json('({id:current().id,number:numberFor(current()),sessionId:session.id})');
  assert.match(strategy.number,/^STR-\d{5}$/);
  app.run("openSubject('tax');startChapter(0,'__all__');navigate(session.items.findIndex(q=>q.edition==='知识点补充题'))");
  app.nodes.get('writtenInput').listeners.input({target:{value:'税法补充题的未提交草稿'}});
  const taxId=app.run('current().id');app=boot(app.disk);
  assert.equal(app.run('subjectId'),'tax');assert.equal(app.run('current().id'),taxId);
  assert.equal(app.run('answerFor(current()).text'),'税法补充题的未提交草稿');
  assert.equal(app.run('subjects.tax.questions.length'),expectedCounts.tax);
  app.run("openSubject('strategy')");
  assert.equal(app.run('current().id'),strategy.id);assert.equal(app.run('session.id'),strategy.sessionId);
  assert.equal(app.run('data.history.length'),1);
});

test('group submission restores its completed result and keeps one history entry without duplicate scoring',()=>{
  let app=boot();app.run("openSubject('strategy');startChapter(0,'__all__');selectChoice(current(),current().answer);finishLearning(true)");
  const expected=app.json('({history:data.history,records:data.records,id:session.id})');
  assert.equal(expected.history.length,1);assert.equal(expected.history[0].items.length,1);
  assert.equal(Object.keys(expected.records).length,1);
  app=boot(app.disk);assert.equal(app.run('session.finished'),true);assert.equal(app.run('session.showResult'),true);
  app.run('finishLearning(true)');
  assert.deepEqual(app.json('({history:data.history,records:data.records,id:session.id})'),expected);
  app.run('showHistory();showHistoryDetail(session.id)');
  assert.equal(app.nodes.get('modalTitle').textContent,'练习详情');
});

test('ongoing history keeps its identity through repeated application restarts',()=>{
  let app=boot();app.run('openAccounting();selectChoice(current(),0);submitAnswer()');
  const id=app.run('session.id');app=boot(app.disk);
  app.run('navigate(1);selectChoice(current(),1);submitAnswer()');
  assert.equal(app.run('session.id'),id);assert.equal(app.run('data.history.length'),1);
  assert.equal(app.run('data.history[0].items.length'),2);
  assert.equal(app.run('data.history[0].id'),id);
});

test('progress from the previous Windows release gains history metadata while preserving answers and statistics',()=>{
  let app=boot();app.run('openAccounting();selectChoice(current(),1);submitAnswer();navigate(2)');
  const records=app.json('data.records'),question=app.run('current().id');
  const saved=JSON.parse(app.disk.get('cpa-practice-sessions-v1'));
  for(const state of Object.values(saved.sessions)){delete state.id;delete state.startedAt;}
  app.disk.set('cpa-practice-sessions-v1',JSON.stringify(saved));
  const data=JSON.parse(app.disk.get('cpa-accounting-zero-v1'));delete data.history;
  app.disk.set('cpa-accounting-zero-v1',JSON.stringify(data));
  app=boot(app.disk);
  assert.equal(app.run('current().id'),question);assert.deepEqual(app.json('data.records'),records);
  assert.equal(app.run('typeof session.id'),'string');assert.equal(app.run('data.history.length'),0);
  const id=app.run('session.id');app=boot(app.disk);
  assert.equal(app.run('session.id'),id);
  app.run('selectChoice(current(),2);submitAnswer()');
  assert.equal(app.run('data.history.length'),1);assert.equal(app.run('data.history[0].id'),id);
});


test('LAN handoff reinitializes the actual application without duplicating scores or history',()=>{
  let firstHooks, secondHooks;
  const first=boot(new Map(),source,hooks=>{firstHooks=hooks;return {canEdit:()=>true};});
  first.run("openSubject('strategy');selectChoice(current(),1);submitAnswer();navigate(4);selectChoice(current(),2)");
  const expected=first.json('({subjectId,session,data})');
  const second=boot(new Map(),source,hooks=>{secondHooks=hooks;return {canEdit:()=>false};});
  secondHooks.apply(firstHooks.snapshot());
  assert.equal(JSON.stringify(secondHooks.snapshot()),JSON.stringify(firstHooks.snapshot()));
  assert.deepEqual(second.json('data'),expected.data);
  second.run('navigate(0);submitAnswer()');
  assert.deepEqual(second.json('data.records'),expected.data.records);
  assert.equal(second.json('data.history').length,expected.data.history.length);
});
test('passive LAN device does not decrement mock time; invalid import preserves original keys',()=>{
  let hooks, editable=true;
  const app=boot(new Map(),source,value=>{hooks=value;return {canEdit:()=>editable};});
  app.run('openAccounting();startMock()');
  editable=false;
  const time=app.run('session.seconds');
  for(const tick of app.timers.values())tick();
  assert.equal(app.run('session.seconds'),time);
  const before=new Map(app.disk);
  assert.throws(()=>hooks.apply({data:'{}',progress:'invalid'}));
  assert.deepEqual(app.disk,before);
});

test('practice levels filter actual new questions, default composite groups to all sections and preserve level across subjects',()=>{
  const app=boot();
  for(const subject of ['accounting','tax','strategy']) {
    app.run(`openSubject('${subject}')`);
    for(const stage of ['application','chapter','cross']) {
      const chapter=app.run(`questions.find(q=>q.practiceStage==='${stage}').chapterIndex`);
      app.run(`startChapter(${chapter});changePracticeStage('${stage}')`);
      assert.ok(app.run('session.items.length')>0);
      assert.equal(app.run(`session.items.every(q=>q.practiceStage==='${stage}')`),true);
      assert.equal(app.nodes.get('practiceStageSelect').value,stage);
      if(stage!=='application') assert.equal(app.run('sectionName'),'__all__');
    }
  }
  app.run("openSubject('law')");
  assert.equal(app.run('practiceStage'),'cross');
  assert.equal(app.run('session.items.length'),0);
  assert.equal(app.nodes.get('questionContent').children[0].children[0].textContent,'当前筛选暂无题目');
  app.nodes.get('questionContent').children[0].children[2].onclick();
  assert.equal(app.run('practiceStage'),'all');
  assert.ok(app.run('session.items.length')>0);
});

test('advanced level, draft, history and multi-point knowledge index survive real app restart',()=>{
  let app=boot();app.run("openSubject('accounting');changePracticeStage('chapter')");
  const chapter=app.run("questions.find(q=>q.practiceStage==='chapter').chapterIndex");
  app.run(`startChapter(${chapter});answerFor(current()).text='综合题未提交草稿';saveProgress()`);
  const id=app.run('current().id');app=boot(app.disk);
  assert.equal(app.run('practiceStage'),'chapter');assert.equal(app.run('current().id'),id);
  assert.equal(app.run('answerFor(current()).text'),'综合题未提交草稿');
  assert.match(app.nodes.get('questionContent').children[0].textContent,/建议 \d+ 分钟/);
  assert.doesNotMatch(app.nodes.get('questionContent').children[0].textContent,/章内小综合 · 章内小综合/);
  app.run('submitAnswer()');
  assert.equal(app.run('data.history[0].practiceStage'),'chapter');
  assert.match(app.run('historyTitle(data.history[0])'),/章内小综合/);
  const lines=app.nodes.get('feedback').children.filter(node=>node.className==='knowledge-line');
  assert.ok(lines.length>0);assert.ok(lines.every(node=>node.textContent.startsWith('知识点索引：')));
  const rubric=app.nodes.get('feedback').children.find(node=>node.className==='scoring-points');
  assert.equal(rubric.children.length,app.run('current().rubric.length'));
  app.run(`appendKnowledgeIndex($('feedback'),{knowledgePoint:'收入确认',source:{chapter:'第十七章 收入',section:'第二节 收入确认',printedPage:'430—439',pdfPage:'453—462',locationGranularity:'section'}})`);
  const range=app.nodes.get('feedback').children.at(-1).textContent;
  assert.match(range,/教材阅读范围第 430—439 页/);assert.match(range,/PDF阅读范围第 453—462 页/);
});

test('knowledge index lists each referenced point and preserves official supplementary links',()=>{
  const app=boot();
  app.run(`$('feedback').replaceChildren();appendKnowledgeIndex($('feedback'),{knowledgePoint:'综合分析',source:{references:[
    {knowledgePoint:'收入确认',chapter:'第十七章 收入',section:'第二节 收入确认',printedPage:430,pdfPage:453,locationGranularity:'point'},
    {knowledgePoint:'所得税费用',chapter:'第十九章 所得税',section:'第三节 所得税费用',printedPage:511,pdfPage:534,locationGranularity:'point'}
  ]}})`);
  const lines=app.nodes.get('feedback').children;
  assert.equal(lines.length,2);
  assert.equal(lines[0].textContent,'知识点索引：收入确认 · 第十七章 收入 · 第二节 收入确认 · 教材第 430 页 · PDF第 453 页');
  assert.match(lines[1].textContent,/所得税费用.*教材第 511 页.*PDF第 534 页/);
  app.run(`appendKnowledgeIndex($('feedback'),{knowledgePoint:'纳税信用',source:{locationGranularity:'official',url:'https://www.chinatax.gov.cn/'}})`);
  const official=app.nodes.get('feedback').children.at(-1);
  assert.match(official.textContent,/知识点索引：纳税信用 · 官方补充/);
  assert.equal(official.children.at(-1).href,'https://www.chinatax.gov.cn/');
  app.run(`appendKnowledgeIndex($('feedback'),{knowledgePoint:'收入确认',source:{printedPage:'430—431',pdfPage:'453—454',locationGranularity:'topic-range'}})`);
  assert.match(app.nodes.get('feedback').children.at(-1).textContent,/教材知识点范围第 430—431 页.*PDF知识点范围第 453—454 页/);
});

test('planned paper uses its fixed questions and two-hour clock through restart and history',()=>{
  let app=boot();app.run("openSubject('accounting');showPlannedPractice()");
  assert.equal(app.nodes.get('modalTitle').textContent,'备考计划练习');
  const paper=progressionPlan.papers.find(p=>p.subjectId==='accounting');
  app.run('startPlannedPaper('+JSON.stringify(paper)+');answerFor(current()).text="限时综合草稿";saveProgress()');
  assert.deepEqual(app.json('session.items.map(q=>q.id)'),paper.questionIds);
  assert.equal(app.run('session.mode'),'mock');assert.equal(app.run('session.seconds'),paper.minutes*60);
  for(let i=0;i<17;i++)for(const tick of app.timers.values())tick();
  app=boot(app.disk);
  assert.equal(app.run('session.seconds'),paper.minutes*60-17);assert.equal(app.run('session.paperLabel'),paper.label);
  assert.equal(app.run('answerFor(current()).text'),'限时综合草稿');
  assert.match(app.nodes.get('chapterNote').textContent,new RegExp(paper.minutes+' 分钟'));
  app.run('session.items.forEach(q=>answerFor(q).text="已完成答案");finishMock(false)');
  assert.match(app.nodes.get('modalBody').children[0].textContent,/逐题对照自评/);
  assert.doesNotMatch(app.nodes.get('modalBody').children[0].textContent,/客观题成绩/);
  app.run('finishMock(true)');
  assert.equal(app.run('data.history[0].paperLabel'),paper.label);
  assert.equal(app.run('data.history[0].paperMinutes'),paper.minutes);
  assert.match(app.nodes.get('result').children[1].textContent,/简答与应用题已填写/);
  assert.doesNotMatch(app.nodes.get('result').children[1].textContent,/客观题|0\s*\/\s*0/);
  const actions=app.nodes.get('result').children.find(node=>node.className==='self-grade');
  assert.equal(actions.children[1].textContent,'重新练习本套');
  actions.children[1].onclick();
  assert.deepEqual(app.json('session.items.map(q=>q.id)'),paper.questionIds);
  assert.equal(app.run('session.seconds'),paper.minutes*60);
});
