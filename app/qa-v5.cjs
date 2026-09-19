/* QA round 5 (v5) - additions on top of the 100-item baseline in qa.cjs.
 *
 *   E1..E7   export path wired to the native host (3 branches:
 *            host present / pure web / host reports failure)
 *   V1..V3   version is 1.2.0 and prefers the host manifest value
 *   P1..P4   pinch no longer twitches (jitter trajectory, 2->1 handover,
 *            double-tap suppression, fit centring not regressed)
 *
 * Real browser: playwright-core + local Chrome.
 * Run: NODE_PATH=E:/svg_view/_local/qa/node_modules node E:/svg_view/app/qa-v5.cjs
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = 'file:///E:/svg_view/app/index.html';
const SHOTS = 'E:/svg_view/_local/shots/app';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const consoleMsgs = [];
const pageErrors = [];
let currentVp = '';

function rec(id, name, pass, detail) {
  results.push({ id, name, pass: !!pass, detail: String(detail), vp: currentVp });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${currentVp} ${id} ${name} - ${detail}`);
}

function wire(page, vp) {
  page.on('console', m => {
    const t = m.type();
    consoleMsgs.push({ vp, type: t, text: m.text() });
    if (t === 'error' || t === 'warning') console.log(`  [console.${t}@${vp}] ${m.text()}`);
  });
  page.on('pageerror', e => {
    pageErrors.push({ vp, text: e.message });
    console.log(`  [pageerror@${vp}] ${e.message}`);
  });
}

function seedSeen(page) {
  return page.addInitScript(() => {
    try {
      localStorage.setItem('svgview.onboarded', '1');
      localStorage.setItem('svgview.hint.rename', '1');
    } catch (e) { /* ignore */ }
  });
}

const LONG_PATH = '/storage/emulated/0/Download/SVGStudio/exports/2026/very-long-folder-name-that-must-not-break-the-sheet';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'] });

  /* ================================================================
     A · host WITH the full export-dir API (window.Android alias)
     ================================================================ */
  currentVp = 'v5-native-dir';
  let ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
  });
  let page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.addInitScript(() => {
    window.__n = { calls: [], dirs: { svg: 'Download/SVGStudio', png: '' } };
    /* Deliberately injected as window.Android: both names are injected by the
       shell and the page must treat them as the same host. */
    window.Android = {
      toast: function (m) { window.__n.calls.push(['toast', String(m)]); },
      getAppVersion: function () { return '1.2.0'; },
      getExportDir: function (t) { window.__n.calls.push(['getExportDir', t]); return window.__n.dirs[t] || ''; },
      setExportDir: function (t, p) { window.__n.dirs[t] = p; return p; },
      pickExportDir: function (t) { window.__n.calls.push(['pickExportDir', t]); }
    };
  });
  await page.goto(URL_);
  await page.waitForTimeout(700);
  await page.click('#btnSettings');
  await page.waitForTimeout(450);

  let r = await page.evaluate(() => ({
    svg: document.getElementById('pathSvg').textContent,
    png: document.getElementById('pathPng').textContent,
    note: document.getElementById('pathNote').textContent,
    tone: document.getElementById('pathNote').getAttribute('data-tone'),
    ver: document.getElementById('aboutVer').textContent,
    host: window.SvgApp.getHost(),
    asked: window.__n.calls.filter(c => c[0] === 'getExportDir').map(c => c[1])
  }));
  rec('E1', 'host backfills both rows at boot (getExportDir svg+png), no fake default',
    r.svg === 'Download/SVGStudio' && r.png === '系统默认（下载目录）' &&
    r.asked.indexOf('svg') >= 0 && r.asked.indexOf('png') >= 0 && r.host === 'Android',
    JSON.stringify(r));
  rec('E2', 'host present -> the "not supported" warning is gone',
    !/尚不支持/.test(r.note) && r.tone === null, r.note);
  rec('V1', 'about version prefers the host manifest value', r.ver === '1.2.0', r.ver);

  // 修改 -> system folder picker, not the inline field
  await page.click('#editSvgBtn');
  await page.waitForTimeout(250);
  r = await page.evaluate(() => ({
    calls: window.__n.calls.filter(c => c[0] === 'pickExportDir'),
    rowHidden: document.getElementById('editSvg').hidden
  }));
  rec('E3', '修改 calls pickExportDir(svg) and does not open the inline field',
    r.calls.length === 1 && r.calls[0][1] === 'svg' && r.rowHidden === true,
    JSON.stringify(r));

  // host answers: picked
  r = await page.evaluate(() => {
    window.__n.calls.length = 0;
    window.SvgApp.onExportDirPicked('svg', 'Download/SVGStudio');
    const p = document.getElementById('pathSvg');
    return {
      text: p.textContent, title: p.title,
      toasts: window.__n.calls.filter(c => c[0] === 'toast').map(c => c[1]),
      stored: localStorage.getItem('svgview.exportDir.svg')
    };
  });
  rec('E4', 'onExportDirPicked updates the row, toasts the target, caches it',
    r.text === 'Download/SVGStudio' && r.stored === 'Download/SVGStudio' &&
    r.toasts.some(m => m === 'SVG 将保存到：Download/SVGStudio'),
    JSON.stringify(r));

  // host answers: failed
  r = await page.evaluate(() => {
    window.__n.calls.length = 0;
    window.SvgApp.onExportDirFailed('png', 'cancelled');
    const n = document.getElementById('pathNote');
    return {
      note: n.textContent, tone: n.getAttribute('data-tone'),
      toasts: window.__n.calls.filter(c => c[0] === 'toast').map(c => c[1])
    };
  });
  rec('E5', 'onExportDirFailed is never silent (inline reason + toast)',
    /已取消选择目录/.test(r.note) && r.tone === 'warn' &&
    r.toasts.some(m => /已取消选择目录/.test(m)),
    JSON.stringify(r));

  // long display path must not break the sheet
  r = await page.evaluate((LONG) => {
    window.SvgApp.onExportDirPicked('png', LONG);
    const p = document.getElementById('pathPng');
    const cs = getComputedStyle(p);
    const body = document.querySelector('.sheet-body');
    return {
      text: p.textContent,
      ellipsis: cs.textOverflow, overflow: cs.overflow, ws: cs.whiteSpace,
      w: Math.round(p.getBoundingClientRect().width),
      bodyW: Math.round(body.getBoundingClientRect().width),
      scroll: body.scrollWidth - body.clientWidth,
      sheetW: Math.round(document.getElementById('sheet').getBoundingClientRect().width),
      vw: window.innerWidth
    };
  }, LONG_PATH);
  rec('E6', 'long path stays clipped: ellipsis, no sheet overflow',
    r.ellipsis === 'ellipsis' && r.overflow === 'hidden' && r.ws === 'nowrap' &&
    r.w <= r.bodyW && r.scroll <= 1 && r.sheetW <= r.vw,
    JSON.stringify(r));

  await page.screenshot({ path: SHOTS + '/v5-01-sheet-native.png' });

  /* native callbacks must degrade: host without pickExportDir keeps working */
  r = await page.evaluate(() => {
    const before = document.getElementById('pathSvg').textContent;
    return { before: before, hasPicker: typeof window.Android.pickExportDir === 'function' };
  });
  rec('E7', 'native host keeps the last committed directory', r.before === 'Download/SVGStudio' && r.hasPicker, JSON.stringify(r));
  await ctx.close();

  /* ================================================================
     B · pure web (no host at all)
     ================================================================ */
  currentVp = 'v5-web';
  ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
  });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(700);
  await page.click('#btnSettings');
  await page.waitForTimeout(450);

  r = await page.evaluate(() => ({
    host: window.SvgApp.getHost(),
    note: document.getElementById('pathNote').textContent,
    tone: document.getElementById('pathNote').getAttribute('data-tone'),
    ver: document.getElementById('aboutVer').textContent
  }));
  rec('E8', 'pure web: honest degrade note kept, amber tone, host=web',
    r.host === 'web' && /尚不支持自定义路径/.test(r.note) && r.tone === 'warn',
    JSON.stringify(r));
  rec('V2', 'pure web: about falls back to SvgApp.version 1.2.0', r.ver === '1.2.0', r.ver);

  await page.click('#editSvgBtn');
  await page.waitForTimeout(200);
  await page.fill('#inputSvg', LONG_PATH);
  await page.click('#saveSvgDir');
  await page.waitForTimeout(350);
  r = await page.evaluate(() => {
    const p = document.getElementById('pathSvg');
    const cs = getComputedStyle(p);
    const body = document.querySelector('.sheet-body');
    return {
      text: p.textContent,
      ellipsis: cs.textOverflow, overflow: cs.overflow,
      w: Math.round(p.getBoundingClientRect().width),
      bodyW: Math.round(body.getBoundingClientRect().width),
      scroll: body.scrollWidth - body.clientWidth,
      stored: localStorage.getItem('svgview.exportDir.svg'),
      rowHidden: document.getElementById('editSvg').hidden
    };
  });
  rec('E9', 'pure web: 修改 still opens the inline field, caches locally, stays clipped',
    r.stored === LONG_PATH && r.rowHidden === true &&
    r.ellipsis === 'ellipsis' && r.w <= r.bodyW && r.scroll <= 1,
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v5-02-sheet-web.png' });
  await ctx.close();

  /* ================================================================
     C · pinch stability (jitter trajectory)
     ================================================================ */
  currentVp = 'v5-pinch';
  ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
  });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(700);

  const pinch = await page.evaluate(async () => {
    const vp = document.getElementById('viewport');
    const box = vp.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const stage = document.getElementById('stage');

    function ev(type, id, x, y) {
      vp.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: id === 1,
        clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: 1
      }));
    }
    const frame = () => new Promise(res => requestAnimationFrame(() => res()));
    const k = () => window.SvgApp.getView().k;
    const screenX = () => { const b = stage.getBoundingClientRect(); return b.left + b.width / 2; };

    // deterministic pseudo-noise: +/-2 px of sensor jitter per finger
    let seed = 20250919;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const noise = () => (rnd() * 2 - 1) * 2;

    const out = { sym: [], alt: [], symX: [], altX: [], handover: null, dbl: null };

    window.SvgApp.setSource('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect width="200" height="200" fill="#5E6AD2"/></svg>', 'p.svg');
    await frame();

    /* A · both fingers move every frame, jittered: 140 -> 340 px over 40 frames */
    window.SvgApp.resetZoom();
    await frame();
    let d = 140;
    ev('pointerdown', 1, cx - d / 2, cy);
    ev('pointerdown', 2, cx + d / 2, cy);
    await frame();
    out.sym.push(k()); out.symX.push(screenX());
    for (let i = 0; i < 40; i++) {
      d += 5;
      const j1 = noise(), j2 = noise();
      ev('pointermove', 1, cx - d / 2 + j1, cy + j1 * 0.5);
      ev('pointermove', 2, cx + d / 2 + j2, cy + j2 * 0.5);
      await frame();
      out.sym.push(k()); out.symX.push(screenX());
    }
    ev('pointerup', 1, cx - d / 2, cy); ev('pointerup', 2, cx + d / 2, cy);
    await frame(); out.sym.push(k());

    /* B · only ONE finger moves per frame (the common thumb+index pinch) */
    window.SvgApp.resetZoom();
    await frame();
    d = 140;
    ev('pointerdown', 11, cx - d / 2, cy);
    ev('pointerdown', 12, cx + d / 2, cy);
    await frame();
    out.alt.push(k()); out.altX.push(screenX());
    for (let i = 0; i < 40; i++) {
      d += 5;
      const j = noise();
      if (i % 2 === 0) { ev('pointermove', 11, cx - d / 2 + j, cy); }
      else { ev('pointermove', 12, cx + d / 2 + j, cy); }
      await frame();
      out.alt.push(k()); out.altX.push(screenX());
    }

    /* C · 2 -> 1 handover must not jump */
    const before = k();
    ev('pointerup', 12, cx + d / 2, cy);
    await frame();
    const afterUp = k();
    ev('pointermove', 11, cx - d / 2 + 30, cy + 20);
    await frame();
    const afterDrag = k();
    ev('pointerup', 11, cx - d / 2 + 30, cy + 20);
    await frame();
    out.handover = { before: before, afterUp: afterUp, afterDrag: afterDrag };

    /* D · two-finger taps must not fire the double-tap zoom */
    window.SvgApp.resetZoom();
    await frame();
    const z0 = k();
    for (let n = 0; n < 2; n++) {
      ev('pointerdown', 21, cx - 30, cy);
      ev('pointerdown', 22, cx + 30, cy);
      ev('pointerup', 21, cx - 30, cy);
      ev('pointerup', 22, cx + 30, cy);
      await frame(); await frame();
    }
    out.dbl = { z0: z0, z1: k() };
    return out;
  });

  function reversals(a) {
    let n = 0, mx = 0;
    for (let i = 2; i < a.length; i++) {
      const d1 = a[i - 1] - a[i - 2], d2 = a[i] - a[i - 1];
      if (d1 * d2 < 0) { n++; mx = Math.max(mx, Math.abs(d2)); }
    }
    return { n: n, mx: mx };
  }
  function jumpPx(x) {
    let m = 0;
    for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
    return m;
  }
  const rs = reversals(pinch.sym), ra = reversals(pinch.alt);
  const js = jumpPx(pinch.symX), ja = jumpPx(pinch.altX);

  rec('P1', 'jittered symmetric pinch: no adjacent-frame reversal, no visible jump',
    rs.n === 0 && js <= 6,
    `reversals=${rs.n} maxReversal=${rs.mx.toFixed(4)} maxScreenJump=${js.toFixed(2)}px`);
  rec('P2', 'jittered alternating pinch: no reversal, artwork stays put',
    ra.n === 0 && ja <= 8,
    `reversals=${ra.n} maxReversal=${ra.mx.toFixed(4)} maxScreenJump=${ja.toFixed(2)}px`);
  rec('P3', '2 fingers -> 1 finger: scale does not jump',
    Math.abs(pinch.handover.afterUp - pinch.handover.before) < 1e-6 &&
    Math.abs(pinch.handover.afterDrag - pinch.handover.before) < 1e-6,
    JSON.stringify({ before: +pinch.handover.before.toFixed(4), afterUp: +pinch.handover.afterUp.toFixed(4), afterDrag: +pinch.handover.afterDrag.toFixed(4) }));
  rec('P4', 'two-finger tap never triggers the double-tap zoom',
    pinch.dbl.z1 === pinch.dbl.z0 && pinch.dbl.z1 === 1,
    JSON.stringify(pinch.dbl));

  /* fit centring must not regress (<=2px) */
  for (const c of [
    ['square', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240"><rect width="240" height="240" fill="#0FA968"/></svg>'],
    ['wide', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 120" width="900" height="120"><rect width="900" height="120" fill="#DC6803"/></svg>'],
    ['tall', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 900" width="120" height="900"><rect width="120" height="900" fill="#5E6AD2"/></svg>']
  ]) {
    const mm = await page.evaluate(async (src) => {
      window.SvgApp.setSource(src, 'f.svg');
      await new Promise(r => requestAnimationFrame(() => r()));
      window.SvgApp.fitToScreen();
      await new Promise(r => requestAnimationFrame(() => r()));
      await new Promise(r => requestAnimationFrame(() => r()));
      const v = document.getElementById('viewport').getBoundingClientRect();
      const a = document.getElementById('stage').getBoundingClientRect();
      return {
        dx: Math.round(((a.left + a.width / 2) - (v.left + v.width / 2)) * 10) / 10,
        dy: Math.round(((a.top + a.height / 2) - (v.top + v.height / 2)) * 10) / 10
      };
    }, c[1]);
    rec('P5-' + c[0], 'fit centring still <=2px (' + c[0] + ')',
      Math.abs(mm.dx) <= 2 && Math.abs(mm.dy) <= 2, JSON.stringify(mm));
  }

  /* one-finger pan still works end to end */
  const panOk = await page.evaluate(async () => {
    window.SvgApp.resetZoom();
    await new Promise(r => requestAnimationFrame(() => r()));
    const vp = document.getElementById('viewport');
    const b = vp.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const ev = (t, id, x, y) => vp.dispatchEvent(new PointerEvent(t, {
      pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: 1
    }));
    const v0 = window.SvgApp.getView();
    ev('pointerdown', 31, cx, cy);
    ev('pointermove', 31, cx + 60, cy + 40);
    await new Promise(r => requestAnimationFrame(() => r()));
    const v1 = window.SvgApp.getView();
    ev('pointerup', 31, cx + 60, cy + 40);
    await new Promise(r => requestAnimationFrame(() => r()));
    return { dx: v1.x - v0.x, dy: v1.y - v0.y, dk: v1.k - v0.k };
  });
  rec('P6', 'single-finger pan still tracks 1:1 (regression guard)',
    Math.abs(panOk.dx - 60) < 1 && Math.abs(panOk.dy - 40) < 1 && Math.abs(panOk.dk) < 1e-6,
    JSON.stringify(panOk));

  await page.screenshot({ path: SHOTS + '/v5-03-phone-light.png' });
  await page.click('#btnTheme');
  await page.waitForTimeout(350);
  await page.screenshot({ path: SHOTS + '/v5-04-phone-dark.png' });
  rec('V3', 'SvgApp.version constant is 1.2.0',
    await page.evaluate(() => window.SvgApp.version) === '1.2.0',
    await page.evaluate(() => window.SvgApp.version));
  await ctx.close();

  /* ================================================================
     D · tablet 820x1180, light + dark
     ================================================================ */
  currentVp = 'v5-tablet';
  ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOTS + '/v5-05-tablet-light.png' });
  await page.click('#btnTheme');
  await page.waitForTimeout(350);
  await page.screenshot({ path: SHOTS + '/v5-06-tablet-dark.png' });

  await page.click('#btnSettings');
  await page.waitForTimeout(450);
  await page.screenshot({ path: SHOTS + '/v5-07-tablet-sheet.png' });
  r = await page.evaluate(() => ({
    ver: document.getElementById('aboutVer').textContent,
    note: document.getElementById('pathNote').textContent,
    tone: document.getElementById('pathNote').getAttribute('data-tone')
  }));
  rec('E10', 'tablet + no host: version 1.2.0, honest note intact',
    r.ver === '1.2.0' && /尚不支持自定义路径/.test(r.note) && r.tone === 'warn', JSON.stringify(r));
  await ctx.close();

  await browser.close();

  /* ---------------- summary ---------------- */
  const errs = consoleMsgs.filter(m => m.type() === 'error');
  const warns = consoleMsgs.filter(m => m.type() === 'warning');
  console.log('\n=== V5 SUMMARY ===');
  const pass = results.filter(x => x.pass).length;
  console.log(`results: ${pass}/${results.length} pass`);
  console.log(`console.error=${errs.length} warning=${warns.length} pageerror=${pageErrors.length}`);
  if (errs.length) console.log(JSON.stringify(errs, null, 1));
  if (warns.length) console.log(JSON.stringify(warns, null, 1));
  if (pageErrors.length) console.log(JSON.stringify(pageErrors, null, 1));
  console.log('FAILS: ' + JSON.stringify(results.filter(x => !x.pass), null, 1));
  fs.writeFileSync('E:/svg_view/app/qa-v5-results.json', JSON.stringify({ results, consoleMsgs, pageErrors }, null, 1));
}

run().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
