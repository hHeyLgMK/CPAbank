export const BANK_SCHEMA_VERSION=1;
const subjectPattern=/^[a-z][a-z0-9-]{0,39}$/;
const hashPattern=/^[a-f0-9]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const requireValue=(condition,message)=>{if(!condition)throw Error(message);};

export function validateManifest(value){
  requireValue(object(value)&&value.schemaVersion===BANK_SCHEMA_VERSION,'暂不支持这个题库格式，请更新网页程序。');
  requireValue(hashPattern.test(value.version),'题库版本标识无效。');
  requireValue(Number.isSafeInteger(value.questionCount)&&value.questionCount>0&&value.questionCount<=100000,'题目数量无效。');
  requireValue(Array.isArray(value.subjects)&&value.subjects.length>0&&value.subjects.length<=20,'科目清单无效。');
  const ids=new Set();
  for(const entry of value.subjects){
    requireValue(object(entry)&&subjectPattern.test(entry.id)&&!['constructor','prototype'].includes(entry.id)&&!ids.has(entry.id),'科目标识重复或无效。');
    ids.add(entry.id);validateResource(entry,value.version+'/'+entry.id+'.json');
    requireValue(Number.isSafeInteger(entry.questionCount)&&entry.questionCount>0,'科目题目数量无效。');
  }
  requireValue(ids.size===6&&['accounting','law','finance','tax','audit','strategy'].every(id=>ids.has(id)),'题库需要完整的六科数据。');
  validateResource(value.catalog,value.version+'/catalog.json');
  requireValue(Array.isArray(value.assets)&&value.assets.length<=2000,'题目图片清单无效。');
  const assets=new Set();
  for(const entry of value.assets){
    requireValue(object(entry)&&/^assets\/[a-f0-9]{64}\.(png|jpg|jpeg|svg|webp)$/.test(entry.path)&&!assets.has(entry.path),'题目图片路径无效。');
    requireValue(hashPattern.test(entry.sha256)&&Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=20000000,'题目图片信息无效。');
    assets.add(entry.path);
  }
  return value;
}
function validateResource(entry,expected){
  requireValue(object(entry)&&entry.path===expected&&hashPattern.test(entry.sha256),'题库文件路径或校验信息无效。');
  requireValue(Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=20000000,'题库文件大小无效。');
}

export function validateCatalog(value){
  requireValue(object(value)&&value.schemaVersion===BANK_SCHEMA_VERSION&&object(value.questionNumbers),'题号目录格式无效。');
  requireValue(object(value.progressionPlan)&&Array.isArray(value.progressionPlan.papers),'练习计划格式无效。');
  requireValue(Array.isArray(value.subjectOrder)&&value.subjectOrder.every(id=>subjectPattern.test(id)),'科目顺序无效。');
  return value;
}

export function validateSubject(value){
  requireValue(object(value)&&value.schemaVersion===BANK_SCHEMA_VERSION&&subjectPattern.test(value.id),'科目题库格式无效。');
  requireValue(typeof value.name==='string'&&value.name.length>0&&Array.isArray(value.modules),'科目信息无效。');
  requireValue(Array.isArray(value.chapters)&&value.chapters.length>0&&value.chapters.length<=300,'章节目录无效。');
  requireValue(Array.isArray(value.questions)&&value.questions.length>0&&value.questions.length<=50000,'科目题目数量无效。');
  const ids=new Set();
  for(const q of value.questions){
    requireValue(object(q)&&typeof q.id==='string'&&q.id.length>0&&q.id.length<=150&&!ids.has(q.id),'题号重复或无效。');
    ids.add(q.id);
    requireValue(['single','multi','written'].includes(q.type)&&typeof q.stem==='string'&&q.stem.trim().length>0,'题目类型或题干无效。');
    requireValue(Number.isSafeInteger(q.chapterIndex)&&q.chapterIndex>=0&&q.chapterIndex<value.chapters.length,'题目所属章节无效。');
    if(q.type!=='written'){
      requireValue(Array.isArray(q.options)&&q.options.length>=2&&q.options.length<=12&&q.options.every(option=>typeof option==='string'),'题目选项无效。');
      if(q.answer!==null&&q.answer!==undefined){
        const answers=q.type==='single'?[q.answer]:q.answer;
        requireValue(Array.isArray(answers)&&answers.length>0&&new Set(answers).size===answers.length&&answers.every(index=>Number.isSafeInteger(index)&&index>=0&&index<q.options.length),'参考答案的选项编号无效。');
      }
    }
    if(q.media!==undefined)requireValue(Array.isArray(q.media)&&q.media.every(media=>object(media)&&typeof media.src==='string'),'题目图片格式无效。');
  }
  for(const chapter of value.chapters){
    requireValue(object(chapter)&&typeof chapter.title==='string'&&Array.isArray(chapter.items)&&chapter.items.every(id=>typeof id==='string'&&ids.has(id)),'章节引用了不存在的题目。');
  }
  return value;
}

export function hydrateBank(manifest,catalog,rawSubjects,manifestURL){
  validateManifest(manifest);validateCatalog(catalog);
  const subjects=Object.create(null),allIds=new Set(),assets=new Set(manifest.assets.map(asset=>asset.path));
  const order=catalog.subjectOrder;
  requireValue(order.length===manifest.subjects.length&&new Set(order).size===order.length,'科目顺序与清单不一致。');
  let total=0;
  for(const id of order){
    const descriptor=manifest.subjects.find(entry=>entry.id===id);
    requireValue(descriptor&&rawSubjects[id],'题库文件缺失。');
    const subject=validateSubject(JSON.parse(JSON.stringify(rawSubjects[id])));
    requireValue(subject.id===id&&subject.questions.length===descriptor.questionCount,'科目题目数量与清单不一致。');
    const byId=new Map(subject.questions.map(q=>[q.id,q]));
    for(const q of subject.questions){
      requireValue(!allIds.has(q.id),'不同科目使用了相同内部题号。');allIds.add(q.id);
      for(const media of q.media||[]){
        requireValue(assets.has(media.src),'题目引用了未发布的图片。');
        const url=new URL(media.src,manifestURL);
        requireValue(['http:','https:'].includes(url.protocol)&&url.origin===new URL(manifestURL).origin,'图片地址无效。');
        media.src=url.href;
      }
    }
    subject.chapters=subject.chapters.map(chapter=>({...chapter,items:chapter.items.map(qid=>byId.get(qid))}));
    subjects[id]=subject;total+=subject.questions.length;
  }
  requireValue(total===manifest.questionCount,'题库总题数与清单不一致。');
  for(const paper of catalog.progressionPlan.papers){
    requireValue(object(paper)&&subjects[paper.subjectId]&&Array.isArray(paper.questionIds),'限时练习配置无效。');
    const ids=new Set(subjects[paper.subjectId].questions.map(q=>q.id));
    requireValue(paper.questionIds.every(id=>ids.has(id)),'限时练习引用了不存在的题目。');
  }
  return {subjects,questionNumbers:catalog.questionNumbers,progressionPlan:catalog.progressionPlan,
    bankId:manifest.version,sourceVersion:manifest.sourceVersion||'独立题库',questionCount:total};
}
