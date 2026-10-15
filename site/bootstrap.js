import {loadBank} from './bank-loader.js';
import {setBank} from './bank-store.js';

const status=document.getElementById('bankLoadStatus');
const retry=document.getElementById('bankRetry');
retry.onclick=()=>location.reload();
document.getElementById('bankRefresh').onclick=()=>location.reload();
try{
  const bank=await loadBank({manifestURL:new URL('./banks/manifest.json',import.meta.url).href,
    onProgress:({loaded,total})=>{status.textContent='正在加载题库：'+loaded+' / '+total+'，请稍候…';}});
  setBank(bank);
  await import('./app.js');
  document.getElementById('bankInfo').textContent='题库 '+bank.sourceVersion+' · '+bank.questionCount.toLocaleString('zh-CN')+' 题 · '+bank.bankId.slice(0,8)+(bank.fromCache?' · 使用上次题库':'');
  document.getElementById('bankInfo').title=bank.warning||'答题记录保存在当前浏览器，可在练习历史中导出备份。';
  document.getElementById('bankRefresh').hidden=false;
  document.getElementById('bankLoading').hidden=true;
  document.getElementById('siteRoot').hidden=false;
}catch(error){
  status.textContent='题库暂时未能加载。\n'+(error?.message||'请检查网络后重试。')+'\n已有答题记录会保留。';
  retry.hidden=false;
}
