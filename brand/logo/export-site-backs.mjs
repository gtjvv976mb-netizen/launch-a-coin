/** Exact site back artwork in the existing native SVG fan; no generated redraw. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(here, 'site-backs');
const qa = join(root, 'output/playwright/logo-site-backs-2026-10-28');
mkdirSync(out, { recursive: true });
mkdirSync(qa, { recursive: true });
const stem = 'launch-a-card-logo';
const source = readFileSync(join(here, 'carddex-master.svg'), 'utf8');
const gradients = source.slice(source.indexOf('<defs>') + 6, source.indexOf('    <!-- Identical backs'));
const crown = source.slice(source.indexOf('  <!-- The crown floats'), source.lastIndexOf('</svg>'));
const cards = [
  { position:'left', design:'yugioh-spell', transform:'translate(39.5 82.5) rotate(-24)' },
  { position:'right', design:'aurora', transform:'translate(88.5 82.5) rotate(24)' },
  { position:'center', design:'regal', transform:'translate(64 85)' },
];
const manifest = [];
const backs = cards.map(({position,design,transform}) => {
  const path = `app/public/assets/carddex/higgsfield/${design}-back.webp`;
  const bytes = readFileSync(join(root,path));
  manifest.push({ position, design, path, sha256:createHash('sha256').update(bytes).digest('hex') });
  // The site's shared template is 63:88. The existing fan centers/crown remain.
  // preserveAspectRatio="none" mirrors GeneratedCardReverse's object-fit:fill.
  return `<g transform="${transform}" data-site-design="${design}">
    <rect x="-25.2" y="-35.2" width="50.4" height="70.4" rx="4" fill="#201a18" stroke="#251d17" stroke-width="1.8" transform="translate(.2 1.1)"/>
    <rect x="-25.2" y="-35.2" width="50.4" height="70.4" rx="4" fill="url(#lac-edge)"/>
    <image x="-25.2" y="-35.2" width="50.4" height="70.4" preserveAspectRatio="none" clip-path="url(#site-back-clip)" href="data:image/webp;base64,${bytes.toString('base64')}"/>
    <rect x="-25.2" y="-35.2" width="50.4" height="70.4" rx="4" fill="none" stroke="url(#lac-edge)" stroke-width=".7"/>
  </g>`;
}).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Launch a Card: three actual card backs and a separate crown">
  <defs>${gradients}<clipPath id="site-back-clip"><rect x="-25.2" y="-35.2" width="50.4" height="70.4" rx="4"/></clipPath></defs>
  ${backs}
  ${crown}
</svg>\n`;
writeFileSync(join(out, `${stem}.svg`),svg);
writeFileSync(join(out, 'sources.json'), JSON.stringify({
  composition:'Three back-facing cards in a fan, separate crown, no lettering. Actual 63:88 site template.',
  rendering:'Original full-resolution site WebPs embedded unchanged. Same fill behavior as GeneratedCardReverse.',
  sources:manifest,
},null,2)+'\n');

const cli = process.env.PLAYWRIGHT_CLI || 'playwright-cli';
const config = process.env.PLAYWRIGHT_CONFIG;
const exports = [
  {size:2048,name:`${stem}-transparent.png`,background:'transparent',inset:0},
  {size:1024,name:`${stem}-preview.png`,background:'#211e18',inset:.07},
];
const proofRows = ['#211e18','#faf3df'].map(background => `<section style="display:flex;align-items:center;justify-content:space-around;padding:28px 20px;background:${background};height:236px;box-sizing:border-box">${[180,96,64,48,32].map(size=>`<div style="width:190px;display:flex;justify-content:center"><img width="${size}" height="${size}" /></div>`).join('')}</section>`).join('');
const code = `async (page) => {
  const proof = await page.context().newPage();
  for (const item of ${JSON.stringify(exports)}) {
    await proof.setViewportSize({width:item.size,height:item.size});
    await proof.setContent('<html><head><style>html,body{margin:0;width:100%;height:100%}body{box-sizing:border-box;background:'+item.background+';padding:'+(item.size*item.inset)+'px}svg{display:block;width:100%;height:100%}</style></head><body>'+${JSON.stringify(svg)}+'</body></html>');
    await proof.evaluate(async()=>{await Promise.all([...document.querySelectorAll('image')].map(el=>new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=reject;image.src=el.getAttribute('href');})));});
    await proof.screenshot({path:${JSON.stringify(out)}+'/'+item.name,omitBackground:item.background==='transparent'});
  }
  await proof.setViewportSize({width:1050,height:472});
  await proof.setContent('<html><head><style>body{margin:0}</style></head><body>'+${JSON.stringify(proofRows)}+'</body></html>');
  await proof.evaluate(async(url)=>{await Promise.all([...document.images].map(el=>{el.src=url;return el.decode();}));},${JSON.stringify('data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'))});
  await proof.screenshot({path:${JSON.stringify(join(qa,'size-proof.png'))}});
  await proof.close();
}`;
const codePath=join(qa,'export-code.js');
writeFileSync(codePath,code);
const options={cwd:root,stdio:'pipe',maxBuffer:8*1024*1024};
try {
  execFileSync(cli,['-s=lac-site-logo-export','open','about:blank',...(config?['--config',config]:[])],options);
  execFileSync(cli,['-s=lac-site-logo-export','run-code','--filename',codePath],options);
  console.log(`Saved self-contained SVG,2048px transparent PNG and preview to ${out}`);
} finally {
  execFileSync(cli,['-s=lac-site-logo-export','close'],options);
}
