import {validateManifest,hydrateBank} from './bank-schema.js';

export function createBankCache(indexedDB=globalThis.indexedDB){
  const open=()=>new Promise((resolve,reject)=>{
    if(!indexedDB){resolve(null);return;}
    const request=indexedDB.open('cpa-question-bank-cache-v1',1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('banks'))request.result.createObjectStore('banks');};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('题库缓存暂不可用。'));
  });
  const access=async(mode,key,value)=>{
    const db=await open();if(!db)return undefined;
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('banks',mode),store=tx.objectStore('banks');
      const request=mode==='readonly'?store.get(key):store.put(value,key);
      let result;request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||Error('题库缓存写入失败。'));
    });}finally{db.close();}
  };
  return {read:key=>access('readonly',key),write:(key,value)=>access('readwrite',key,value)};
}

const digest=async text=>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
};
async function decodePayload(manifest,texts,manifestURL){
  validateManifest(manifest);
  const resources=[manifest.catalog,...manifest.subjects];
  for(const resource of resources){
    const text=texts[resource.path];
    if(typeof text!=='string'||new TextEncoder().encode(text).length!==resource.bytes||await digest(text)!==resource.sha256)throw Error('题库文件校验失败，请稍后重试。');
  }
  const catalog=JSON.parse(texts[manifest.catalog.path]),subjects=Object.create(null);
  for(const resource of manifest.subjects)subjects[resource.id]=JSON.parse(texts[resource.path]);
  return hydrateBank(manifest,catalog,subjects,manifestURL);
}

export async function loadBank({manifestURL,fetcher=globalThis.fetch.bind(globalThis),cache=createBankCache(),onProgress=()=>{}}){
  const key=new URL(manifestURL).href;
  let previous;
  try{previous=await cache.read(key);}catch{/* Blocked storage must not prevent online study. */}
  let networkError;
  try{
    const response=await fetcher(key,{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('暂时无法读取题库版本。');
    const manifest=validateManifest(await response.json());
    if(previous?.manifest?.version===manifest.version){
      try{return {...await decodePayload(manifest,previous.texts,key),fromCache:false,cached:true};}catch{/* Refresh a corrupt or mismatched cache. */}
    }
    const resources=[manifest.catalog,...manifest.subjects],texts=Object.create(null);
    let loaded=0;onProgress({loaded,total:resources.length});
    await Promise.all(resources.map(async resource=>{
      const url=new URL(resource.path,key);
      const result=await fetcher(url.href,{cache:'no-cache',signal:AbortSignal.timeout(30000)});
      if(!result.ok)throw Error('题库文件下载失败，请检查网络后重试。');
      const text=await result.text();
      if(new TextEncoder().encode(text).length>20000000)throw Error('题库文件超过支持大小。');
      texts[resource.path]=text;onProgress({loaded:++loaded,total:resources.length});
    }));
    const bank=await decodePayload(manifest,texts,key);
    let cached=true;
    try{await cache.write(key,{manifest,texts});}catch{cached=false;}
    return {...bank,fromCache:false,cached};
  }catch(error){networkError=error;}
  if(previous){
    try{return {...await decodePayload(previous.manifest,previous.texts,key),fromCache:true,cached:true,warning:'新题库暂未加载成功，正在使用上次保存的题库。'};}catch{/* Never replace a valid bank with an incomplete one. */}
  }
  throw networkError||Error('无法加载题库。');
}
