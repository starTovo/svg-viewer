/* Pinch-stability probe (v5).
 * Drives synthetic two-finger trajectories WITH sensor jitter through the real
 * page and reports, for each scenario:
 *   - the committed scale series
 *   - reversals: adjacent samples that move in opposite directions
 *   - 2nd-difference variance / abs-max (a jitter proxy that ignores the
 *     intentional ramp: a perfectly smooth ramp has ~0 second difference)
 *   - per-frame TRANSLATE jump (px) -- this is what "画面抽搐" looks like
 * Also checks the 2->1 handover and double-tap suppression.
 *
 * Run: NODE_PATH=E:/svg_view/qa/node_modules node E:/svg_view/app/qa-pinch.cjs <tag>
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = 'file:///E:/svg_view/app/index.html';
const TAG = process.argv[2] || 'run';
const OUT = 'E:/svg_view/app/pinch-' + TAG + '.json';

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    try { localStorage.setItem('svgview.onboarded', '1'); localStorage.setItem('svgview.hint.rename', '1'); } catch (e) { }
  });
  await page.goto(URL_);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.SvgApp.setSource('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect x="0" y="0" width="200" height="200" fill="#5E6AD2"/></svg>', 'p.svg');
  });
  await page.waitForTimeout(400);

  const res = await page.evaluate(async () => {
    const vp = document.getElementById('viewport');
    const r = vp.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

    function ev(type, id, x, y) {
      vp.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: id === 1,
        clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: 1
      }));
    }
    const frame = () => new Promise(r2 => requestAnimationFrame(() => r2()));
    const view = () => (window.SvgApp.getView ? window.SvgApp.getView()
      : { k: window.SvgApp.getState().zoom, x: 0, y: 0 });
    /* Ground truth of what the user SEES: where the artwork sits on screen.
       Read from the transformed stage, so it works before and after the fix. */
    const stage = document.getElementById('stage');
    const screenPos = () => {
      const b = stage.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    };

    // deterministic pseudo-noise so before/after runs are comparable
    let seed = 20250919;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const noise = () => (rnd() * 2 - 1) * 2;   // +/-2 px of sensor jitter

    const out = { sym: null, alt: null, handover: null, doubleTap: null };

    /* ---- A · symmetric pinch: both fingers move every frame, jittered ---- */
    window.SvgApp.resetZoom();
    await frame();
    let d = 140;
    let id = 1;
    ev('pointerdown', id, cx - d / 2, cy); id++;
    ev('pointerdown', id, cx + d / 2, cy); id++;
    await frame();
    let sx = [view().k], stx = [screenPos().x];
    for (let i = 0; i < 40; i++) {
      d += 5;
      const j1 = noise(), j2 = noise();
      ev('pointermove', 1, cx - d / 2 + j1, cy + j1 * 0.5);
      ev('pointermove', 2, cx + d / 2 + j2, cy + j2 * 0.5);
      await frame();
      const v = view(); sx.push(v.k); stx.push(screenPos().x);
    }
    ev('pointerup', 1, cx - d / 2, cy); ev('pointerup', 2, cx + d / 2, cy);
    await frame();
    out.sym = { k: sx, x: stx };

    /* ---- B · alternating pinch: only ONE finger moves per frame (the common
             thumb + index gesture), jittered. ---- */
    window.SvgApp.resetZoom();
    await frame();
    d = 140;
    ev('pointerdown', 11, cx - d / 2, cy);
    ev('pointerdown', 12, cx + d / 2, cy);
    await frame();
    let ax = [view().k], atx = [screenPos().x];
    for (let i = 0; i < 40; i++) {
      d += 5;                       // the pinch still opens 5px per frame ...
      const j = noise();
      if (i % 2 === 0) { ev('pointermove', 11, cx - d / 2 + j, cy); }
      else { ev('pointermove', 12, cx + d / 2 + j, cy); }
      await frame();
      const v = view(); ax.push(v.k); atx.push(screenPos().x);
    }

    /* ---- C · 2 -> 1 handover: the scale must not jump ---- */
    out.alt = { k: ax, x: atx };
    const before = view().k;
    ev('pointerup', 12, cx + d / 2, cy);
    await frame();
    const afterUp = view().k;
    ev('pointermove', 11, cx - d / 2 + 30, cy + 20);
    await frame();
    const afterDrag = view().k;
    ev('pointerup', 11, cx - d / 2 + 30, cy + 20);
    await frame();
    out.handover = { before: +before.toFixed(4), afterUp: +afterUp.toFixed(4), afterDrag: +afterDrag.toFixed(4) };

    /* ---- D · two-finger taps must never trigger the double-tap zoom ---- */
    window.SvgApp.resetZoom();
    await frame();
    const z0 = view().k;
    for (let n = 0; n < 2; n++) {
      ev('pointerdown', 21, cx - 30, cy);
      ev('pointerdown', 22, cx + 30, cy);
      ev('pointerup', 21, cx - 30, cy);
      ev('pointerup', 22, cx + 30, cy);
      await frame(); await frame();
    }
    out.doubleTap = { z0: +z0.toFixed(4), z1: +view().k.toFixed(4) };
    return out;
  });

  function stats(k, x) {
    let rev = 0, maxRev = 0;
    for (let i = 2; i < k.length; i++) {
      const a = k[i - 1] - k[i - 2], b = k[i] - k[i - 1];
      if (a * b < 0) { rev++; maxRev = Math.max(maxRev, Math.abs(b)); }
    }
    const d2 = [];
    for (let i = 2; i < k.length; i++) d2.push(k[i] - 2 * k[i - 1] + k[i - 2]);
    const m = d2.reduce((a, b) => a + b, 0) / d2.length;
    const v = d2.reduce((a, b) => a + (b - m) * (b - m), 0) / d2.length;
    let jump = 0;
    for (let i = 1; i < x.length; i++) jump = Math.max(jump, Math.abs(x[i] - x[i - 1]));
    return {
      reversals: rev,
      maxReversal: +maxRev.toFixed(4),
      d2Var: +v.toExponential(3),
      d2AbsMax: +Math.max.apply(null, d2.map(Math.abs)).toFixed(4),
      maxTranslateJumpPx: +jump.toFixed(2)
    };
  }

  const report = {
    tag: TAG,
    A_symmetric: Object.assign(stats(res.sym.k, res.sym.x), { k: res.sym.k.map(v => +v.toFixed(4)) }),
    B_alternating: Object.assign(stats(res.alt.k, res.alt.x), { k: res.alt.k.map(v => +v.toFixed(4)) }),
    C_handover: res.handover,
    D_doubleTap: res.doubleTap,
    consoleIssues: errs
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
}

run().catch(e => { console.error('ERR', e); process.exit(1); });
