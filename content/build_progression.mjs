import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chapters,questions} from '../dist/questions.js';
import {extraSubjects} from '../dist/extra-subjects.js';
import {strategySubject} from '../dist/strategy.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const labels={foundation:'零基础',application:'应用推进',chapter:'章内小综合',cross:'跨章综合'};
const subjects={accounting:{name:'会计',chapters,questions},...extraSubjects,strategy:strategySubject};
const numbers=JSON.parse(fs.readFileSync(path.join(root,'content/question-numbers.json'),'utf8'));
const prefix={accounting:'ACC',tax:'TAX',strategy:'STR'};
const progressionQuestions={};
const duplicate=new Set(Object.values(subjects).flatMap(s=>s.questions.map(q=>q.id)));
for(const key of ['accounting','tax','strategy']) {
  const file=path.join(root,'content/progression',key+'.json');
  if(!fs.existsSync(file)) throw Error('Missing progression draft: '+key);
  let next=Math.max(...Object.values(numbers[key]).map(n=>Number(n.split('-')[1])))+1;
  const subject=subjects[key];
  progressionQuestions[key]=JSON.parse(fs.readFileSync(file,'utf8')).map(draft=>{
    const q={...draft};
    if(duplicate.has(q.id))throw Error('Duplicate id: '+q.id);duplicate.add(q.id);
    if(!labels[q.practiceStage]||q.practiceStage==='foundation'||q.type!=='written'||!q.stem?.trim()||!q.sample?.trim()||!q.explain?.trim()||!q.rubric?.length) throw Error('Incomplete draft: '+q.id);
    if(!Number.isInteger(q.chapterIndex)||!subject.chapters[q.chapterIndex])throw Error('Invalid chapter: '+q.id);
    if(!q.relatedChapters?.includes(q.chapterIndex+1)) throw Error('Related chapters missing exercise group: '+q.id);
    const refs=[];
    for(const r of q.referenceTopics) {
      const matches=subject.questions.filter(old=>old.chapterIndex===r.chapter-1&&new RegExp(r.pattern).test(old.knowledgePoint));
      if(!matches.length)throw Error(`${q.id}: unmatched textbook reference ${r.chapter}/${r.pattern}`);
      // Prefer an existing verified knowledge-point page over a section range.
      matches.sort((a,b)=>Number(b.source?.locationGranularity==='topic-page')-Number(a.source?.locationGranularity==='topic-page'));
      const old=matches[0];
      const ref={knowledgePoint:old.knowledgePoint,...old.source,baseQuestionId:old.id};
      if(!refs.some(a=>a.baseQuestionId===old.id))refs.push(ref);
    }
    if(!refs.length)throw Error('Missing references: '+q.id);
    q.chapterTitle=subject.chapters[q.chapterIndex].title;
    q.studySection=subject.questions.find(old=>old.chapterIndex===q.chapterIndex&&refs.some(r=>r.baseQuestionId===old.id))?.studySection||refs[0].section;
    q.sectionNumber=subject.questions.find(old=>old.chapterIndex===q.chapterIndex&&(old.studySection||old.source.section)===q.studySection)?.sectionNumber||1;
    q.source={...refs[0],references:refs,note:'本题为原创组合练习；各索引对应所用知识点，阅读范围与知识点页按核查粒度标注。'};
    q.level=labels[q.practiceStage];
    q.edition='2026教材原创进阶题';
    if(!numbers[key][q.id])numbers[key][q.id]=prefix[key]+'-'+String(next++).padStart(5,'0');
    return q;
  });
}
const attachBody=`export function attachProgression(subjects) {
  for (const [key, additions] of Object.entries(progressionQuestions)) {
    const subject=subjects[key]; if (!subject) continue;
    const known=new Set(subject.questions.map(q=>q.id));
    for (const q of additions) {if(known.has(q.id))continue;known.add(q.id);subject.questions.push(q);subject.chapters[q.chapterIndex].items.push(q);}
    if(subject.coverage)subject.coverage={...subject.coverage,totalQuestions:subject.questions.length,progressionQuestions:additions.length};
  }
  return subjects;
}`;
const todo=JSON.parse(fs.readFileSync(path.join(root,'content/study-plan-weeks.json'),'utf8'));
const groupTitles={accounting:'会计',strategy:'战略',tax:'税法'};
const seenCh={accounting:new Set(),tax:new Set(),strategy:new Set()};
const used={accounting:new Set(),tax:new Set(),strategy:new Set()};
const weeks=todo.weekly.map(w=>{
  const stage=w.week===1?'foundation':w.week<=3?'application':w.week<=8?'chapter':w.week===9||w.week===18?'review':w.week<=17?'application':w.week<=35?'cross':w.week<=44?'paper':'review';
  const bySubject={};
  for(const key of Object.keys(groupTitles)) {
    const line=w.note.split('\n').find(t=>t.startsWith(groupTitles[key]+'（'))||'';
    const current=[...line.matchAll(/第(\d+)章/g)].map(m=>Number(m[1]));
    current.forEach(n=>seenCh[key].add(n));
    const learned=Math.max(1,...seenCh[key]);
    const qs=progressionQuestions[key];
    let choices=qs.filter(q=>q.practiceStage===stage&&q.relatedChapters.every(n=>n<=learned));
    if(current.length&&stage!=='cross')choices=choices.filter(q=>current.includes(q.chapterIndex+1));
    if(!choices.length&&!['review','paper'].includes(stage))choices=qs.filter(q=>q.practiceStage==='chapter'&&q.relatedChapters.every(n=>n<=learned)&&(!current.length||current.includes(q.chapterIndex+1)));
    choices.sort((a,b)=>Number(used[key].has(a.id))-Number(used[key].has(b.id))||b.chapterIndex-a.chapterIndex);
    let chosen=['review','paper'].includes(stage)||w.week===1?[]:choices.slice(0,stage==='cross'?2:1);
    const early={accounting:{2:['01-001'],3:['02-001'],4:['02-003'],5:['03-001'],6:['03-003'],7:['04-003'],8:['05-003']},strategy:{2:['01-001'],3:['02-001'],4:['02-004'],5:['02-003'],6:['03-001'],7:['03-002'],8:['03-003']},tax:{2:['01-001'],3:['02-003'],4:['02-001'],5:['02-004'],6:['02-005'],7:['02-002'],8:['03-001']}};
    if(early[key]?.[w.week])chosen=early[key][w.week].map(suffix=>qs.find(q=>q.id===key+'-progress-'+suffix));
    if(chosen.some(q=>!q))throw Error('Missing early-week assignment');
    chosen.forEach(q=>used[key].add(q.id));
    bySubject[key]={label:line.replace(/^.*?：/,''),questionIds:chosen.map(q=>q.id),displayNumbers:chosen.map(q=>numbers[key][q.id]),minutes:chosen.reduce((n,q)=>n+q.recommendedMinutes,0),note:stage==='review'?'回做错题与已学进阶题，不新增大块任务。':stage==='paper'?'原创限时综合练习用于补充训练；计划中的历年真题仍按原要求另做。':w.week===1?'首周沿用原计划65道零基础推荐题。':w.week===4&&key==='strategy'?'本周用内部环境BCG与基准分析做章内题，SWOT案例安排在下周。':w.week<=8?'按当周已学内容选用应用题或章内题；从原科目时段中抽取，不额外增加每周总时数。':'先核对各题相关章节，再按计划独立作答并复盘。'};
  }
  return {week:w.week,start:w.start,end:w.end,stage,subjects:bySubject};
});
const papers=[];
for(const key of ['accounting','tax','strategy']) {
  const qs=progressionQuestions[key].filter(q=>q.practiceStage!=='application');
  const size=key==='accounting'?8:5;
  for(let i=0;i<4;i++) {
    const chosen=[];
    // Deterministic round-robin over chapters: paper sets are reproducible.
    for(let j=i;j<qs.length&&chosen.length<size;j+=4)chosen.push(qs[j]);
    papers.push({id:key+'-paper-'+(i+1),subjectId:key,label:subjects[key].name+'原创限时综合练习'+(i+1),questionIds:chosen.map(q=>q.id),minutes:key==='accounting'?120:90,note:'全部为原创进阶题，非历年真题，不对应正式考试题型比例或评分。'});
  }
}
const progressionPlan={weeks,papers};
fs.writeFileSync(path.join(dist,'progression.js'),'export const progressionQuestions = '+JSON.stringify(progressionQuestions,null,2)+';\nexport const progressionPlan = '+JSON.stringify(progressionPlan,null,2)+';\n'+attachBody+'\n');
fs.writeFileSync(path.join(root,'content/question-numbers.json'),JSON.stringify(numbers,null,2)+'\n');
fs.writeFileSync(path.join(dist,'question-numbers.js'),'export const questionNumbers = '+JSON.stringify(numbers)+';\n');
const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const csv=(name,header,rows)=>fs.writeFileSync(path.join(dist,name),'\ufeff'+[header,...rows].map(r=>r.map(quote).join(',')).join('\n')+'\n');
const rows=[];
for(const [key,qs] of Object.entries(progressionQuestions))for(const q of qs)rows.push([numbers[key][q.id],subjects[key].name,labels[q.practiceStage],q.chapterIndex+1,q.chapterTitle,q.relatedChapters.join('、'),q.recommendedMinutes,q.stem,q.sample,q.explain,q.rubric.join('\n'),q.source.references.map(r=>[r.knowledgePoint,r.chapter,r.section,'教材'+r.printedPage+' / PDF'+r.pdfPage,(r.locationGranularity==='section'?'阅读范围':'知识点位置')].join(' · ')).join('\n'),q.id]);
csv('progression-questions.csv',['题号','科目','练习层级','章序','章节','涉及章','建议分钟','题目','参考答案','解析','自评得分点','知识点索引','原题号'],rows);
const planRows=weeks.flatMap(w=>Object.entries(w.subjects).map(([key,v])=>[w.week,w.start,w.end,subjects[key].name,labels[w.stage]||({paper:'限时综合',review:'错题复盘'}[w.stage]),v.label,v.displayNumbers.join('；'),v.minutes,v.note]));
csv('progression-plan.csv',['周次','开始','结束','科目','计划层级','本周任务','新增题号','建议分钟','说明'],planRows);
const indexRows=[];
for(const [key,subject]of Object.entries(subjects))for(const q of [...subject.questions,...(progressionQuestions[key]||[])])for(const r of q.source.references||[{knowledgePoint:q.knowledgePoint,...q.source}])indexRows.push([numbers[key][q.id],subject.name,labels[q.practiceStage||'foundation'],r.knowledgePoint,q.chapterTitle,r.chapter,r.section,r.printedPage,r.pdfPage,{ 'topic-page':'知识点页','topic-range':'知识点范围',section:'知识节阅读范围',official:'官方补充'}[r.locationGranularity]||r.locationGranularity,r.book,r.url||'',r.note||'']);
csv('knowledge-index.csv',['题号','科目','练习层级','知识点','练习章','教材章','教材节','教材页','PDF页','定位粒度','来源','官方链接','核对说明'],indexRows);
const lines=['# 备考计划新增练习','','以现有2026教材题库为知识点依据，新增题均为原创；每题含完整条件、参考答案、解析、自评得分点和可回查索引。','','## 科目与层级','','|科目|应用推进|章内小综合|跨章综合|合计|','|---|---:|---:|---:|---:|'];
for(const [key,qs]of Object.entries(progressionQuestions))lines.push('|'+[subjects[key].name,...['application','chapter','cross'].map(s=>qs.filter(q=>q.practiceStage===s).length),qs.length].join('|')+'|');
lines.push('','应用推进包含双概念小应用；零基础题继续按原题号保留。章节学习选择练习层级；限时题在“备考计划练习”中选择，按参考答案自评。','','## 逐周新增题号','','|周|科目|任务|题号|建议分钟|','|---|---|---|---|---:|');
for(const w of weeks)for(const [key,v]of Object.entries(w.subjects))lines.push('|'+[w.week,subjects[key].name,v.label,v.displayNumbers.join('；')||v.note,v.minutes||''].join('|')+'|');
lines.push('','## 原创限时综合练习','','每套由新增题编排，供独立作答后复盘。它们不替代计划要求的历年真题，不能标为真题或正式模拟卷。','');
for(const p of papers)lines.push(`- ${p.label}：${p.minutes}分钟，${p.questionIds.map(id=>numbers[p.subjectId][id]).join('；')}。`);
lines.push('','## 完整题目与解析','');
for(const [key,qs]of Object.entries(progressionQuestions))for(const q of qs){lines.push(`### ${numbers[key][q.id]} · ${subjects[key].name} · ${labels[q.practiceStage]}`, '',q.stem,'','参考答案：',q.sample,'','解析：',q.explain,'','自评得分点：',...q.rubric.map(r=>'- '+r),'','知识点索引：',...q.source.references.map(r=>'- '+[r.knowledgePoint,r.chapter,r.section,`教材第${r.printedPage}页 / PDF第${r.pdfPage}页`,r.locationGranularity==='section'?'阅读范围':'知识点位置'].join(' · ')),'',...(q.policyReferences||[]).map(r=>`基本规则核验：[${r.title}](${r.url})（${r.checkedDate}）。`),'');}
fs.writeFileSync(path.join(dist,'progression-guide.md'),lines.join('\n')+'\n');
fs.writeFileSync(path.join(root,'content/progression-plan.json'),JSON.stringify(progressionPlan,null,2)+'\n');
// Parse quoted multiline records so repeated builds keep one row per original ID.
function parseCsv(input) {
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
 if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
// Keep per-subject downloads complete without altering their old columns.
for(const [key,qs]of Object.entries(progressionQuestions)) {
 const file=key==='accounting'?'questions.csv':key+'-questions.csv';
 const oldRows=parseCsv(fs.readFileSync(path.join(dist,file),'utf8').replace(/^\ufeff/,''));
 const baseRows=oldRows.filter(row=>!String(row.at(-1)).includes('-progress-'));
 let appended;
 if(key==='accounting')appended=qs.map(q=>[numbers[key][q.id],'进阶练习',q.chapterIndex+1,q.chapterTitle,'简答',q.level,q.stem,'','','','','',q.sample,q.explain,q.knowledgePoint,q.source.chapter,q.source.section,q.source.printedPage,q.source.pdfPage,q.id]);
 else if(key==='strategy')appended=qs.map(q=>[numbers[key][q.id],'进阶练习',q.source.chapter,q.studySection,q.knowledgePoint,'简答应用',q.stem,'','','','',q.sample,q.explain,q.source.printedPage,q.source.pdfPage,q.source.note,q.edition,q.id]);
 else appended=qs.map(q=>[numbers[key][q.id],subjects[key].name,'进阶练习',q.source.chapter,q.studySection,q.knowledgePoint,q.level,'简答应用',q.stem,'','','','',q.sample,q.explain,q.source.printedPage,q.source.pdfPage,q.source.book,q.source.url||'',q.source.note,q.edition,q.id]);
 fs.writeFileSync(path.join(dist,file),'\ufeff'+[...baseRows,...appended].map(r=>r.map(quote).join(',')).join('\n')+'\n');
}
console.log(JSON.stringify({added:Object.fromEntries(Object.entries(progressionQuestions).map(([k,v])=>[k,v.length])),weeks:weeks.length,papers:papers.length}));
