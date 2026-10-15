import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {hydrateBank} from '../site/bank-schema.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'_site'),manifest=JSON.parse(fs.readFileSync(path.join(output,'banks/manifest.json'),'utf8'));
const catalog=JSON.parse(fs.readFileSync(path.join(output,'banks',manifest.catalog.path),'utf8'));
const rawSubjects=Object.fromEntries(manifest.subjects.map(item=>[item.id,JSON.parse(fs.readFileSync(path.join(output,'banks',item.path),'utf8'))]));
const bank=hydrateBank(manifest,catalog,rawSubjects,'https://example.invalid/CPAbank/banks/manifest.json');
const source=fs.readFileSync(path.join(root,'site/app.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
function boot(disk=new Map(),testBank=bank){
  const nodes=new Map(),events={},timers=new Map();let timerId=0;
  class Node {
    constructor(){this.children=[];this.hidden=true;this.value='';this.textContent='';this.listeners={};this.attrs={};this.style={setProperty(){}};
      const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle:(c,on)=>{on=on??!classes.has(c);on?classes.add(c):classes.delete(c);return on;}};}
    set id(id){this._id=id;nodes.set(id,this);}get id(){return this._id;}
    append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}
    setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}
    addEventListener(name,fn){this.listeners[name]=fn;}querySelector(){return new Node();}focus(){}closest(){return null;}
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  const document={getElementById:node,createElement:()=>new Node(),createTextNode:text=>({textContent:text}),querySelector:node,querySelectorAll:()=>[],activeElement:null,hidden:false,addEventListener:(name,fn)=>{events[name]=fn;}};
  const context=vm.createContext({document,navigator:{userAgent:'Test'},crypto:globalThis.crypto,getBank:()=>structuredClone(testBank),
    window:{addEventListener:(name,fn)=>{events[name]=fn;}},localStorage:{getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)},
    setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id),matchMedia:()=>({matches:false}),
    URL:{createObjectURL:()=> 'blob:test'},Blob,Uint8Array,atob});
  vm.runInContext(source,context,{timeout:10000});
  return {disk,nodes,events,run:code=>vm.runInContext(code,context),json:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context))};
}

test('the separated runtime submits with Enter and resumes without duplicate grading',()=>{
  let app=boot();app.run("openSubject('strategy');selectChoice(current(),current().answer)");
  const key={key:'Enter',target:{closest:()=>null},preventDefault(){this.defaultPrevented=true;}};
  app.events.keydown(key);assert.equal(key.defaultPrevented,true);
  assert.equal(app.run('answerFor(current()).submitted'),true);assert.equal(app.run('data.records[current().id].attempts'),1);
  app.run('navigate(3);selectChoice(current(),0)');const expected=app.json('({subjectId,session,data})');
  app.events.pagehide();app=boot(app.disk);assert.deepEqual(app.json('({subjectId,session,data})'),expected);
  app.run('navigate(0);submitAnswer()');assert.equal(app.run('data.records[current().id].attempts'),1);
});

test('written drafts and the identical mock paper/countdown survive a full restart',()=>{
  let app=boot();app.run("openSubject('law');startChapter(0,'__all__');navigate(session.items.findIndex(q=>q.type==='written'))");
  app.nodes.get('writtenInput').listeners.input({target:{value:'题库独立后的草稿\n第二行'}});
  app=boot(app.disk);assert.equal(app.run('answerFor(current()).text'),'题库独立后的草稿\n第二行');
  app.run('startMock();session.seconds=1234;saveProgress()');const paper=app.json('session');
  app=boot(app.disk);assert.deepEqual(app.json('session'),paper);
});

test('reference answers pending review save the answer without inventing a grade or wrong-book entry',()=>{
  const testBank=structuredClone(bank);
  const target={subject:'strategy',q:testBank.subjects.strategy.questions.find(q=>q.type==='single')};
  assert.ok(target.q);target.q.answerStatus='review';target.q.answer=null;
  const app=boot(new Map(),testBank);
  app.run('openSubject('+JSON.stringify(target.subject)+');makeSession("learn",[byId.get('+JSON.stringify(target.q.id)+')]);selectChoice(current(),0);submitAnswer()');
  assert.equal(app.run('answerFor(current()).submitted'),true);
  assert.equal(app.run('data.records[current().id]'),undefined);
  assert.equal(app.run('data.history[0].items[0].correct'),null);
});
