/** Platform profile exports using the exact Doge, Pokémon Classic and Pepe site backs. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../..');
const out=join(here,'social-doge-pokemon-pepe');
const qa=join(root,'output/playwright/logo-meme-social-2026-10-28');
mkdirSync(out,{recursive:true}); mkdirSync(qa,{recursive:true});
const source=readFileSync(join(here,'carddex-master.svg'),'utf8');
const gradients=source.slice(source.indexOf('<defs>')+6,source.indexOf('    <!-- Identical backs'));
const crown=source.slice(source.indexOf('  <!-- The crown floats'),source.lastIndexOf('</svg>'));
const cards=[
  {position:'left',design:'doge',x:48,y:88,angle:-20,width:52},
  {position:'right',design:'pepe',x:112,y:88,angle:20,width:52},
  {position:'front-center',design:'pokemon-classic',x:80,y:112,angle:0,width:48},
];
const sources=[];
const art=cards.map(card=>{
  const path=`app/public/assets/carddex/higgsfield/${card.design}-back.webp`;
  const bytes=readFileSync(join(root,path));
  const h=card.width*88/63,w=card.width,r=w*.075;
  sources.push({...card,path,sha256:createHash('sha256').update(bytes).digest('hex')});
  return `<g transform="translate(${card.x} ${card.y}) rotate(${card.angle})" data-site-design="${card.design}">
    <defs><clipPath id="clip-${card.design}"><rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${r}"/></clipPath></defs>
    <rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${r}" fill="#191912" filter="url(#profile-card-shadow)"/>
    <image x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" preserveAspectRatio="none" clip-path="url(#clip-${card.design})" href="data:image/webp;base64,${bytes.toString('base64')}"/>
    <rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="url(#lac-gold)" stroke-width=".9"/>
  </g>`;
}).join('\n');
const defs=`<defs>${gradients}
  <filter id="profile-card-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.1" flood-color="#050705" flood-opacity=".8"/></filter>
  <radialGradient id="profile-surface" cx="45%" cy="32%" r="78%"><stop stop-color="#2a2b20"/><stop offset=".6" stop-color="#171b15"/><stop offset="1" stop-color="#10130f"/></radialGradient>
</defs>`;
const mark=`${art}\n<g transform="translate(16 6)">${crown}</g>`;
const svg=(background)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="Launch a Card crowned Doge, Pokémon and Pepe card backs">${defs}${background?'<rect width="160" height="160" fill="url(#profile-surface)"/>':''}${mark}</svg>\n`;
const transparent=svg(false),profile=svg(true);
writeFileSync(join(out,'launch-a-card-logo.svg'),transparent);
writeFileSync(join(out,'launch-a-card-profile.svg'),profile);
writeFileSync(join(out,'sources.json'),JSON.stringify({
  description:'Three actual back-facing site cards, Doge left, Pokémon Classic center, Pepe right; separate crown, no lettering.',
  sourceIntegrity:'Original full-resolution WebPs embedded unchanged; 63:88 proportions and fill behavior match the site.',
  canvas:160,circularSafeRadius:72,sources,
},null,2)+'\n');
const exports=[
  {size:1024,name:'launch-a-card-pumpfun.png',transparent:false},
  {size:400,name:'launch-a-card-x.png',transparent:false},
  {size:2048,name:'launch-a-card-transparent.png',transparent:true},
];
const code=`async(page)=>{
  const p=await page.context().newPage();
  const variants={profile:${JSON.stringify(profile)},transparent:${JSON.stringify(transparent)}};
  for(const item of ${JSON.stringify(exports)}){
    await p.setViewportSize({width:item.size,height:item.size});
    await p.setContent('<html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style></head><body>'+variants[item.transparent?'transparent':'profile']+'</body></html>');
    await p.evaluate(async()=>{await Promise.all([...document.querySelectorAll('image')].map(el=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=el.getAttribute('href');})));});
    await p.screenshot({path:${JSON.stringify(out)}+'/'+item.name,omitBackground:item.transparent});
  }
  await p.setViewportSize({width:1024,height:580});
  await p.setContent('<html><head><style>body{margin:0;background:#f7f1e4}main{height:580px;display:flex;align-items:center;justify-content:space-around;gap:20px}section{display:flex;gap:18px;align-items:center}img{display:block}.circle{border-radius:50%}</style></head><body><main><section><img width="400" height="400" class="circle"/></section><section style="flex-direction:column"><img width="128" height="128" class="circle"/><img width="64" height="64" class="circle"/><img width="48" height="48" class="circle"/></section><section><img width="320" height="320"/></section></main></body></html>');
  await p.evaluate(async(url)=>{await Promise.all([...document.images].map(img=>{img.src=url;return img.decode();}));},'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(variants.profile))));
  await p.screenshot({path:${JSON.stringify(join(qa,'profile-size-proof.png'))}});
  await p.close();
}`;
const codePath=join(qa,'export-code.js');writeFileSync(codePath,code);
const cli=process.env.PLAYWRIGHT_CLI||'playwright-cli';
const config=process.env.PLAYWRIGHT_CONFIG;
const options={cwd:root,stdio:'pipe',maxBuffer:8*1024*1024};
try{
  execFileSync(cli,['-s=lac-meme-social','open','about:blank',...(config?['--config',config]:[])],options);
  execFileSync(cli,['-s=lac-meme-social','run-code','--filename',codePath],options);
  console.log('Exported pump.fun1024, X400 and transparent2048 PNGs, plus standalone SVGs.');
}finally{execFileSync(cli,['-s=lac-meme-social','close'],options);}
