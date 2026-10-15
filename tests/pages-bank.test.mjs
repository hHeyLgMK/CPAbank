import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPages} from '../scripts/build-pages.mjs';
import {loadBank} from '../site/bank-loader.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const built={output:path.join(root,'_site')},base='https://example.invalid/CPAbank/banks/manifest.json';
const manifest=JSON.parse(fs.readFileSync(path.join(built.output,'banks/manifest.json'),'utf8'));
built.manifest=manifest;built.report=JSON.parse(fs.readFileSync(path.join(built.output,'release.json'),'utf8'));
const sourceCatalog=JSON.parse(fs.readFileSync(path.join(root,'question-bank/catalog.json'),'utf8'));
const expectedTotal=sourceCatalog.subjectOrder.reduce((sum,id)=>sum+JSON.parse(fs.readFileSync(path.join(root,'question-bank/subjects',id+'.json'),'utf8')).questions.length,0);
function fetchFrom(directory,mutate){
  return async url=>{
    const parsed=new URL(url),prefix='/CPAbank/';
    if(!parsed.pathname.startsWith(prefix))throw Error('Incorrect project-relative URL: '+url);
    const relative=decodeURIComponent(parsed.pathname.slice(prefix.length));
    const file=path.resolve(directory,relative);
    if(!file.startsWith(path.resolve(directory)+path.sep))throw Error('Path escaped the published directory');
    const text=fs.readFileSync(file,'utf8'),value=mutate?mutate(relative,text):text;
    return new Response(value,{status:200,headers:{'Content-Type':'application/json'}});
  };
}
function memoryCache(){let saved;return {read:async()=>saved,write:async(_key,value)=>{saved=structuredClone(value);},value:()=>saved};}

test('published JSON retains every canonical question, reference status, chapter and display number',async()=>{
  const bank=await loadBank({manifestURL:base,fetcher:fetchFrom(built.output),cache:memoryCache()});
  assert.equal(bank.questionCount,expectedTotal);assert.equal(bank.sourceVersion,sourceCatalog.sourceVersion);
  for(const id of Object.keys(bank.subjects)){
    const original=JSON.parse(fs.readFileSync(path.join(root,'question-bank/subjects',id+'.json'),'utf8'));
    const actual=bank.subjects[id];assert.equal(actual.questions.length,original.questions.length);
    for(let i=0;i<original.questions.length;i++){
      const expected=structuredClone(original.questions[i]),got=structuredClone(actual.questions[i]);
      if(expected.media){assert.equal(got.media.length,expected.media.length);got.media=expected.media;}
      assert.deepEqual(got,expected);
    }
    assert.deepEqual(actual.chapters.map(c=>c.items.map(q=>q.id)),original.chapters.map(c=>c.items));
  }
  const raw=JSON.parse(fs.readFileSync(path.join(root,'question-bank/catalog.json'),'utf8'));
  assert.deepEqual(bank.questionNumbers,raw.questionNumbers);assert.deepEqual(bank.progressionPlan,raw.progressionPlan);
});

test('a cached complete bank survives an interrupted new release without being replaced',async()=>{
  const cache=memoryCache();
  const first=await loadBank({manifestURL:base,fetcher:fetchFrom(built.output),cache});
  const saved=structuredClone(cache.value());
  const next=structuredClone(manifest);next.version='a'.repeat(64);
  next.catalog.path=next.version+'/catalog.json';for(const item of next.subjects)item.path=next.version+'/'+item.id+'.json';
  const failed=await loadBank({manifestURL:base,cache,fetcher:async url=>{
    if(url===base)return Response.json(next);
    throw Error('Connection interrupted');
  }});
  assert.equal(failed.bankId,first.bankId);assert.equal(failed.fromCache,true);
  assert.deepEqual(cache.value(),saved);
});

test('corrupt downloads fail integrity checking and never create a usable cache',async()=>{
  const cache=memoryCache();
  await assert.rejects(()=>loadBank({manifestURL:base,cache,fetcher:fetchFrom(built.output,(name,text)=>name.endsWith('/law.json')?text+' ':text)}),/校验失败/);
  assert.equal(cache.value(),undefined);
});

test('a future schema or an unsafe URL is rejected before any subject download',async()=>{
  for(const modify of [m=>{m.schemaVersion=99;},m=>{m.subjects[0].path='https://another.invalid/data.json';}]){
    const changed=structuredClone(manifest);modify(changed);let requests=0;
    await assert.rejects(()=>loadBank({manifestURL:base,cache:memoryCache(),fetcher:async()=>{requests++;return Response.json(changed);}}));
    assert.equal(requests,1);
  }
});

test('storage failures do not prevent loading a verified online question bank',async()=>{
  const bank=await loadBank({manifestURL:base,fetcher:fetchFrom(built.output),cache:{read:async()=>{throw Error('blocked');},write:async()=>{throw Error('quota');}}});
  assert.equal(bank.questionCount,expectedTotal);assert.equal(bank.cached,false);
});

test('question media is published, hash-addressed and resolves under a project subpath',async()=>{
  const bank=await loadBank({manifestURL:base,fetcher:fetchFrom(built.output),cache:memoryCache()});let pictures=0;
  for(const subject of Object.values(bank.subjects))for(const q of subject.questions)for(const media of q.media||[]){
    pictures++;const url=new URL(media.src);assert.equal(url.origin,'https://example.invalid');
    assert.match(url.pathname,/^\/CPAbank\/banks\/assets\/[a-f0-9]{64}\./);
    assert.ok(fs.existsSync(path.join(built.output,url.pathname.slice('/CPAbank/'.length))));
  }
  assert.ok(pictures>0);assert.ok(manifest.assets.length>0);
});

test('editing only question data creates a new bank version and leaves every runtime file identical',t=>{
  const work=path.join(root,'work');fs.mkdirSync(work,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(work,'bank-edit-'));
  t.after(()=>{const resolved=fs.realpathSync(fixture);if(!resolved.startsWith(fs.realpathSync(work)+path.sep))throw Error('Unsafe test cleanup');fs.rmSync(resolved,{recursive:true,force:true});});
  fs.cpSync(path.join(root,'site'),path.join(fixture,'site'),{recursive:true});
  fs.cpSync(path.join(root,'question-bank'),path.join(fixture,'question-bank'),{recursive:true});
  const file=path.join(fixture,'question-bank/subjects/accounting.json'),subject=JSON.parse(fs.readFileSync(file,'utf8'));
  const stableId=subject.questions[0].id;subject.questions[0].explain+='\n独立题库发布测试。';fs.writeFileSync(file,JSON.stringify(subject,null,2)+'\n');
  const changed=buildPages(fixture);
  assert.notEqual(changed.report.bankVersion,built.report.bankVersion);
  assert.deepEqual(changed.report.runtimeHashes,built.report.runtimeHashes);
  assert.equal(changed.manifest.questionCount,built.manifest.questionCount);
  const published=JSON.parse(fs.readFileSync(path.join(changed.output,'banks',changed.report.bankVersion,'accounting.json'),'utf8'));
  assert.equal(published.questions[0].id,stableId);assert.match(published.questions[0].explain,/独立题库发布测试/);
});
