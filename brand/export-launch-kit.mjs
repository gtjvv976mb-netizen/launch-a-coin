/** Reproducible social graphics extending the existing native SVG brand system. */
import {readFileSync, writeFileSync, mkdirSync, copyFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dest=join(root,'brand/launch-kit-2026-10-28');
const qa=join(root,'output/playwright/launch-kit-2026-10-28');
mkdirSync(dest,{recursive:true}); mkdirSync(qa,{recursive:true});
const original=join(root,'brand/logo/social-doge-pokemon-pepe');
for(const [source,name] of [
  ['launch-a-card-pumpfun.png','pumpfun-token-image-1024.png'],
  ['launch-a-card-x.png','x-profile-400.png'],
  ['launch-a-card-transparent.png','logo-transparent-2048.png'],
  ['launch-a-card-logo.svg','logo-master.svg'],
  ['sources.json','card-art-sources.json'],
]) copyFileSync(join(original,source),join(dest,name));

const mark=readFileSync(join(original,'launch-a-card-logo.svg'),'utf8').replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
const font=(name)=>readFileSync(join(root,'app/public/fonts',name)).toString('base64');
const engraving=Array.from({length:18},(_,i)=>{
  const spread=60+i*14;
  return `<path d="M ${1150-spread} 500 Q ${1250-spread} ${240-i*9} ${1510-i*4} ${-40+i*3}"/>`;
}).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500" role="img" aria-label="Launch a Card. Every coin is a card. Crowned Doge, Pokémon and Pepe card backs.">
<defs>
 <style>
 @font-face{font-family:KitSerif;src:url(data:font/woff2;base64,${font('newsreader-latin-opsz-normal.woff2')}) format('woff2');font-weight:200 800;}
 @font-face{font-family:KitSans;src:url(data:font/woff2;base64,${font('instrument-sans-latin-wdth-normal.woff2')}) format('woff2');font-weight:400 700;}
 text{font-kerning:normal;text-rendering:geometricPrecision;}
 </style>
 <linearGradient id="kit-bg" x2="1" y2="1"><stop stop-color="#111510"/><stop offset=".58" stop-color="#1c1c14"/><stop offset="1" stop-color="#161a13"/></linearGradient>
 <radialGradient id="kit-light"><stop stop-color="#786438" stop-opacity=".26"/><stop offset="1" stop-color="#786438" stop-opacity="0"/></radialGradient>
 <linearGradient id="kit-foil"><stop stop-color="#9c7b43"/><stop offset=".28" stop-color="#e7c783"/><stop offset=".6" stop-color="#b69151"/><stop offset="1" stop-color="#f7dfaa"/></linearGradient>
 <pattern id="kit-grain" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".45" fill="#e6c787" fill-opacity=".045"/></pattern>
 <clipPath id="kit-bounds"><rect width="1500" height="500"/></clipPath>
</defs>
<g clip-path="url(#kit-bounds)">
 <rect width="1500" height="500" fill="url(#kit-bg)"/>
 <ellipse cx="1155" cy="265" rx="460" ry="390" fill="url(#kit-light)"/>
 <g fill="none" stroke="#c8a25a" stroke-width=".65" opacity=".11">${engraving}</g>
 <path d="M 840 0 L 672 500 M 855 0 L 687 500" stroke="#d5b675" stroke-opacity=".075" fill="none"/>
 <rect width="1500" height="500" fill="url(#kit-grain)"/>
 <rect x="40" y="34" width="1420" height="432" rx="18" fill="none" stroke="url(#kit-foil)" stroke-opacity=".3"/>
 <path d="M 62 92 V 58 H 96 M 1404 58 H 1438 V 92 M 1438 408 V 442 H 1404 M 96 442 H 62 V 408" fill="none" stroke="url(#kit-foil)" stroke-width="1.2" opacity=".65"/>
 <g fill="#d2b277" opacity=".7"><path d="m 62 49 4 9-4 9-4-9Z"/><path d="m 1438 49 4 9-4 9-4-9Z"/><path d="m 1438 433 4 9-4 9-4-9Z"/><path d="m 62 433 4 9-4 9-4-9Z"/></g>
 <text x="150" y="108" font-family="KitSans,sans-serif" font-size="20" font-weight="600" letter-spacing="5.2" fill="#d4b779">LAUNCH A CARD</text>
 <text x="144" y="219" font-family="KitSerif,serif" font-size="112" font-weight="400" letter-spacing="-3" fill="#fff2d7">Every coin</text>
 <text x="144" y="316" font-family="KitSerif,serif" font-size="112" font-weight="400" letter-spacing="-3" fill="#fff2d7">is a card.</text>
 <text x="150" y="359" font-family="KitSans,sans-serif" font-size="21" font-weight="400" fill="#c4c0ab">Launch on pump.fun. Make it collectible.</text>
 <g transform="translate(972 36) scale(2.4)">${mark}</g>
 <text x="1164" y="426" text-anchor="middle" font-family="KitSans,sans-serif" font-size="17" font-weight="500" letter-spacing="2" fill="#d4b779">launchacard.fun</text>
</g></svg>`;
writeFileSync(join(dest,'x-header-master.svg'),svg);
const code=`async(page)=>{
 const p=await page.context().newPage();
 await p.setViewportSize({width:1500,height:500});
 await p.setContent('<html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>'+${JSON.stringify(svg)}+'</body></html>');
 await p.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('image')].map(el=>new Promise((ok,fail)=>{const i=new Image();i.onload=ok;i.onerror=fail;i.src=el.getAttribute('href');})));});
 await p.screenshot({path:${JSON.stringify(join(dest,'x-header-1500x500.png'))}});
 const image='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(${JSON.stringify(svg)})));
 await p.setViewportSize({width:1500,height:940});
 await p.setContent('<html><head><style>body{margin:0;background:#f6f0e3;font-family:Arial;color:#211f19}.header{height:500px;position:relative;overflow:hidden}.header img{width:1500px;height:500px}.crop{position:absolute;left:0;right:0;height:60px;background:#ff52702b;pointer-events:none}.top{top:0}.bottom{bottom:0}.avatar{position:absolute;left:74px;top:375px;width:210px;height:210px;border-radius:50%;border:9px solid #f6f0e3;background:#141811}.avatar img{width:100%;height:100%;border-radius:50%}h1{margin:115px 0 7px 75px;font-size:35px}p{margin:0 0 24px 75px;color:#5d5a4e;font-size:20px}.mobile{margin-left:75px;width:450px;overflow:hidden;border:1px solid #c6bdab}.mobile img{display:block;width:450px;height:150px}</style></head><body><div class="header"><img id="header"/><div class="crop top"></div><div class="crop bottom"></div></div><div class="avatar"><img id="avatar"/></div><h1>Launch a Card</h1><p>Crop proof: outer 60px bands tinted; avatar overlap at bottom left.</p><div class="mobile"><img id="mobile"/></div></body></html>');
 await p.evaluate(async({image,avatar})=>{document.querySelector('#header').src=image;document.querySelector('#mobile').src=image;document.querySelector('#avatar').src=avatar;await Promise.all([...document.images].map(i=>i.decode()));},{image,avatar:${JSON.stringify('data:image/png;base64,'+readFileSync(join(dest,'x-profile-400.png')).toString('base64'))}});
 await p.screenshot({path:${JSON.stringify(join(qa,'x-header-crop-proof.png'))}});
 await p.close();
}`;
const codePath=join(qa,'export-code.js');writeFileSync(codePath,code);
const cli=process.env.PLAYWRIGHT_CLI||'playwright-cli';
const config=process.env.PLAYWRIGHT_CONFIG||join(root,'output/playwright/carddex-2026-10-28/browser-root.json');
const opts={cwd:root,stdio:'pipe',maxBuffer:8*1024*1024};
try{
 execFileSync(cli,['-s=lac-launch-kit','open','about:blank','--config',config],opts);
 execFileSync(cli,['-s=lac-launch-kit','run-code','--filename',codePath],opts);
 console.log('Exported social kit and 1500×500 X header.');
}finally{execFileSync(cli,['-s=lac-launch-kit','close'],opts);}
