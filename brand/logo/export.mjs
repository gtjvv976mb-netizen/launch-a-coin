/** Chromium exports of the repository-native SVG; no image generation or editing. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const cli = process.env.PLAYWRIGHT_CLI || 'playwright-cli';
const config = process.env.PLAYWRIGHT_CONFIG;
const output = join(root, 'output/playwright/logo-fan-2026-10-28');
mkdirSync(output, { recursive: true });
const svg = readFileSync(join(here, 'carddex-master.svg'), 'utf8');
const pngs = [180, 192, 512].map(size => ({ size, path: join(root, `app/public/assets/brand/carddex-${size}.png`), background: '#211e18', inset: .08 }));
pngs.push({ size: 1024, path: join(here, 'carddex-transparent.png'), background: 'transparent', inset: 0 });
pngs.push({ size: 1024, path: join(here, 'carddex-gold.png'), background: '#211e18', inset: .1 });
const proofRows = ['#211e18', '#faf3df'].map(background => `<section style="display:flex;align-items:center;justify-content:space-around;padding:36px 24px;background:${background};height:228px;box-sizing:border-box">${[180, 96, 64, 48, 32].map(size => `<div style="width:190px;display:flex;align-items:center;justify-content:center"><svg width="${size}" height="${size}" viewBox="0 0 128 128">${svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</svg></div>`).join('')}</section>`).join('');
const exportSource = `async (page) => {
  const proof = await page.context().newPage();
  for (const item of ${JSON.stringify(pngs)}) {
    await proof.setViewportSize({width:item.size,height:item.size});
    await proof.setContent('<html><head><style>html,body{margin:0;width:100%;height:100%}body{box-sizing:border-box;background:'+item.background+';padding:'+(item.size*item.inset)+'px}svg{display:block;width:100%;height:100%}</style></head><body>'+${JSON.stringify(svg)}+'</body></html>');
    await proof.screenshot({path:item.path, omitBackground:item.background === 'transparent'});
  }
  await proof.setViewportSize({width:1050,height:456});
  await proof.setContent('<html><head><style>body{margin:0}</style></head><body>'+${JSON.stringify(proofRows)}+'</body></html>');
  await proof.screenshot({path:${JSON.stringify(join(output, 'logo-size-proof.png'))}});
  await proof.close();
}`;
const codePath = join(output, 'export-code.js');
writeFileSync(codePath, exportSource);
const options = { cwd: root, stdio: 'pipe' };
try {
  execFileSync(cli, ['-s=lac-logo-export', 'open', 'about:blank', ...(config ? ['--config', config] : [])], options);
  execFileSync(cli, ['-s=lac-logo-export', 'run-code', '--filename', codePath], options);
  console.log(`Rendered ${pngs.length} PNG exports and the light/dark size proof in ${output}`);
} finally {
  execFileSync(cli, ['-s=lac-logo-export', 'close'], options);
}
