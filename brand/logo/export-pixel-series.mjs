/** Native logo wrappers keep source pixels unchanged and add profile-crop space. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const out=join(root,'brand/logo/pixel-crown-free-series-2026-10-28');
const qa=join(root,'output/playwright/pixel-logo-series-2026-10-28');mkdirSync(qa,{recursive:true});
const names=['01-card-fan','02-booster-pack','03-collectors-album'];
const labels=['01 · CARD FAN','02 · BOOSTER PACK','03 · COLLECTOR ALBUM'];
const variants=names.map((name)=>{
 const bytes=readFileSync(join(out,name+'.png'));
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" viewBox="0 0 1500 1500" role="img" aria-label="Launch a Card crown-free pixel logo"><defs><clipPath id="avatar-bounds"><circle cx="750" cy="750" r="730"/></clipPath></defs><image x="${(1500-width)/2}" y="${(1500-height)/2}" width="${width}" height="${height}" image-rendering="pixelated" clip-path="url(#avatar-bounds)" href="data:image/png;base64,${bytes.toString('base64')}"/></svg>`;
 writeFileSync(join(out,name+'-avatar.svg'),svg);
 return {name,svg};
});
const code=`async(page)=>{
 const p=await page.context().newPage();
 for(const v of ${JSON.stringify(variants)}){
  await p.setViewportSize({width:1500,height:1500});
  await p.setContent('<html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>'+v.svg+'</body></html>');
  await p.evaluate(async()=>{await Promise.all([...document.querySelectorAll('image')].map(el=>new Promise((ok,fail)=>{const i=new Image();i.onload=ok;i.onerror=fail;i.src=el.getAttribute('href');})));});
  await p.screenshot({path:${JSON.stringify(out)}+'/'+v.name+'-avatar.png',omitBackground:true});
 }
 await p.setViewportSize({width:1200,height:820});
 const urls=${JSON.stringify(variants)}.map(v=>'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(v.svg))));
 const cards=urls.map((url,i)=>'<section><h2>'+${JSON.stringify(labels)}[i]+'</h2><div class="hero"><img width="350" height="350" src="'+url+'"/></div><div class="sizes"><div class="dark"><img width="128" height="128" src="'+url+'"/></div><div class="light"><img width="128" height="128" src="'+url+'"/></div></div><div class="small"><img width="48" height="48" src="'+url+'"/><span>48px avatar</span></div></section>').join('');
 await p.setContent('<html><head><style>body{margin:0;background:#f4eedf;color:#24231b;font:16px Arial}header{padding:28px 40px 24px}h1{margin:0 0 8px;font-size:30px}header p{margin:0;color:#68624e}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:0 28px}section{min-width:0;background:#eae3d2;border:1px solid #cfc4ac;border-radius:16px;padding:16px 10px}h2{font-size:15px;letter-spacing:1.5px;margin:4px 12px 16px}.hero{background:#181b14;border-radius:14px;display:flex;justify-content:center}img{display:block;image-rendering:pixelated}.sizes{display:flex;justify-content:space-evenly;gap:14px;padding:24px 12px 14px}.dark,.light{width:128px;height:128px;border-radius:50%;overflow:hidden}.dark{background:#161a12}.light{background:#fff4d8;border:1px solid #c7b690}.small{display:flex;gap:14px;align-items:center;padding:12px 20px}.small img{border-radius:50%;background:#181b14}.small span{font-size:13px;color:#68624e}</style></head><body><header><h1>Launch a Card · Crown-free pixel series</h1><p>Actual site card motifs · wordless · transparent PNGs · circular crop and small-size comparison</p></header><main>'+cards+'</main></body></html>');
 await p.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode()));});
 await p.screenshot({path:${JSON.stringify(join(out,'series-preview.png'))}});
 await p.close();
}`;
const codePath=join(qa,'export-code.js');writeFileSync(codePath,code);
const cli=process.env.PLAYWRIGHT_CLI||'playwright-cli';
const cfg=process.env.PLAYWRIGHT_CONFIG||join(root,'output/playwright/carddex-2026-10-28/browser-root.json');
const opts={cwd:root,stdio:'pipe',maxBuffer:12*1024*1024};
try{execFileSync(cli,['-s=pixel-series','open','about:blank','--config',cfg],opts);execFileSync(cli,['-s=pixel-series','run-code','--filename',codePath],opts);console.log('Exported three circle-safe avatar PNGs and comparison.');}
finally{execFileSync(cli,['-s=pixel-series','close'],opts);}
