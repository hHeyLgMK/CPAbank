import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {questions} from '../dist/questions.js';
import {extraSubjects} from '../dist/extra-subjects.js';
import {strategySubject} from '../dist/strategy.js';
import {questionNumbers} from '../dist/question-numbers.js';
import {attachProgression,progressionQuestions,progressionPlan} from '../dist/progression.js';

const subjects=attachProgression({accounting:{chapters: (await import('../dist/questions.js')).chapters,questions},...extraSubjects,strategy:strategySubject});
const imported=JSON.parse(fs.readFileSync(new URL('../content/android-import.json',import.meta.url),'utf8'));
function stable(value) {
  return Array.isArray(value) ? value.map(stable) : value && typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
}

test('all 4412 original questions retain IDs, stems, answers, explanations and knowledge points after reviewed index repairs',()=>{
  const baseline=JSON.parse(fs.readFileSync(new URL('../content/original-question-core.json',import.meta.url),'utf8'));
  const fields=['id','chapterIndex','chapterTitle','type','stem','options','answer','sample','explain','knowledgePoint'];
  assert.equal(Object.keys(subjects).length,6);
  let total=0;
  for(const [id,subject] of Object.entries(subjects)) {
    const old=subject.questions.filter(q=>baseline[id][q.id]);
    assert.equal(old.length,imported.questionCounts[id],id);
    for(const q of old) {
      const hash=createHash('sha256').update(JSON.stringify(fields.map(f=>q[f]??null))).digest('hex');
      assert.equal(hash,baseline[id][q.id],q.id);
    }
    total+=old.length;
  }
  assert.equal(total,4412);
});

test('every original question has a complete honest textbook index and valid PDF offsets',()=>{
  const offsets={accounting:11,law:9,finance:9,audit:11,strategy:7,tax:9};
  for(const [key,s]of Object.entries(subjects))for(const q of s.questions) {
    assert.ok(q.knowledgePoint && q.source?.chapter && q.source.section,q.id);
    for(const source of q.source.references||[q.source]) {
      assert.ok(source.book && source.locationGranularity,q.id);
      if(source.locationGranularity==='official') {assert.ok(source.url,q.id);assert.equal(source.pdfPage,'');continue;}
      assert.ok(source.printedPage && source.pdfPage,q.id);
      if(Number.isInteger(source.printedPage)) {
        const offset=key==='tax'&&source.printedPage>=630?7:offsets[key];
        assert.equal(source.pdfPage,source.printedPage+offset,q.id);
        if(key==='tax')assert.ok(![628,629].includes(source.printedPage),q.id);
      }
    }
  }
});

test('new progression cases cover all plan chapters with references, answers and stable paper sets',()=>{
  for(const [key,qs]of Object.entries(progressionQuestions)) {
    const subject=subjects[key];
    for(let ci=0;ci<subject.chapters.length;ci++)for(const stage of ['application','chapter'])assert.ok(qs.some(q=>q.chapterIndex===ci&&q.practiceStage===stage),`${key} chapter ${ci+1} ${stage}`);
    for(const q of qs){assert.ok(q.source.references.length && q.rubric.length && q.recommendedMinutes>0,q.id);for(const r of q.source.references)assert.ok(subject.questions.some(old=>old.id===r.baseQuestionId),q.id);}
  }
  assert.equal(progressionPlan.weeks.length,46);
  assert.equal(progressionPlan.papers.length,12);
  for(const paper of progressionPlan.papers){assert.ok(paper.questionIds.length>=5,paper.id);assert.equal(new Set(paper.questionIds).size,paper.questionIds.length);assert.ok(paper.questionIds.every(id=>subjects[paper.subjectId].questions.some(q=>q.id===id)),paper.id);}
});

test('each stable internal ID has one unique display number and valid answer indices',()=>{
  const ids=new Set(),numbers=new Set();
  for(const [id,subject] of Object.entries(subjects)) {
    assert.equal(Object.keys(questionNumbers[id]).length,subject.questions.length,id);
    for(const q of subject.questions) {
      assert.ok(!ids.has(q.id),q.id);ids.add(q.id);
      const number=questionNumbers[id][q.id];
      assert.match(number,/^(ACC|LAW|FIN|TAX|AUD|STR)-\d{5}$/);
      assert.ok(!numbers.has(number),number);numbers.add(number);
      if(q.type==='written') assert.ok(q.sample?.trim(),q.id);
      else {
        const indices=q.type==='single'?[q.answer]:q.answer;
        assert.ok(indices.length && indices.every(i=>Number.isInteger(i)&&i>=0&&i<q.options.length),q.id);
      }
    }
  }
});
