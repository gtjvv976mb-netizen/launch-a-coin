/** Run through the installed playwright-cli owned token-site-gif session. No app source changes. */
async (page) => {
  const base = 'http://127.0.0.1:5310';
  const directory = 'output/playwright/token-site-gif-2026-10-29';
  const errors = [], writes = [], failedResponses = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({url: request.url(), method: request.method()}); });
  page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) failedResponses.push({url: response.url(), status: response.status()}); });
  await page.route('**/*', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) await route.abort('blockedbyclient');
    else await route.continue();
  });
  await page.goto(base + '/launch?design=doge&quote=doge', {waitUntil: 'domcontentloaded'});
  await page.getByRole('heading', {name: 'Create your card', exact: true}).waitFor();
  const step = page.getByRole('combobox', {name: 'Launch step', exact: true});
  await step.selectOption('0');
  await page.getByRole('textbox', {name: 'Name', exact: true}).fill('Your Token');
  await page.getByRole('textbox', {name: 'Ticker', exact: true}).fill('TOKEN');
  await step.selectOption('1');
  await page.locator('input[type=file]').setInputFiles('app/public/assets/creatures/glorb.webp');
  await page.locator('.cdx-launch-art__image').waitFor();
  await step.selectOption('4');
  await page.getByRole('textbox', {name: 'Description', exact: true}).fill('Your token. Your card.');
  await page.locator('.cdx-create-preview .cdx-canonical-skin[data-card-skin-ready]').first().waitFor();
  await page.locator('.cdx-create-preview .cdx-generated-reverse[data-generated-back-ready]').first().waitFor();
  await page.waitForFunction(() => {
    const scene = document.querySelector('.cdx-create-preview .mdx-card3d');
    const shown = scene?.querySelector('.mdx-card3d__slot[data-on]');
    return shown?.querySelector('.mdx-card__title')?.textContent === 'Your Token'
      && shown?.querySelector('.mdx-card__lore')?.textContent === 'Your token. Your card.'
      && (scene?.__body?.watchers.size ?? 1) === 0;
  });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(700);
  const setup = await page.evaluate(async () => {
    await document.fonts.ready;
    const original = document.querySelector('.cdx-create-preview .cdx-launch-card');
    const scene = original?.querySelector('.mdx-card3d');
    const body = scene?.__body;
    if (!original || !scene || !body) throw new Error('Actual site card and engine body were not available.');
    const sourceBefore = [...scene.querySelectorAll('img')].map(image => ({className: image.className, src: image.getAttribute('src'), srcSet: image.getAttribute('srcset'), currentSrc: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight}));
    const originalThickness = getComputedStyle(body.pose).getPropertyValue('--t').trim();
    const originalPerspective = getComputedStyle(scene).perspective;
    const originalTurnArcScale = body.turnArcScale;
    const originalStep = body.step.bind(body);
    body.step = () => false;
    body.onFrame = null;
    body.idle = 'none';
    body.useGyro = false;
    body.tween = null;
    body.watchers.clear();
    body.moments = 0;
    body.spinRate = 0;
    body.spinBoost = 0;
    body.spinOn = false;
    body.held = false;
    body.focusHold = false;
    body.dragging = true;
    body.input = {rx: 0, ry: 0};
    for (const key of ['rx', 'ry', 'lift', 'hold', 'boost']) body[key].snap(0);
    body.sc.snap(1);
    body.live.snap(1);
    body.flip.snap(0);
    // Existing actual 3D scene and all card wrappers are moved, never cloned or redrawn.
    const stage = document.createElement('div');
    stage.id = 'token-export-stage';
    stage.className = 'token-export';
    stage.append(original);
    document.body.append(stage);
    const stylesheet = document.createElement('style');
    stylesheet.textContent = `
      html, body { width:1024px !important; height:1024px !important; min-width:0 !important; margin:0 !important; padding:0 !important; overflow:hidden !important; background:#f5efe2 !important; }
      body > :not(#token-export-stage) { display:none !important; }
      #token-export-stage { position:fixed; inset:0; width:1024px; height:1024px; display:grid; place-items:center; overflow:hidden; background:#f5efe2; }
      #token-export-stage .cdx-launch-card { position:relative !important; display:block !important; width:557.1490909091px !important; height:778.24px !important; min-width:0 !important; min-height:0 !important; max-width:none !important; max-height:none !important; padding:0 !important; margin:0 !important; }
      #token-export-stage .cdx-hero-turntable { position:relative !important; display:block !important; width:100% !important; height:100% !important; min-width:0 !important; min-height:0 !important; max-width:none !important; max-height:none !important; margin:0 !important; padding:0 !important; }
      #token-export-stage .mdx-card3d { position:relative !important; display:block !important; width:100% !important; height:100% !important; min-width:0 !important; min-height:0 !important; max-width:none !important; max-height:none !important; margin:0 !important; padding:0 !important; }
      #token-export-stage :is(.cdx-hero-turntable__controls,.cdx-launch-card__inspect,.mdx-card3d__halo,.mdx-card3d__ground,.mdx-card3d__pedestal) { display:none !important; }
      .token-export [data-card-slot="market-cap"] { display:none !important; }
    `;
    document.head.append(stylesheet);
    for (const image of scene.querySelectorAll('img')) {
      const candidates = (image.getAttribute('srcset') || '').split(',').map(part => part.trim().split(/\s+/)).filter(parts => parts.length > 1).sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
      if (candidates[0]) {
        image.removeAttribute('srcset');
        image.removeAttribute('sizes');
        image.src = candidates[0][0];
      }
      image.loading = 'eager';
      await image.decode();
    }
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    body.W = scene.offsetWidth;
    const animations = stage.getAnimations({subtree: true});
    for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
    const corners = [];
    for (const z of [-1, 1]) for (const x of [0, 1]) for (const y of [0, 1]) {
      const probe = document.createElement('i');
      probe.dataset.exportCorner = `${z}:${x}:${y}`;
      probe.style.cssText = `position:absolute;left:${x * 100}%;top:${y * 100}%;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;transform:translateZ(calc(var(--t) * ${z} / 2))`;
      body.pose.append(probe);
      corners.push(probe);
    }
    window.__tokenExport = {scene, body, originalStep, animations, corners, stage};
    const sourceAfter = await Promise.all([...scene.querySelectorAll('img')].map(async image => {
      // naturalWidth can retain srcset density correction after removing srcset.
      // ImageBitmap reports the actual decoded pixel dimensions used in paint.
      const bitmap = await createImageBitmap(image);
      const bitmapWidth = bitmap.width, bitmapHeight = bitmap.height;
      bitmap.close();
      return {className: image.className, currentSrc: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, bitmapWidth, bitmapHeight, complete: image.complete};
    }));
    return {
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      originalThickness, exportThickness: getComputedStyle(body.pose).getPropertyValue('--t').trim(),
      originalPerspective, exportPerspective: getComputedStyle(scene).perspective,
      originalTurnArcScale, exportTurnArcScale: body.turnArcScale,
      cssRest: {...body.cssRest}, wallCount: body.edges?.children.length,
      wallHeight: body.edges?.firstElementChild ? getComputedStyle(body.edges.firstElementChild).height : null,
      frontRadius: getComputedStyle(scene.querySelector('.mdx-card')).borderRadius,
      backRadius: getComputedStyle(scene.querySelector('.mdx-card3d__back')).borderRadius,
      fontsReady: document.fonts.status, sourceBefore,
      sourceAfter,
      sceneBounds: scene.getBoundingClientRect().toJSON(), animationCount: animations.length,
      artClientOnly: scene.querySelector('.mdx-card__art img')?.src.startsWith('blob:') ?? false,
      tokenName: scene.querySelector('.mdx-card__title')?.textContent,
      tokenTicker: scene.querySelector('.mdx-card__ticker')?.textContent,
      lore: scene.querySelector('.mdx-card__lore')?.textContent,
      quoteText: scene.querySelector('.mdx-card__type')?.textContent,
    };
  });
  const frames = [];
  for (let index = 0; index < 64; index++) {
    const state = await page.evaluate(index => {
      const {scene, body, originalStep, animations, corners} = window.__tokenExport;
      const angle = index * 360 / 64;
      for (const animation of animations) animation.currentTime = 0;
      body.flip.snap(angle);
      body.dragging = true;
      body.input = {rx: 0, ry: 0};
      for (const key of ['rx', 'ry', 'lift', 'hold', 'boost']) body[key].snap(0);
      body.sc.snap(1); body.live.snap(1);
      originalStep(0, 100000 + index * 50, 'full', false, false);
      const readLight = element => ({px: Number(element?.style.getPropertyValue('--px')), py: Number(element?.style.getPropertyValue('--py')), lit: Number(element?.style.getPropertyValue('--lit'))});
      const projectedCorners = corners.map(element => {
        const rect = element.getBoundingClientRect();
        return {key: element.dataset.exportCorner, x: rect.x, y: rect.y, radius: Math.hypot(rect.x - 512, rect.y - 512)};
      });
      const market = scene.querySelector('[data-card-slot="market-cap"]');
      return {
        index, angle, durationMs: index === 0 || index === 32 ? 600 : 40,
        pose: body.pose.style.transform, edge: scene.hasAttribute('data-edge'),
        frontLight: readLight(scene.querySelector('.mdx-card__lights')),
        backLight: readLight(scene.querySelector('.mdx-card3d__back-lights')),
        corners: projectedCorners,
        maxCornerRadius: Math.max(...projectedCorners.map(point => point.radius)),
        marketCapVisible: !!market && getComputedStyle(market).display !== 'none',
        frontOverflow: getComputedStyle(scene.querySelector('.mdx-card')).overflow,
        backOverflow: getComputedStyle(scene.querySelector('.mdx-card3d__back')).overflow,
        edgeThickness: getComputedStyle(body.pose).getPropertyValue('--t').trim(),
      };
    }, index);
    await page.screenshot({path: `${directory}/frames/doge-${String(index).padStart(3, '0')}.png`, animations: 'allow', caret: 'hide', scale: 'device'});
    frames.push(state);
  }
  const range = (side, key) => Math.max(...frames.map(frame => frame[side][key])) - Math.min(...frames.map(frame => frame[side][key]));
  const checks = {
    expectedViewport: setup.width === 1024 && setup.height === 1024 && setup.dpr === 2,
    actualExistingThickness: setup.originalThickness === setup.exportThickness && frames.every(frame => frame.edgeThickness === setup.originalThickness),
    actualExistingPerspective: setup.originalPerspective === setup.exportPerspective,
    preservedTurnArc: setup.originalTurnArcScale === setup.exportTurnArcScale,
    completeFrontBackAssets: setup.sourceAfter.every(image => image.complete && image.width > 0 && image.height > 0),
    nativeFrontAtlas: setup.sourceAfter.some(image => /render\/doge\.png/.test(image.currentSrc) && image.bitmapWidth >= 1260),
    nativeReverse: setup.sourceAfter.some(image => /higgsfield\/doge-back\.webp/.test(image.currentSrc) && image.bitmapWidth >= 1260),
    noMarketCap: frames.every(frame => !frame.marketCapVisible),
    frontShimmer: range('frontLight', 'px') > .5,
    backShimmer: range('backLight', 'px') > .5,
    edgeActive: frames.every(frame => frame.edge),
    circleSafe: frames.every(frame => frame.maxCornerRadius <= 512),
    clipped: frames.every(frame => ['hidden', 'clip'].includes(frame.frontOverflow) && ['hidden', 'clip'].includes(frame.backOverflow)),
    noWrites: writes.length === 0,
    noRuntimeErrors: errors.length === 0,
    noFailedResponses: failedResponses.length === 0,
  };
  for (const [name, pass] of Object.entries(checks)) if (!pass) failures.push(name);
  return {origin: base, design: 'doge', capture: 'actual site Card3D DOM and engine; no generated replacement geometry', frameCount: frames.length, dimensions: [2048, 2048], durationMs: frames.reduce((sum, frame) => sum + frame.durationMs, 0), setup, frames, checks, failures, errors, writes, failedResponses, pass: failures.length === 0};
}
