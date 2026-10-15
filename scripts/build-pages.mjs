import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateSubject,validateCatalog,validateManifest,hydrateBank} from '../site/bank-schema.js';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=data=>createHash('sha256').update(data).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function filesIn(directory){
  if(!fs.existsSync(directory))return [];
  const entries=[];
  for(const item of fs.readdirSync(directory,{withFileTypes:true})){
    const original=path.join(directory,item.name);
    if(item.isSymbolicLink())throw Error('Source symlinks are not supported: '+original);
    if(item.isDirectory())entries.push(...filesIn(original));else if(item.isFile())entries.push(original);
  }
  return entries.sort();
}
export function buildPages(root=projectRoot){
  root=fs.realpathSync(root);
  // Only this exact generated directory may be recursively replaced.
  const output=path.resolve(root,'_site');
  if(path.dirname(output)!==root||path.basename(output)!=='_site')throw Error('Unsafe build output path');
  const source=path.join(root,'question-bank');
  const catalog=validateCatalog(JSON.parse(fs.readFileSync(path.join(source,'catalog.json'),'utf8')));
  const resources=[],subjects=Object.create(null),assets=[],assetPaths=new Map();
  const assetRoot=path.join(source,'assets');
  for(const file of filesIn(assetRoot)){
    const extension=path.extname(file).toLowerCase();
    if(!['.png','.jpg','.jpeg','.svg','.webp'].includes(extension))throw Error('Unsupported bank asset: '+file);
    const data=fs.readFileSync(file),sha256=hash(data),relative='assets/'+sha256+extension;
    assetPaths.set(path.relative(assetRoot,file).split(path.sep).join('/'),relative);
    if(!assets.some(item=>item.path===relative))assets.push({path:relative,sha256,bytes:data.length,data});
  }
  for(const id of catalog.subjectOrder){
    const subject=validateSubject(JSON.parse(fs.readFileSync(path.join(source,'subjects',id+'.json'),'utf8')));
    if(subject.id!==id)throw Error('Subject ID and filename do not match: '+id);
    for(const q of subject.questions)for(const media of q.media||[]){
      const published=assetPaths.get(media.src);
      if(!published)throw Error('Missing question image: '+media.src);
      media.src=published;
    }
    subjects[id]=subject;
    const data=json(subject);resources.push({id,name:subject.name,questionCount:subject.questions.length,data,sha256:hash(data),bytes:data.length});
  }
  if(catalog.subjectOrder.length!==6)throw Error('This release must retain all six CPA subjects');
  const catalogData=json(catalog),catalogHash=hash(catalogData);
  const version=hash(JSON.stringify({schemaVersion:1,catalog:catalogHash,subjects:resources.map(item=>[item.id,item.sha256]),assets:assets.map(item=>[item.path,item.sha256])}));
  const manifest={schemaVersion:1,version,sourceVersion:catalog.sourceVersion,
    questionCount:resources.reduce((sum,item)=>sum+item.questionCount,0),
    catalog:{path:version+'/catalog.json',sha256:catalogHash,bytes:catalogData.length},
    subjects:resources.map(({id,name,questionCount,sha256,bytes})=>({id,name,questionCount,path:version+'/'+id+'.json',sha256,bytes})),
    assets:assets.map(({path,sha256,bytes})=>({path,sha256,bytes}))};
  validateManifest(manifest);hydrateBank(manifest,catalog,subjects,'https://example.invalid/project/banks/manifest.json');
  if(fs.existsSync(output)){
    if(fs.lstatSync(output).isSymbolicLink())throw Error('Refusing to replace a linked output directory');
    fs.rmSync(output,{recursive:true,force:true});
  }
  fs.mkdirSync(output,{recursive:true});
  const runtimeHashes={};
  for(const file of filesIn(path.join(root,'site'))){
    const relative=path.relative(path.join(root,'site'),file),target=path.join(output,relative);
    if(!/\.(?:html|css|js)$/.test(relative))throw Error('Unexpected website source file: '+relative);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);
    runtimeHashes[relative.split(path.sep).join('/')]=hash(fs.readFileSync(file));
  }
  const bankOutput=path.join(output,'banks',version);fs.mkdirSync(bankOutput,{recursive:true});
  fs.writeFileSync(path.join(bankOutput,'catalog.json'),catalogData);
  for(const item of resources)fs.writeFileSync(path.join(bankOutput,item.id+'.json'),item.data);
  for(const item of assets){const target=path.join(output,'banks',item.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,item.data);}
  fs.writeFileSync(path.join(output,'banks','manifest.json'),json(manifest));
  for(const file of filesIn(path.join(source,'downloads'))){
    if(!/\.(?:csv|md)$/.test(file))throw Error('Unexpected bank download file: '+file);
    fs.copyFileSync(file,path.join(output,path.basename(file)));
  }
  fs.writeFileSync(path.join(output,'.nojekyll'),'');
  const report={schemaVersion:1,sourceVersion:catalog.sourceVersion,bankVersion:version,questionCount:manifest.questionCount,
    subjects:Object.fromEntries(resources.map(item=>[item.id,item.questionCount])),assets:assets.length,runtimeHashes};
  fs.writeFileSync(path.join(output,'release.json'),json(report));
  return {output,manifest,report};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {report}=buildPages();console.log(JSON.stringify(report));
}
