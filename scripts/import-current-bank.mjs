import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// One-time import from an existing offline checkout. Normal Pages builds only
// read question-bank/*.json; they never need the APK, EXE or this source path.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.argv[2] || '../cpa-3.2.1');
const web=path.join(source,'native/web');
const read=name=>fs.readFileSync(path.join(web,name),'utf8');
const load=name=>import(pathToFileURL(path.join(web,name)).href);
const {chapters,questions}=await load('questions.js');
const {extraSubjects}=await load('extra-subjects.js');
const {strategySubject}=await load('strategy.js');
const {questionNumbers}=await load('question-numbers.js');
const {attachProgression,progressionPlan}=await load('progression.js');
const {attachRealExams}=await load('real-exams.js');
const app=read('app.js');
const modulesLine=app.match(/^const accountingModules = (.*);\r?$/m);
if(!modulesLine)throw Error('Cannot locate accounting module metadata');
const accountingModules=JSON.parse(modulesLine[1].replaceAll("'",'"'));
const subjects={accounting:{name:'会计',chapters,questions,modules:accountingModules},...extraSubjects,strategy:strategySubject};
attachProgression(subjects);attachRealExams(subjects);
const write=(name,data)=>{
  const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
};
const release=JSON.parse(fs.readFileSync(path.join(source,'downloads/peer/release.json'),'utf8'));
const counts={};
for(const [id,subject] of Object.entries(subjects)){
  const value=JSON.parse(JSON.stringify(subject));
  value.chapters=subject.chapters.map(chapter=>({...chapter,items:(chapter.items||[]).map(q=>q.id)}));
  write('question-bank/subjects/'+id+'.json',{schemaVersion:1,id,...value});
  counts[id]=subject.questions.length;
}
write('question-bank/catalog.json',{schemaVersion:1,sourceVersion:release.version,sourceBankId:release.bankId,subjectOrder:Object.keys(subjects),questionNumbers,progressionPlan});
const copyFiles=(from,to)=>{
  if(!fs.existsSync(from))return;
  for(const entry of fs.readdirSync(from,{withFileTypes:true})){
    const relative=path.join(to,entry.name),original=path.join(from,entry.name);
    if(entry.isDirectory())copyFiles(original,relative);
    else {fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});fs.copyFileSync(original,path.join(root,relative));}
  }
};
copyFiles(path.join(web,'real-exam-assets'),'question-bank/assets/real-exam-assets');
for(const name of fs.readdirSync(web).filter(name=>/\.(?:csv|md)$/.test(name))){
  const target=path.join(root,'question-bank/downloads',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(web,name),target);
}
let program="import {getBank} from './bank-store.js';\nconst {subjects,questionNumbers,progressionPlan,bankId}=getBank();\n"+app.slice(app.indexOf("let subjectId='accounting';"));
const nativeStart=program.lastIndexOf('\npeerSync=createPeerSync(');
if(nativeStart<0)throw Error('Cannot separate native bridge initialization');
program=program.slice(0,nativeStart)+'\n';
program=program.replace("picture.src = media.src.startsWith('data:') ? media.src : './'+media.src;","picture.src = media.src;");
program=program.replace("请使用配套 APK 或 Windows EXE 打开设备同步。","网页版记录保存在当前浏览器。请在“练习历史”中导出备份，在另一设备导入；局域网自动同步请使用配套 APK 或 EXE。");
write('site/app.js',program);write('site/app.css',read('app.css'));
let html=read('index.html');
html=html.replace('<body>','<body>\n  <section id="bankLoading" class="bank-loading" role="status"><h1>正在加载题库</h1><p id="bankLoadStatus">正在检查题库版本，请稍候…</p><button id="bankRetry" type="button" hidden>重新加载</button></section>\n  <div id="siteRoot" hidden>');
html=html.replace('<script type="module" src="./app.js"></script>','</div>\n  <footer class="bank-footer"><span id="bankInfo">题库加载中</span><button id="bankRefresh" type="button" hidden>检查更新</button></footer>\n  <script type="module" src="./bootstrap.js"></script>');
write('site/index.html',html);
write('site/app.css',read('app.css')+'\n[hidden]{display:none!important}\n.bank-loading{max-width:560px;margin:12vh auto;padding:24px;text-align:center;color:#18314f}.bank-loading h1{font-size:24px}.bank-loading p{line-height:1.7;white-space:pre-line}.bank-loading button,.bank-footer button{cursor:pointer;border:1px solid #b8cfe2;border-radius:6px;background:white;color:#156bc1;padding:8px 14px}.bank-footer{display:flex;justify-content:center;align-items:center;gap:12px;flex-wrap:wrap;padding:14px;font-size:12px;color:#64748b}.bank-footer button{padding:4px 8px;font-size:12px}\n');
write('.branch-context.json',{repository:'hHeyLgMK/hHeyLgMK-cpa-accounting-from-zero-2026',branch:'codex/github-pages-question-bank',sourceVersion:release.version,counts});
console.log(JSON.stringify({sourceVersion:release.version,counts,total:Object.values(counts).reduce((a,b)=>a+b,0),appBytes:Buffer.byteLength(program)}));
