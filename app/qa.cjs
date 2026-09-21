/* QA harness - SVG Studio WebView app (app/index.html)
 * Real browser verification: playwright-core + local Chrome.
 * Run: NODE_PATH=./node_modules node qa.cjs
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = pathToFileURL(path.join(__dirname, 'index.html')).href;
const SHOTS = process.env.SVGVIEW_SHOTS || path.join(__dirname, 'shots');
const OUT_DIR = process.env.SVGVIEW_OUT || __dirname;
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

const SIMPLE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">\n' +
  '  <rect id="r1" x="10" y="10" width="80" height="60" fill="#ff0000" />\n' +
  '  <circle id="c1" cx="120" cy="120" r="40" fill="#00ff00" />\n' +
  '</svg>';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* v1.2 adds a first-run coach-mark overlay that intentionally eats every tap.
   Regression runs seed the "already onboarded" flag so the 35 legacy checks
   still exercise the real UI; the new V2x checks use fresh contexts. */
function seedSeen(page) {
  return page.addInitScript(() => {
    try {
      localStorage.setItem('svgview.onboarded', '1');
      localStorage.setItem('svgview.hint.rename', '1');
    } catch (e) { /* ignore */ }
  });
}

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-gpu']
  });

  /* ---------------- phone 390x844 ---------------- */
  currentVp = 'phone390';
  let ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    acceptDownloads: true
  });
  let page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(600);

  // T1 first render
  let r = await page.evaluate(() => ({
    kids: document.querySelectorAll('#svgHost > svg *').length,
    badge: document.getElementById('sizeBadge').textContent,
    valid: document.getElementById('stValid').textContent,
    count: document.getElementById('stCount').textContent,
    zoom: document.getElementById('stZoom').textContent,
    view: document.body.getAttribute('data-view')
  }));
  rec('T1', 'first render', r.kids > 5 && /×/.test(r.badge) && r.view === 'preview', JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/phone-01-preview.png' });

  // T2 tab bar real tap -> code
  await page.click('#tab-code');
  await page.waitForTimeout(400);
  r = await page.evaluate(() => ({ view: document.body.getAttribute('data-view'), active: document.activeElement.id }));
  rec('T2', 'real tap tab -> code', r.view === 'code' && r.active !== 'code', JSON.stringify(r));

  // T3 edit source -> render
  await page.fill('#code', SIMPLE);
  await page.waitForTimeout(600);
  r = await page.evaluate(() => ({
    rect: !!document.querySelector('#svgHost rect'),
    fill: (document.querySelector('#svgHost rect') || {}).getAttribute
      ? document.querySelector('#svgHost rect').getAttribute('fill') : null,
    count: document.getElementById('stCount').textContent,
    errHidden: document.getElementById('errBar').hidden
  }));
  rec('T3', 'edit -> render', r.rect && r.fill === '#ff0000' && r.count === '2' && r.errHidden, JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/phone-02-code.png' });

  // T3b modify attribute
  await page.fill('#code', SIMPLE.replace('#ff0000', '#0000ff'));
  await page.waitForTimeout(600);
  r = await page.evaluate(() => document.querySelector('#svgHost rect').getAttribute('fill'));
  rec('T3b', 'edit fill -> preview', r === '#0000ff', String(r));

  // T4 break source -> keep last render + err bar
  await page.fill('#code', SIMPLE.replace('</svg>', ''));
  await page.waitForTimeout(700);
  r = await page.evaluate(() => ({
    fill: document.querySelector('#svgHost rect').getAttribute('fill'),
    errHidden: document.getElementById('errBar').hidden,
    errText: document.getElementById('errBar').textContent,
    stValid: document.getElementById('stValid').textContent
  }));
  rec('T4', 'loose break -> keep render + err bar',
    r.fill === '#0000ff' && r.errHidden === false && /结构不完整/.test(r.errText) && /解析错误/.test(r.stValid),
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/phone-03-error.png' });

  // T4b total garbage
  await page.fill('#code', 'not svg at all');
  await page.waitForTimeout(700);
  r = await page.evaluate(() => ({
    hasSvg: !!document.querySelector('#svgHost svg'),
    errHidden: document.getElementById('errBar').hidden
  }));
  rec('T4b', 'garbage -> keep render + err bar', r.hasSvg && r.errHidden === false, JSON.stringify(r));

  // T4c recover
  await page.fill('#code', SIMPLE);
  await page.waitForTimeout(700);
  r = await page.evaluate(() => ({
    errHidden: document.getElementById('errBar').hidden,
    stValid: document.getElementById('stValid').textContent
  }));
  rec('T4c', 'recover -> err bar gone', r.errHidden === true && /有效/.test(r.stValid), JSON.stringify(r));

  // T5 back to preview (real tap) - the P0 lock-in path
  await page.click('#tab-preview');
  await page.waitForTimeout(400);
  r = await page.evaluate(() => document.body.getAttribute('data-view'));
  rec('T5', 'real tap tab -> back to preview', r === 'preview', String(r));

  // T6 zoom buttons
  const z0 = await page.textContent('#stZoom');
  await page.click('#zoomIn');
  await page.waitForTimeout(300);
  const z1 = await page.textContent('#stZoom');
  await page.click('#zoomOut');
  await page.waitForTimeout(300);
  const z2 = await page.textContent('#stZoom');
  await page.click('#zoomFit');
  await page.waitForTimeout(300);
  const z3 = await page.textContent('#stZoom');
  await page.click('#zoomVal');
  await page.waitForTimeout(300);
  const z4 = await page.textContent('#stZoom');
  rec('T6', 'zoom in/out/fit/1:1', z1 !== z0 && z2 !== z1 && z3 !== z2 && z4 === '100%',
    [z0, z1, z2, z3, z4].join(' -> '));

  // T7 background three states
  const bgs = [];
  for (const b of ['white', 'black', 'checker']) {
    await page.click(`.bg-btn[data-bg="${b}"]`);
    await page.waitForTimeout(250);
    bgs.push(await page.evaluate(() => ({
      attr: document.getElementById('viewport').getAttribute('data-bg'),
      img: getComputedStyle(document.getElementById('viewport')).backgroundImage.slice(0, 20),
      color: getComputedStyle(document.getElementById('viewport')).backgroundColor
    })));
  }
  rec('T7', 'bg three states',
    bgs[0].color === 'rgb(255, 255, 255)' && bgs[1].color === 'rgb(0, 0, 0)' && bgs[2].img.indexOf('linear-gradient') === 0,
    JSON.stringify(bgs));

  // T8 FAB export PNG
  const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await page.click('#btnPng');
  const d = await dl;
  rec('T8', 'export PNG (2x) download', !!d && /\.png$/.test(d.suggestedFilename()),
    d ? d.suggestedFilename() : 'no download event');
  await page.waitForTimeout(400);
  r = await page.textContent('#toast');
  rec('T8b', 'export PNG toast', /PNG/.test(r), r);

  // T9 save svg
  const dl2 = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await page.click('#btnSave');
  const d2 = await dl2;
  rec('T9', 'save svg download', !!d2 && /\.svg$/.test(d2.suggestedFilename()), d2 ? d2.suggestedFilename() : 'none');

  // T10 copy source (code view)
  await page.click('#tab-code');
  await page.waitForTimeout(400);
  await page.click('#btnCopy');
  await page.waitForTimeout(500);
  r = await page.textContent('#toast');
  rec('T10', 'copy source toast', /复制/.test(r), r);

  // T11 bridge contract
  r = await page.evaluate(() => {
    const a = window.SvgApp;
    if (!a) return { ok: false };
    return {
      ok: true,
      ready: a.ready,
      methods: ['onFilePicked', 'onBackPressed', 'requestOpen', 'savePng', 'saveSvg', 'toast']
        .filter(k => typeof a[k] === 'function'),
      backFromCode: (function () {
        document.body.setAttribute('data-view', 'code');
        return null;
      })()
    };
  });
  rec('T11', 'window.SvgApp bridge', r.ok && r.methods.length === 6 && r.ready === true, JSON.stringify(r));

  // T12 onBackPressed
  r = await page.evaluate(() => {
    const a = window.SvgApp;
    window.__out = [];
    // force into code view via the tab click path
    document.getElementById('tab-code').click();
    const consumed = a.onBackPressed();
    const v1 = document.body.getAttribute('data-view');
    const consumed2 = a.onBackPressed();
    return { consumed, v1, consumed2, v2: document.body.getAttribute('data-view') };
  });
  rec('T12', 'onBackPressed consumes code->preview then false',
    r.consumed === true && r.v1 === 'preview' && r.consumed2 === false && r.v2 === 'preview', JSON.stringify(r));

  // T13 onFilePicked (fallback path, no native)
  r = await page.evaluate(() => {
    const ok = window.SvgApp.onFilePicked(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#123456"/></svg>',
      'bridge-test.svg');
    return {
      ok,
      code: document.getElementById('code').value.indexOf('#123456') > -1,
      name: document.getElementById('fileName').value,
      dom: !!document.querySelector('#svgHost rect')
    };
  });
  rec('T13', 'onFilePicked loads + renders', r.ok && r.code && r.name === 'bridge-test.svg' && r.dom, JSON.stringify(r));

  // T14 setStatusBarHeight
  r = await page.evaluate(() => {
    window.SvgApp.setStatusBarHeight(24);
    const v = getComputedStyle(document.documentElement).getPropertyValue('--statusbar-h').trim();
    const h = document.querySelector('.appbar').getBoundingClientRect().height;
    window.SvgApp.setStatusBarHeight(0);
    return { v, h };
  });
  rec('T14', 'setStatusBarHeight affects appbar', r.v === '24px' && r.h > 70, JSON.stringify(r));

  // T15 touch targets >=44 (visible interactive). Measured with the code pane
  // active so nothing is sampled mid-transition; 43.9 absorbs float noise only.
  await page.click('#tab-code');
  await page.waitForTimeout(450);
  r = await page.evaluate(() => {
    const bad = [];
    const sels = 'button, input, [role="tab"], textarea, label.file-wrap';
    document.querySelectorAll(sels).forEach(e => {
      const rc = e.getBoundingClientRect();
      if (rc.width < 1 || rc.height < 1) return;
      if (e.classList.contains('sr-only')) return;
      if (e.id === 'fileInput') return;
      if (e.classList.contains('file-input')) return; // hot zone lives on the label
      if (rc.height < 43.9 || rc.width < 43.9) bad.push(e.tagName + (e.id ? '#' + e.id : '.' + e.className) + ' ' + rc.width.toFixed(2) + 'x' + rc.height.toFixed(2));
    });
    const fw = document.querySelector('.file-wrap').getBoundingClientRect();
    return { bad, fileWrap: fw.width.toFixed(2) + 'x' + fw.height.toFixed(2) };
  });
  rec('T15', 'touch targets >= 44px', r.bad.length === 0, JSON.stringify(r));
  await page.click('#tab-preview');
  await page.waitForTimeout(350);

  // T16 safe-area / dvh: body height equals viewport, no page scroll
  r = await page.evaluate(() => ({
    bodyH: Math.round(document.body.getBoundingClientRect().height),
    appH: getComputedStyle(document.documentElement).getPropertyValue('--app-h').trim(),
    scroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    tabbarVisible: (function () {
      const t = document.getElementById('tabbar');
      const cs = getComputedStyle(t);
      const rc = t.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && rc.height > 10;
    })(),
    tabbarPe: getComputedStyle(document.getElementById('tabbar')).pointerEvents,
    tabPe: getComputedStyle(document.getElementById('tab-preview')).pointerEvents
  }));
  rec('T16', 'no page scroll, app-h set, tabbar visible + tappable',
    r.scroll <= 0 && /px/.test(r.appH) && r.tabbarVisible && r.tabbarPe === 'auto' && r.tabPe === 'auto',
    JSON.stringify(r));

  // T17 XSS sanitize
  r = await page.evaluate(() => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">' +
      '<script>window.__pwned=1;<\/script>' +
      '<rect width="50" height="50" fill="red" onclick="window.__pwned=2" onload="window.__pwned=3" />' +
      '<a href="javascript:window.__pwned=4">x</a></svg>';
    window.SvgApp.setSource(evil, 'xss.svg');
    return {
      pwned: window.__pwned || 0,
      html: document.getElementById('svgHost').innerHTML
    };
  });
  await page.waitForTimeout(500);
  r.pwned = await page.evaluate(() => window.__pwned || 0);
  rec('T17', 'sanitize removes script/on*/javascript:',
    r.pwned === 0 && !/script/i.test(r.html) && !/onclick/i.test(r.html) && !/javascript:/i.test(r.html),
    'pwned=' + r.pwned + ' html=' + r.html.slice(0, 160));

  // T18 theme toggle
  await page.click('#btnTheme');
  await page.waitForTimeout(350);
  r = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    meta: document.querySelector('meta[name="theme-color"]').getAttribute('content')
  }));
  rec('T18', 'dark theme toggle', r.theme === 'dark' && r.meta === '#0D0E10', JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/phone-04-dark.png' });
  await page.click('#btnTheme');
  await page.waitForTimeout(300);

  // T19 localStorage restore
  await page.evaluate(() => {
    document.getElementById('code').value =
      '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><circle cx="45" cy="45" r="40" fill="#abcdef"/></svg>';
    document.getElementById('code').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForTimeout(800);
  r = await page.evaluate(() => ({
    code: document.getElementById('code').value.indexOf('#abcdef') > -1,
    toast: document.getElementById('toast').textContent,
    dom: !!document.querySelector('#svgHost circle')
  }));
  rec('T19', 'localStorage restore', r.code && r.dom && /恢复/.test(r.toast), JSON.stringify(r));

  // T20 insert template chip
  await page.evaluate(() => {
    window.SvgApp.setSource('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"></svg>', 't.svg');
  });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => document.getElementById('code').value.length);
  await page.evaluate(() => {
    const chips = document.querySelectorAll('#tplBar .chip');
    for (const c of chips) if (c.textContent === '圆') c.click();
  });
  await page.waitForTimeout(600);
  r = await page.evaluate(() => ({
    len: document.getElementById('code').value.length,
    hasCircle: document.getElementById('code').value.indexOf('<circle') > -1,
    dom: !!document.querySelector('#svgHost circle')
  }));
  rec('T20', 'insert template chip', r.len > before && r.hasCircle && r.dom, JSON.stringify(r));

  await ctx.close();

  /* ---------------- tablet 820x1180 ---------------- */
  currentVp = 'tablet820';
  ctx = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    isMobile: false,
    hasTouch: true,
    acceptDownloads: true
  });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(700);

  r = await page.evaluate(() => {
    const p = document.getElementById('pane-preview').getBoundingClientRect();
    const c = document.getElementById('pane-code').getBoundingClientRect();
    return {
      previewVisible: getComputedStyle(document.getElementById('pane-preview')).visibility,
      codeVisible: getComputedStyle(document.getElementById('pane-code')).visibility,
      pw: Math.round(p.width), cx: Math.round(c.x), cw: Math.round(c.width),
      ratio: +(p.width / 820).toFixed(2),
      tabbar: document.getElementById('tabbar').offsetParent !== null,
      tabPe: getComputedStyle(document.getElementById('tabbar')).pointerEvents
    };
  });
  rec('T21', 'tablet split preview left 55-60%',
    r.previewVisible === 'visible' && r.codeVisible === 'visible' && r.ratio >= 0.55 && r.ratio <= 0.62,
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/tablet-01.png' });

  // tablet: edit -> preview updates live
  await page.evaluate(() => {
    window.SvgApp.setSource('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect id="rr" width="100" height="100" fill="#00aa00"/></svg>', 'tb.svg');
  });
  await page.waitForTimeout(500);
  await page.fill('#code', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect id="rr" width="100" height="100" fill="#aa00aa"/></svg>');
  await page.waitForTimeout(700);
  r = await page.evaluate(() => ({
    fill: (document.querySelector('#svgHost rect') || { getAttribute: () => null }).getAttribute('fill'),
    prevVisible: getComputedStyle(document.getElementById('pane-preview')).visibility
  }));
  rec('T22', 'tablet live sync while preview docked', r.fill === '#aa00aa' && r.prevVisible === 'visible', JSON.stringify(r));

  // tablet: FAB still reachable
  r = await page.evaluate(() => {
    const f = document.getElementById('btnPng');
    const rc = f.getBoundingClientRect();
    const hit = document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2);
    return { ok: !!(hit && (hit === f || f.contains(hit))), pe: getComputedStyle(f).pointerEvents };
  });
  rec('T23', 'tablet FAB hittable', r.ok, JSON.stringify(r));

  const dl3 = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await page.click('#btnPng');
  const d3 = await dl3;
  rec('T24', 'tablet export PNG', !!d3, d3 ? d3.suggestedFilename() : 'none');

  await page.screenshot({ path: SHOTS + '/tablet-02.png' });
  await ctx.close();

  /* ---------------- native host simulation (SvgViewNative) ---------------- */
  currentVp = 'nativeMock';
  ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
  });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.addInitScript(() => {
    window.__calls = [];
    window.SvgViewNative = {
      toast: function (m) { window.__calls.push(['toast', String(m)]); },
      getAppVersion: function () { return '1.0.3'; },
      openFile: function () { window.__calls.push(['openFile']); },
      savePng: function (b64, name) {
        window.__calls.push(['savePng', String(b64).slice(0, 26), name]);
        return '/sdcard/Pictures/' + name;
      },
      keepScreenOn: function (on) { window.__calls.push(['keepScreenOn', !!on]); }
    };
  });
  await page.goto(URL_);
  await page.waitForTimeout(600);

  r = await page.evaluate(() => ({
    host: window.SvgApp.getHost(),
    version: window.SvgApp.getAppVersion(),
    hasBridge: !!(window.SvgViewBridge && typeof window.SvgViewBridge.onFilePicked === 'function'
      && typeof window.SvgViewBridge.onPickFailed === 'function')
  }));
  rec('T25', 'detects SvgViewNative + exposes SvgViewBridge',
    r.host === 'SvgViewNative' && r.version === '1.0.3' && r.hasBridge, JSON.stringify(r));

  await page.click('#btnOpen');
  await page.waitForTimeout(250);
  r = await page.evaluate(() => window.__calls.filter(c => c[0] === 'openFile').length);
  rec('T26', 'open button calls SvgViewNative.openFile()', r === 1, 'calls=' + r);

  // PNG export -> native savePng with data: prefix, path surfaced in toast
  await page.click('#btnPng');
  await page.waitForTimeout(1200);
  r = await page.evaluate(() => {
    const c = window.__calls.filter(x => x[0] === 'savePng')[0];
    return c ? { prefix: c[1].slice(0, 22), name: c[2] } : null;
  });
  rec('T27', 'export -> SvgViewNative.savePng(data-url, name)',
    !!r && r.prefix === 'data:image/png;base64,' && /\.png$/.test(r.name), JSON.stringify(r));
  r = await page.evaluate(() => window.__calls.filter(x => x[0] === 'toast').map(x => x[1]).slice(-2));
  rec('T28', 'native save path shown to user, no duplicate toast',
    r.some(m => /\/sdcard\/Pictures\//.test(m)) && !r.some(m => /已导出 PNG/.test(m)),
    JSON.stringify(r));

  // onFilePicked(name, base64) with UTF-8 Chinese content
  r = await page.evaluate(() => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">'
      + '<text x="10" y="36" font-size="20" fill="#5E6AD2">中文测试</text></svg>';
    const b64 = btoa(unescape(encodeURIComponent(svg)));
    const ok = window.SvgViewBridge.onFilePicked('导入测试.svg', b64);
    return {
      ok,
      name: document.getElementById('fileName').value,
      code: document.getElementById('code').value,
      dom: (document.querySelector('#svgHost text') || {}).textContent || ''
    };
  });
  rec('T29', 'SvgViewBridge.onFilePicked decodes UTF-8 base64',
    r.ok === true && r.name === '导入测试.svg' && r.code.indexOf('中文测试') > -1 && r.dom === '中文测试',
    JSON.stringify({ ok: r.ok, name: r.name, dom: r.dom }));

  r = await page.evaluate(() => {
    window.SvgViewBridge.onPickFailed('cancelled');
    return window.__calls.filter(x => x[0] === 'toast').map(x => x[1]).slice(-1)[0];
  });
  rec('T30', 'onPickFailed maps reason to Chinese toast', r === '已取消选择', String(r));

  // history-based back: entering code pushes an entry, back pops it
  r = await page.evaluate(() => {
    const out = {};
    out.start = history.length;
    document.getElementById('tab-code').click();
    out.view = document.body.getAttribute('data-view');
    out.state = history.state ? history.state.svgView : null;
    return out;
  });
  await page.waitForTimeout(350);
  await page.goBack();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => document.body.getAttribute('data-view'));
  rec('T31', 'history back pops code view -> preview',
    r.view === 'code' && r.state === 'code' && after === 'preview',
    JSON.stringify({ len: r.start, view: r.view, state: r.state, after }));

  await ctx.close();

  /* ================= v2 · new work ================= */
  const SVG_SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">'
    + '<rect x="20" y="20" width="280" height="280" fill="#5E6AD2"/></svg>';
  const SVG_WIDE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 120" width="1600" height="120">'
    + '<rect x="0" y="0" width="1600" height="120" fill="#0FA968"/></svg>';
  const SVG_TALL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 1600" width="120" height="1600">'
    + '<rect x="0" y="0" width="120" height="1600" fill="#DC6803"/></svg>';
  const SVG_TINY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">'
    + '<circle cx="20" cy="20" r="18" fill="#D92D20"/></svg>';
  const LONG_PATH = '/storage/emulated/0/Android/data/com.example.svgstudio/files/export/svg/2026/segment/that/never/ends/really';

  async function measureCenter(pg) {
    return await pg.evaluate(() => {
      const svg = document.querySelector('#svgHost svg');
      const vp = document.getElementById('viewport');
      const a = svg.getBoundingClientRect();
      const b = vp.getBoundingClientRect();
      return {
        dx: +((a.left + a.width / 2) - (b.left + b.width / 2)).toFixed(2),
        dy: +((a.top + a.height / 2) - (b.top + b.height / 2)).toFixed(2),
        k: +(window.SvgApp.getState().zoom).toFixed(4),
        w: Math.round(a.width), h: Math.round(a.height),
        vw: Math.round(b.width), vh: Math.round(b.height)
      };
    });
  }
  async function fitCase(pg, src) {
    await pg.evaluate(t => { window.SvgApp.setSource(t, 'fit.svg'); }, src);
    await pg.waitForTimeout(450);
    await pg.click('#zoomFit');
    await pg.waitForTimeout(350);
    return await measureCenter(pg);
  }

  /* ---------------- v2 A · hierarchy, phone light + dark ---------------- */
  currentVp = 'v2-phone';
  ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, acceptDownloads: true
  });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(700);

  r = await page.evaluate(() => {
    const g = (s, p) => getComputedStyle(document.querySelector(s))[p];
    return {
      appbarBg: g('.appbar', 'backgroundColor'),
      appbarBorder: g('.appbar', 'borderBottomColor'),
      appbarShadow: g('.appbar', 'boxShadow'),
      tabbarBg: g('.tabbar', 'backgroundColor'),
      tabbarBorder: g('.tabbar', 'borderTopColor'),
      tabbarShadow: g('.tabbar', 'boxShadow'),
      statusShadow: g('.statusbar', 'boxShadow'),
      paneBg: g('.pane-preview', 'backgroundColor'),
      headBg: g('.pane-head', 'backgroundColor'),
      bodyBg: g('body', 'backgroundColor')
    };
  });
  rec('V1', 'light: 3-level bg + strong divider + directional shadow',
    r.appbarBg === 'rgb(255, 255, 255)' && r.appbarBorder === 'rgb(208, 213, 221)' &&
    /16, 24, 40/.test(r.appbarShadow) && r.tabbarBorder === 'rgb(208, 213, 221)' &&
    /16, 24, 40/.test(r.tabbarShadow) && /16, 24, 40/.test(r.statusShadow) &&
    r.paneBg !== r.appbarBg && r.headBg !== r.appbarBg,
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v2-phone-light.png' });

  await page.click('#btnTheme');
  await page.waitForTimeout(350);
  r = await page.evaluate(() => {
    const g = (s, p) => getComputedStyle(document.querySelector(s))[p];
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      appbarBg: g('.appbar', 'backgroundColor'),
      appbarBorder: g('.appbar', 'borderBottomColor'),
      tabbarBorder: g('.tabbar', 'borderTopColor'),
      paneBg: g('.pane-preview', 'backgroundColor'),
      headBg: g('.pane-head', 'backgroundColor')
    };
  });
  rec('V1d', 'dark: hierarchy mirrored',
    r.theme === 'dark' && r.appbarBg === 'rgb(19, 20, 23)' &&
    r.appbarBorder === 'rgb(49, 52, 58)' && r.tabbarBorder === 'rgb(49, 52, 58)' &&
    r.paneBg !== r.appbarBg && r.headBg !== r.appbarBg,
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v2-phone-dark.png' });
  await page.click('#btnTheme');
  await page.waitForTimeout(300);

  /* ---------------- v2 B · fit centering ---------------- */
  for (const c of [['square', SVG_SQUARE], ['wide', SVG_WIDE], ['tall', SVG_TALL], ['tiny', SVG_TINY]]) {
    const m = await fitCase(page, c[1]);
    rec('V2-' + c[0], 'fit centres ' + c[0],
      Math.abs(m.dx) <= 2 && Math.abs(m.dy) <= 2, JSON.stringify(m));
  }
  await page.screenshot({ path: SHOTS + '/v2-fit-tall.png' });

  await page.click('#zoomVal');
  await page.waitForTimeout(320);
  let m = await measureCenter(page);
  rec('V2-reset', '1:1 reset also centres', Math.abs(m.dx) <= 2 && Math.abs(m.dy) <= 2, JSON.stringify(m));

  await page.evaluate(t => { window.SvgApp.setSource(t, 'fit.svg'); }, SVG_TALL);
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForTimeout(1000);
  m = await measureCenter(page);
  rec('V2-boot', 'fit on first load centres', Math.abs(m.dx) <= 2 && Math.abs(m.dy) <= 2, JSON.stringify(m));

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  await page.click('#zoomFit');
  await page.waitForTimeout(350);
  m = await measureCenter(page);
  rec('V2-rotate', 'fit after rotation centres', Math.abs(m.dx) <= 2 && Math.abs(m.dy) <= 2, JSON.stringify(m));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);

  /* ---------------- v2 C · rename affordance ---------------- */
  r = await page.evaluate(() => {
    const inp = document.getElementById('fileName');
    const wrap = document.getElementById('fileWrap');
    const cs = getComputedStyle(wrap);
    const is = getComputedStyle(inp);
    const rc = wrap.getBoundingClientRect();
    return {
      borderStyle: cs.borderTopStyle,
      borderColor: cs.borderTopColor,
      bg: cs.backgroundColor,
      w: Math.round(rc.width), h: Math.round(rc.height),
      pe: cs.pointerEvents,
      pencil: !!wrap.querySelector('.file-ico svg'),
      title: wrap.getAttribute('title'),
      aria: inp.getAttribute('aria-label'),
      fontSize: is.fontSize, fontWeight: is.fontWeight
    };
  });
  rec('V3', 'rename field looks editable (dashed + pencil + a11y + >=44px)',
    r.borderStyle === 'dashed' && r.pencil && r.title === '点击重命名' &&
    r.aria === '点击重命名' && r.h >= 44 && r.w >= 44 && r.pe !== 'none' &&
    parseFloat(r.fontSize) >= 14 && Number(r.fontWeight) >= 600,
    JSON.stringify(r));

  const dlr = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await page.click('#fileName');
  await page.fill('#fileName', 'renamed-doc');
  await page.press('#fileName', 'Enter');
  await page.waitForTimeout(300);
  await page.click('#btnPng');
  const dr = await dlr;
  rec('V3b', 'rename drives export filename',
    !!dr && dr.suggestedFilename() === 'renamed-doc.png',
    dr ? dr.suggestedFilename() : 'no download');

  /* ---------------- v2 D · settings sheet ---------------- */
  await page.click('#btnSettings');
  await page.waitForTimeout(450);
  r = await page.evaluate(() => {
    const root = document.getElementById('sheetRoot');
    const sh = document.getElementById('sheet');
    return {
      open: !root.hidden && root.classList.contains('is-on'),
      sheetTop: Math.round(sh.getBoundingClientRect().top),
      vh: window.innerHeight,
      grip: !!document.querySelector('#sheetGrip span'),
      sections: Array.from(document.querySelectorAll('.set-sec .set-h')).map(e => e.textContent),
      note: document.getElementById('pathNote').textContent,
      tone: document.getElementById('pathNote').getAttribute('data-tone'),
      ver: document.getElementById('aboutVer').textContent
    };
  });
  rec('V4a', 'sheet opens with 4 sections + grip + version',
    r.open && r.grip && r.sections.length === 4 &&
    /导出位置/.test(r.sections[0]) && /引导教程/.test(r.sections[1]) &&
    /外观/.test(r.sections[2]) && /关于/.test(r.sections[3]) && r.sheetTop < r.vh,
    JSON.stringify(r));
  rec('V4b', 'honest degrade note when host lacks setExportDir',
    /尚不支持自定义路径/.test(r.note) && r.tone === 'warn', r.note);
  await page.screenshot({ path: SHOTS + '/v2-sheet.png' });

  await page.click('#editSvgBtn');
  await page.waitForTimeout(250);
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
      stored: localStorage.getItem('svgview.exportDir.svg')
    };
  });
  rec('V4c', 'long path clipped, layout intact, persisted to localStorage',
    r.ellipsis === 'ellipsis' && r.overflow === 'hidden' && r.w <= r.bodyW &&
    r.scroll <= 1 && r.stored === LONG_PATH,
    JSON.stringify(r));

  await page.mouse.click(195, 40);
  await page.waitForTimeout(450);
  r = await page.evaluate(() => ({
    hidden: document.getElementById('sheetRoot').hidden,
    on: document.getElementById('sheetRoot').classList.contains('is-on')
  }));
  rec('V4d', 'close by tapping the mask', r.hidden === true && !r.on, JSON.stringify(r));

  await page.click('#btnSettings');
  await page.waitForTimeout(450);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  r = await page.evaluate(() => document.getElementById('sheetRoot').hidden);
  rec('V4e', 'close by Esc', r === true, String(r));

  await page.click('#btnSettings');
  await page.waitForTimeout(450);
  const gripBox = await (await page.$('#sheetGrip')).boundingBox();
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2 + 70, { steps: 6 });
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2 + 180, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  r = await page.evaluate(() => document.getElementById('sheetRoot').hidden);
  rec('V4f', 'close by dragging the grip down', r === true, String(r));

  await ctx.close();

  /* ---------------- v2 E · onboarding (fresh profile) ---------------- */
  currentVp = 'v2-onboard';
  ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
  });
  page = await ctx.newPage();
  wire(page, currentVp);
  await page.goto(URL_);
  await page.waitForTimeout(1300);

  r = await page.evaluate(() => ({
    hidden: document.getElementById('tour').hidden,
    on: document.getElementById('tour').classList.contains('is-on'),
    step: document.getElementById('tourStep').textContent,
    title: document.getElementById('tourTitle').textContent,
    holeW: Math.round(document.getElementById('tourHole').getBoundingClientRect().width)
  }));
  rec('V5a', 'first run auto-starts the coach marks',
    !r.hidden && r.on && r.step === '1/5' && r.holeW > 10, JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v2-tour-1.png' });

  r = await page.evaluate(() => {
    const h = document.getElementById('tourHole').getBoundingClientRect();
    const b = document.getElementById('btnSettings').getBoundingClientRect();
    return {
      dx: Math.round(Math.abs((h.left + h.width / 2) - (b.left + b.width / 2))),
      dy: Math.round(Math.abs((h.top + h.height / 2) - (b.top + b.height / 2)))
    };
  });
  rec('V5b', 'highlight box hugs the real element', r.dx <= 1 && r.dy <= 1, JSON.stringify(r));

  const walk = [];
  for (let i = 0; i < 5; i++) {
    walk.push(await page.evaluate(() => ({
      s: document.getElementById('tourStep').textContent,
      t: document.getElementById('tourTitle').textContent,
      next: document.getElementById('tourNext').textContent,
      holeW: Math.round(document.getElementById('tourHole').getBoundingClientRect().width)
    })));
    await page.screenshot({ path: SHOTS + '/v2-tour-' + (i + 1) + '.png' });
    await page.click('#tourNext');
    await page.waitForTimeout(340);
  }
  rec('V5c', '5 steps, last CTA is 开始使用',
    walk.length === 5 && walk[0].s === '1/5' && walk[4].s === '5/5' &&
    walk[4].next === '开始使用' && walk.every(x => x.holeW > 10),
    JSON.stringify(walk.map(x => x.s + ' ' + x.t)));

  await page.waitForTimeout(500);
  r = await page.evaluate(() => ({
    hidden: document.getElementById('tour').hidden,
    flag: localStorage.getItem('svgview.onboarded')
  }));
  rec('V5d', 'finishing persists the flag and hides the overlay',
    r.hidden === true && r.flag === '1', JSON.stringify(r));

  await page.reload();
  await page.waitForTimeout(1500);
  r = await page.evaluate(() => document.getElementById('tour').hidden);
  rec('V5e', 'no auto tour on the second run', r === true, String(r));

  await page.click('#btnSettings');
  await page.waitForTimeout(450);
  await page.click('#btnReplayTour');
  await page.waitForTimeout(800);
  r = await page.evaluate(() => ({
    hidden: document.getElementById('tour').hidden,
    on: document.getElementById('tour').classList.contains('is-on'),
    s: document.getElementById('tourStep').textContent
  }));
  rec('V5f', 'settings can replay the tour', !r.hidden && r.on && r.s === '1/5', JSON.stringify(r));

  await page.click('#tourSkip');
  await page.waitForTimeout(500);
  r = await page.evaluate(() => document.getElementById('tour').hidden);
  rec('V5g', 'skip closes the tour any time', r === true, String(r));

  await ctx.close();

  /* ---------------- v2 F · rename hint, one shot ---------------- */
  currentVp = 'v2-hint';
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  wire(page, currentVp);
  await page.addInitScript(() => {
    try { localStorage.setItem('svgview.onboarded', '1'); } catch (e) { /* ignore */ }
  });
  await page.goto(URL_);
  await page.waitForTimeout(1600);
  r = await page.evaluate(() => ({
    on: document.getElementById('hintBubble').classList.contains('is-on'),
    text: document.getElementById('hintBubble').textContent,
    flag: localStorage.getItem('svgview.hint.rename')
  }));
  rec('V7a', 'rename hint shows once on first entry',
    r.on === true && /重命名/.test(r.text) && r.flag === '1', JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v2-hint.png' });
  await page.waitForTimeout(3800);
  r = await page.evaluate(() => document.getElementById('hintBubble').classList.contains('is-on'));
  rec('V7b', 'hint auto-dismisses', r === false, String(r));
  await page.reload();
  await page.waitForTimeout(1600);
  r = await page.evaluate(() => document.getElementById('hintBubble').classList.contains('is-on'));
  rec('V7c', 'hint never returns', r === false, String(r));

  await ctx.close();

  /* ---------------- v2 G · host WITH setExportDir ---------------- */
  currentVp = 'v2-native-dir';
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.addInitScript(() => {
    window.SvgViewNative = {
      toast: function () { },
      getExportDir: function (t) { return '/mock/' + t; },
      setExportDir: function (t, p) { return p; }
    };
  });
  await page.goto(URL_);
  await page.waitForTimeout(700);
  await page.click('#btnSettings');
  await page.waitForTimeout(450);
  r = await page.evaluate(() => ({
    svg: document.getElementById('pathSvg').textContent,
    png: document.getElementById('pathPng').textContent,
    note: document.getElementById('pathNote').textContent,
    tone: document.getElementById('pathNote').getAttribute('data-tone')
  }));
  rec('V6a', 'host with getExportDir is honored, no warn note',
    r.svg === '/mock/svg' && r.png === '/mock/png' && !/尚不支持/.test(r.note) && r.tone === null,
    JSON.stringify(r));
  await ctx.close();

  /* ---------------- v2 H · tablet hierarchy + fit ---------------- */
  currentVp = 'v2-tablet';
  ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(800);
  for (const c of [['square', SVG_SQUARE], ['wide', SVG_WIDE], ['tall', SVG_TALL]]) {
    const mm = await fitCase(page, c[1]);
    rec('V8-' + c[0], 'tablet fit centres ' + c[0],
      Math.abs(mm.dx) <= 2 && Math.abs(mm.dy) <= 2, JSON.stringify(mm));
  }
  await page.screenshot({ path: SHOTS + '/v2-tablet-light.png' });
  await page.click('#btnTheme');
  await page.waitForTimeout(350);
  await page.screenshot({ path: SHOTS + '/v2-tablet-dark.png' });
  await ctx.close();

  /* ================================================================
     v3 · round-3 UI closeout
     W1/W2  title restored on phones + app-bar hot zones
     W3-W6  code editor horizontal scroll affordance + editor fills pane
     W5     status strip thinned (no two equal bars at the bottom)
     W7     dark mode still correct
     W8     360px: two-row bar still fits
     W9/W10 tablet: single row + same scroll affordance
     ================================================================ */

  /* ---------------- v3 A · phone 390 light ---------------- */
  currentVp = 'v3-phone';
  ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, acceptDownloads: true
  });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(700);

  r = await page.evaluate(() => {
    const brand = document.querySelector('.brand-name');
    const b = brand.getBoundingClientRect();
    const cs = getComputedStyle(brand);
    const wrap = brand.parentNode;
    return {
      text: brand.textContent,
      w: Math.round(b.width), h: Math.round(b.height),
      display: cs.display, vis: cs.visibility,
      clipped: wrap.scrollWidth - wrap.clientWidth
    };
  });
  rec('W1', '390px: "SVG Studio" title is rendered again',
    r.w > 40 && r.h > 10 && r.display !== 'none' && r.vis !== 'hidden' &&
    r.clipped <= 0 && r.text === 'SVG Studio',
    JSON.stringify(r));

  r = await page.evaluate(() => {
    const nodes = [document.getElementById('btnSettings'), document.querySelector('.file-wrap')]
      .concat(Array.prototype.slice.call(document.querySelectorAll('#tools .icon-btn')));
    const rects = nodes.map(e => {
      const b = e.getBoundingClientRect();
      return { id: e.id || e.className, l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
    });
    let minW = Infinity, minH = Infinity;
    const overlaps = [];
    for (const q of rects) { minW = Math.min(minW, q.w); minH = Math.min(minH, q.h); }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], c = rects[j];
        const ox = Math.min(a.r, c.r) - Math.max(a.l, c.l);
        const oy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
        if (ox > 0.5 && oy > 0.5) { overlaps.push(a.id + '~' + c.id); }
      }
    }
    const bar = document.querySelector('.appbar');
    return {
      minW: Math.round(minW * 10) / 10, minH: Math.round(minH * 10) / 10, overlaps,
      barH: Math.round(bar.getBoundingClientRect().height),
      barScroll: bar.scrollWidth - bar.clientWidth
    };
  });
  rec('W2', '390px: app bar hot zones >=44px, pairwise non-overlapping, no overflow',
    r.minW >= 43.9 && r.minH >= 43.9 && r.overlaps.length === 0 && r.barScroll <= 0,
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v3-phone-light.png' });

  await page.click('#tab-code');
  await page.waitForTimeout(500);
  r = await page.evaluate(() => {
    const ta = document.getElementById('code');
    const pane = document.getElementById('pane-code').getBoundingClientRect();
    const b = ta.getBoundingClientRect();
    return {
      sw: ta.scrollWidth, cw: ta.clientWidth,
      canRight: document.getElementById('codeScroll').classList.contains('can-right'),
      gapToPane: Math.round((pane.bottom - b.bottom) * 10) / 10,
      statusH: Math.round(document.querySelector('.statusbar').getBoundingClientRect().height),
      tabH: Math.round(document.querySelector('.tabbar').getBoundingClientRect().height)
    };
  });
  rec('W3', 'long lines stay single-line and raise an explicit right cue',
    r.sw > r.cw && r.canRight === true, 'scrollWidth=' + r.sw + ' clientWidth=' + r.cw + ' canRight=' + r.canRight);
  rec('W4', 'code editor fills the pane to the bottom (no blank band)',
    Math.abs(r.gapToPane) <= 1, 'gap=' + r.gapToPane + 'px');
  rec('W5', 'status strip thinned, clearly shorter than the tab bar',
    r.statusH <= 24 && r.tabH - r.statusH >= 20, 'status=' + r.statusH + ' tab=' + r.tabH);
  await page.screenshot({ path: SHOTS + '/v3-phone-code.png' });

  await page.evaluate(() => {
    const ta = document.getElementById('code');
    ta.scrollLeft = ta.scrollWidth;
    ta.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(300);
  r = await page.evaluate(() => {
    const box = document.getElementById('codeScroll');
    return {
      canRight: box.classList.contains('can-right'),
      canLeft: box.classList.contains('can-left'),
      fadeOp: getComputedStyle(box.querySelector('.code-fade-right')).opacity,
      leftOp: getComputedStyle(box.querySelector('.code-fade-left')).opacity
    };
  });
  rec('W6', 'scrolled to the end: right fade hides, left fade shows',
    r.canRight === false && r.canLeft === true && parseFloat(r.fadeOp) < 0.05 && parseFloat(r.leftOp) > 0.9,
    JSON.stringify(r));

  await page.click('#tab-preview');
  await page.waitForTimeout(300);
  await page.click('#btnTheme');
  await page.waitForTimeout(350);
  r = await page.evaluate(() => {
    const b = document.querySelector('.brand-name').getBoundingClientRect();
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      w: Math.round(b.width),
      statusH: Math.round(document.querySelector('.statusbar').getBoundingClientRect().height)
    };
  });
  rec('W7', 'dark: title still visible, status strip still thin',
    r.theme === 'dark' && r.w > 40 && r.statusH <= 24, JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v3-phone-dark.png' });
  await ctx.close();

  /* ---------------- v3 B · phone 360, worst case width ---------------- */
  currentVp = 'v3-phone360';
  ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(700);
  r = await page.evaluate(() => {
    const bar = document.querySelector('.appbar');
    const brand = document.querySelector('.brand-name').getBoundingClientRect();
    const nodes = [document.getElementById('btnSettings'), document.querySelector('.file-wrap')]
      .concat(Array.prototype.slice.call(document.querySelectorAll('#tools .icon-btn')));
    let minW = Infinity, minH = Infinity;
    nodes.forEach(e => { const b = e.getBoundingClientRect(); minW = Math.min(minW, b.width); minH = Math.min(minH, b.height); });
    return {
      barScroll: bar.scrollWidth - bar.clientWidth,
      brandW: Math.round(brand.width),
      minW: Math.round(minW * 10) / 10, minH: Math.round(minH * 10) / 10,
      pageScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  rec('W8', '360px: two-row bar fits, title visible, hot zones intact',
    r.barScroll <= 0 && r.brandW > 40 && r.minW >= 43.9 && r.minH >= 43.9 && r.pageScrollX <= 0,
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v3-phone360.png' });
  await ctx.close();

  /* ---------------- v3 C · tablet keeps one row + gets the cue ---------------- */
  currentVp = 'v3-tablet';
  ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const ta = document.getElementById('code');
    ta.value = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">\n' +
      '  <rect x="10" y="10" width="380" height="280" rx="14" fill="#F4F5F7" stroke="#5E6AD2" stroke-width="2.5" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" />\n' +
      '</svg>';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  r = await page.evaluate(() => {
    const bar = document.querySelector('.appbar');
    const ta = document.getElementById('code');
    const brand = document.querySelector('.brand-name').getBoundingClientRect();
    return {
      dir: getComputedStyle(bar).flexDirection,
      barH: Math.round(bar.getBoundingClientRect().height),
      brandW: Math.round(brand.width),
      sw: ta.scrollWidth, cw: ta.clientWidth,
      canRight: document.getElementById('codeScroll').classList.contains('can-right'),
      statusH: Math.round(document.querySelector('.statusbar').getBoundingClientRect().height)
    };
  });
  rec('W9', 'tablet: single-row bar kept, title visible, status strip normal height',
    r.dir === 'row' && r.barH <= 60 && r.brandW > 40 && r.statusH <= 34, JSON.stringify(r));
  rec('W10', 'tablet: same horizontal scroll cue as the phone',
    r.sw > r.cw && r.canRight === true, 'scrollWidth=' + r.sw + ' clientWidth=' + r.cw);
  await page.screenshot({ path: SHOTS + '/v3-tablet-light.png' });
  await ctx.close();

  /* ================================================================
     v4 · round-4
     X1/X2   one-tap clear + undo restores
     X3      multi-step undo walks back one burst at a time
     X4      empty history -> disabled + aria-disabled
     X5/X6   Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / buttons
     X7-X12  six syntax-problem classes, line+column hardcoded
     X13     broken source keeps the last render + located message
     X14     "下一处" cycles between problems
     X15/X16 font audit (Android text inflation / CJK stack / fractional px)
     ================================================================ */

  /* ---------------- v4 A · phone: clear / undo / redo ---------------- */
  currentVp = 'v4-phone';
  ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, acceptDownloads: true
  });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(700);

  await page.evaluate(t => { window.SvgApp.setSource(t, 'v4.svg'); }, SIMPLE);
  await page.waitForTimeout(500);
  await page.click('#tab-code');
  await page.waitForTimeout(450);
  const beforeClear = await page.evaluate(() => document.getElementById('code').value);
  await page.screenshot({ path: SHOTS + '/v4-01-code-toolbar.png' });

  // X1 clear
  await page.click('#btnClear');
  await page.waitForTimeout(500);
  r = await page.evaluate(() => ({
    val: document.getElementById('code').value,
    chars: document.getElementById('metaChars').textContent,
    toast: document.getElementById('toast').textContent,
    toastOn: document.getElementById('toast').classList.contains('is-on'),
    errHidden: document.getElementById('errBar').hidden,
    errText: document.getElementById('errBar').textContent,
    stillRendered: !!document.querySelector('#svgHost svg'),
    clearDisabled: document.getElementById('btnClear').disabled
  }));
  rec('X1', 'clear: editor empty, toast offers undo, last render kept (no white screen)',
    r.val === '' && /^0 字符/.test(r.chars) && /撤销/.test(r.toast) && r.toastOn === true &&
    r.errHidden === false && /源码为空/.test(r.errText) && r.stillRendered === true &&
    r.clearDisabled === true,
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v4-02-cleared.png' });

  // X2 undo restores it verbatim
  await page.click('#btnUndo');
  await page.waitForTimeout(600);
  r = await page.evaluate(() => ({
    val: document.getElementById('code').value,
    errHidden: document.getElementById('errBar').hidden,
    stValid: document.getElementById('stValid').textContent,
    dom: !!document.querySelector('#svgHost rect'),
    count: document.getElementById('stCount').textContent
  }));
  rec('X2', 'undo after clear restores the source verbatim and re-renders',
    r.val === beforeClear && r.errHidden === true && /有效/.test(r.stValid) &&
    r.dom === true && r.count === '2',
    JSON.stringify({ same: r.val === beforeClear, errHidden: r.errHidden, stValid: r.stValid, count: r.count }));

  // X3 multi-step undo, one burst per pause
  await page.evaluate(() => {
    window.SvgApp.setSource('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', 'u.svg');
  });
  await page.waitForTimeout(520);
  const v0 = await page.evaluate(() => document.getElementById('code').value);
  const seq = [];
  for (const tag of ['A', 'B', 'C']) {
    await page.evaluate(t => {
      const ta = document.getElementById('code');
      ta.value = ta.value.replace('</svg>', '<!--' + t + '-->\n</svg>');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, tag);
    await page.waitForTimeout(520);   // > DEBOUNCE_CODE: closes the burst
    seq.push(await page.evaluate(() => document.getElementById('code').value));
  }
  const undos = [];
  for (let i = 0; i < 3; i++) {
    undos.push(await page.evaluate(() => {
      window.SvgApp.undo();
      return document.getElementById('code').value;
    }));
    await page.waitForTimeout(420);
  }
  rec('X3', 'multi-step undo walks back one burst at a time',
    undos[0] === seq[1] && undos[1] === seq[0] && undos[2] === v0,
    JSON.stringify({ v0: v0.length, seq: seq.map(s => s.length), undo: undos.map(s => s.length) }));

  // X5 Ctrl+Z
  await page.evaluate(() => {
    const ta = document.getElementById('code');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  await page.keyboard.type('<!--K-->');
  await page.waitForTimeout(520);
  const withK = await page.evaluate(() => document.getElementById('code').value);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const afterZ = await page.evaluate(() => document.getElementById('code').value);
  rec('X5', 'Ctrl+Z undoes the last typing burst',
    withK.indexOf('<!--K-->') > -1 && afterZ.indexOf('<!--K-->') === -1 &&
    afterZ.length === withK.length - '<!--K-->'.length,
    JSON.stringify({ withK: withK.length, afterZ: afterZ.length }));

  // X6 redo: keyboard then button
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(480);
  const afterRedoK = await page.evaluate(() => document.getElementById('code').value);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(480);
  await page.click('#btnRedo');
  await page.waitForTimeout(480);
  const afterRedoBtn = await page.evaluate(() => document.getElementById('code').value);
  rec('X6', 'redo works from Ctrl+Shift+Z and from the button',
    afterRedoK === withK && afterRedoBtn === withK,
    JSON.stringify({ kb: afterRedoK.length, btn: afterRedoBtn.length, want: withK.length }));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);

  // X16a toolbar geometry on the phone
  r = await page.evaluate(() => {
    const head = document.querySelector('.pane-head');
    const btns = Array.prototype.slice.call(head.querySelectorAll('.mini-btn'));
    let minW = Infinity, minH = Infinity;
    btns.forEach(b => {
      const rc = b.getBoundingClientRect();
      minW = Math.min(minW, rc.width); minH = Math.min(minH, rc.height);
    });
    const meta = document.querySelector('.meta');
    return {
      coarse: window.matchMedia('(pointer: coarse)').matches,
      n: btns.length, minW: Math.round(minW * 10) / 10, minH: Math.round(minH * 10) / 10,
      headScroll: head.scrollWidth - head.clientWidth,
      metaClipped: meta.scrollWidth - meta.clientWidth,
      metaText: meta.textContent.trim(),
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  rec('X16a', 'editor action row: 5 targets >=44px, no overflow, caption uncut at 390px',
    r.n === 5 && r.minW >= 43.9 && r.minH >= 43.9 && r.headScroll <= 0 &&
    r.metaClipped === 0 && r.pageScroll <= 0,
    JSON.stringify(r));

  /* ---------------- v4 B · syntax scanner ---------------- */
  const L1 = // unclosed tag
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n' +
    '  <rect x="10" y="10" width="40" height="40" fill="#ff0000">\n';
  const L2 = // closing tag does not match the open tag
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n' +
    '  <g>\n' +
    '  <rect x="1" y="1" width="10" height="10" fill="#000"/>\n' +
    '  </circle>\n' +
    '</svg>';
  const L3 = // value with no opening quote
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n' +
    '  <rect x="1" y="1" width="10" height="10" fill=#ff0000" />\n' +
    '</svg>';
  const L3b = // quote never closed
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n' +
    '  <rect x="1" y="1" width="10" height="10" fill="#ff0000 />\n' +
    '</svg>';
  const L4 = // stray > in text
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n' +
    '  <text x="4" y="20" font-size="12">a > b</text>\n' +
    '</svg>';
  const L4b = // stray < in text
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n' +
    '  <text x="4" y="20">a < b</text>\n' +
    '</svg>';
  const L5 = // no <svg> root at all
    '<rect x="1" y="1" width="10" height="10" fill="#000"/>\n';
  const L6 = // duplicate id
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n' +
    '  <rect id="dup" x="1" y="1" width="10" height="10"/>\n' +
    '  <circle id="dup" cx="50" cy="50" r="10"/>\n' +
    '</svg>';

  const LINT_CASES = [
    { id: 'X7', name: 'unclosed tag', src: L1, line: 2, col: 3, re: /^<rect>.*未闭合$/ },
    { id: 'X8', name: 'mismatched close', src: L2, line: 4, col: 3, re: /不匹配/ },
    { id: 'X9', name: 'missing quote', src: L3, line: 2, col: 44, re: /缺少引号/ },
    { id: 'X9b', name: 'unterminated quote', src: L3b, line: 2, col: 44, re: /引号未闭合/ },
    { id: 'X10', name: 'stray >', src: L4, line: 2, col: 39, re: /多余的 > 符号/ },
    { id: 'X10b', name: 'stray <', src: L4b, line: 2, col: 24, re: /多余的 < 符号/ },
    { id: 'X11', name: 'missing <svg> root', src: L5, line: 1, col: 1, re: /缺少 <svg> 根元素/ },
    { id: 'X12', name: 'duplicate id', src: L6, line: 3, col: 11, re: /重复定义/ }
  ];
  for (const c of LINT_CASES) {
    r = await page.evaluate(t => window.SvgApp.checkSyntax(t), c.src);
    const f = r[0] || {};
    rec(c.id, 'lint · ' + c.name + ' reports ' + c.line + ':' + c.col,
      f.line === c.line && f.col === c.col && c.re.test(String(f.msg || '')),
      'got ' + JSON.stringify(f) + ' want line=' + c.line + ' col=' + c.col + ' re=' + c.re);
  }

  // clean sources must NOT raise anything (no false positives)
  const CLEAN = [[SIMPLE, 'SIMPLE'], [SVG_SQUARE, 'SVG_SQUARE'], [SVG_WIDE, 'SVG_WIDE'],
  [SVG_TALL, 'SVG_TALL'], [SVG_TINY, 'SVG_TINY']];
  let cleanBad = [];
  for (const cc of CLEAN) {
    const got = await page.evaluate(t => window.SvgApp.checkSyntax(t), cc[0]);
    if (got.length) { cleanBad.push(cc[1] + ' -> ' + JSON.stringify(got[0])); }
  }
  rec('X12b', 'valid sources produce zero findings (no false positives)',
    cleanBad.length === 0, cleanBad.join(' | ') || 'clean');

  // duplicate id parses fine -> renders, but the bar warns (amber) with a location
  await page.evaluate(t => { window.SvgApp.setSource(t, 'dup.svg'); }, L6);
  await page.waitForTimeout(700);
  r = await page.evaluate(() => ({
    errHidden: document.getElementById('errBar').hidden,
    tone: document.getElementById('errBar').getAttribute('data-tone'),
    errText: document.getElementById('errBar').textContent,
    stillRendered: !!document.querySelector('#svgHost circle'),
    lint: window.SvgApp.getLint().length,
    nextHidden: document.getElementById('errNext').hidden
  }));
  rec('X12c', 'duplicate id: still renders, amber warning carries the location',
    r.errHidden === false && r.tone === 'warn' && /第 3 行第 11 列/.test(r.errText) &&
    r.stillRendered === true && r.lint === 1 && r.nextHidden === true, JSON.stringify(r));

  /* ---------------- v4 C · broken source keeps the render + jump ---------------- */
  await page.evaluate(t => {
    const ta = document.getElementById('code');
    ta.value = t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, L2);
  await page.waitForTimeout(800);
  r = await page.evaluate(() => ({
    errHidden: document.getElementById('errBar').hidden,
    errText: document.getElementById('errBar').textContent,
    stillRendered: !!document.querySelector('#svgHost svg'),
    stValid: document.getElementById('stValid').textContent,
    lintCount: window.SvgApp.getLint().length,
    nextHidden: document.getElementById('errNext').hidden
  }));
  rec('X13', 'broken source: last render kept, bar shows 第 4 行第 3 列',
    r.errHidden === false && r.stillRendered === true && /结构不完整/.test(r.errText) &&
    /第 4 行第 3 列/.test(r.errText) && /解析错误/.test(r.stValid) && r.lintCount === 2 &&
    r.nextHidden === false,
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v4-03-syntax-error.png' });

  // tap the bar -> caret lands on the offending range
  await page.click('#errBar');
  await page.waitForTimeout(320);
  r = await page.evaluate(() => {
    const ta = document.getElementById('code');
    const l = window.SvgApp.getLint()[0];
    return {
      s: ta.selectionStart, e: ta.selectionEnd,
      start: l.start, end: l.end,
      sel: ta.value.substring(ta.selectionStart, ta.selectionEnd)
    };
  });
  rec('X13b', 'tapping the message moves the selection onto the bad range',
    r.s === r.start && r.e === r.end && r.sel === '</circle>', JSON.stringify(r));

  // X14 "下一处" cycles
  await page.click('#errNext');
  await page.waitForTimeout(320);
  r = await page.evaluate(() => {
    const ta = document.getElementById('code');
    const l = window.SvgApp.getLint()[1];
    return {
      idx: window.SvgApp.getLint().length,
      s: ta.selectionStart, e: ta.selectionEnd, start: l.start, end: l.end,
      sel: ta.value.substring(ta.selectionStart, ta.selectionEnd),
      text: document.getElementById('errText').textContent
    };
  });
  rec('X14', '“下一处” cycles to the second problem',
    r.s === r.start && r.e === r.end && r.sel === '</svg>' && /2\/2/.test(r.text),
    JSON.stringify(r));

  // recover -> bar gone
  await page.evaluate(t => { window.SvgApp.setSource(t, 'ok.svg'); }, SIMPLE);
  await page.waitForTimeout(700);
  r = await page.evaluate(() => ({
    errHidden: document.getElementById('errBar').hidden,
    stValid: document.getElementById('stValid').textContent
  }));
  rec('X14b', 'recovering hides the bar again', r.errHidden === true && /有效/.test(r.stValid), JSON.stringify(r));

  /* ---------------- v4 D · font audit ---------------- */
  r = await page.evaluate(() => {
    const css = Array.prototype.map.call(document.querySelectorAll('style'), s => s.textContent).join('\n');
    const bad = [];
    document.querySelectorAll('body *').forEach(el => {
      if (!el.textContent || !el.textContent.trim()) return;
      const rc = el.getBoundingClientRect();
      if (rc.width < 1 || rc.height < 1) return;
      const st = getComputedStyle(el);
      const fs = parseFloat(st.fontSize);
      const lh = parseFloat(st.lineHeight);
      if (isFinite(fs) && Math.abs(fs - Math.round(fs)) > 0.001) {
        bad.push('font-size ' + (el.id || el.className) + '=' + st.fontSize);
      }
      if (isFinite(lh) && lh > 0 && Math.abs(lh - Math.round(lh)) > 0.001) {
        bad.push('line-height ' + (el.id || el.className) + '=' + st.lineHeight);
      }
      // any persistent non-integer scale on a text box would blur the glyphs
      const tr = st.transform;
      if (tr && tr !== 'none' && /matrix/.test(tr)) {
        const m = tr.match(/matrix\(([^)]+)\)/);
        if (m) {
          const parts = m[1].split(',').map(Number);
          const sx = parts[0], sy = parts[3];
          if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
            bad.push('transform-scale ' + (el.id || el.className) + '=' + sx + ',' + sy);
          }
        }
      }
    });
    const svgText = document.querySelector('#svgHost svg text');
    return {
      adjustRules: (css.match(/-webkit-text-size-adjust:\s*100%/g) || []).length,
      vpMeta: document.querySelector('meta[name="viewport"]').content,
      sans: getComputedStyle(document.body).fontFamily,
      mono: getComputedStyle(document.getElementById('code')).fontFamily,
      svgTextFont: svgText ? svgText.getAttribute('font-family') : null,
      bad: bad
    };
  });
  rec('X15', 'font audit: adjust pinned, integer px sizes, CJK + mono fallbacks, no stray scale',
    r.adjustRules >= 3 && /width=device-width/.test(r.vpMeta) && r.bad.length === 0 &&
    /PingFang SC/.test(r.sans) && /Microsoft YaHei/.test(r.sans) &&
    /Noto Sans CJK SC/.test(r.sans) && /sans-serif/.test(r.sans) &&
    /Droid Sans Mono/.test(r.mono) && /monospace/.test(r.mono) &&
    (!r.svgTextFont || /^(sans-serif|serif|monospace)$/.test(r.svgTextFont)),
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v4-05-phone-font.png' });
  await ctx.close();

  /* ---------------- v4 E · tablet font + toolbar ---------------- */
  currentVp = 'v4-tablet';
  ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(800);
  r = await page.evaluate(() => {
    const head = document.querySelector('.pane-head');
    const meta = document.querySelector('.meta');
    return {
      headScroll: head.scrollWidth - head.clientWidth,
      metaClipped: meta.scrollWidth - meta.clientWidth,
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      statusH: Math.round(document.querySelector('.statusbar').getBoundingClientRect().height),
      headH: Math.round(head.getBoundingClientRect().height)
    };
  });
  rec('X16b', 'tablet: docked pane fits the action row, caption gets its own row',
    r.headScroll <= 0 && r.metaClipped === 0 && r.pageScroll <= 0, JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v4-06-tablet-font.png' });
  await ctx.close();

  /* ---------------- v4 F · fresh profile: empty history ---------------- */
  currentVp = 'v4-fresh';
  ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
  });
  page = await ctx.newPage();
  wire(page, currentVp);
  await seedSeen(page);
  await page.goto(URL_);
  await page.waitForTimeout(800);
  await page.click('#tab-code');
  await page.waitForTimeout(450);
  r = await page.evaluate(() => {
    const u = document.getElementById('btnUndo');
    const rd = document.getElementById('btnRedo');
    const ur = u.getBoundingClientRect();
    return {
      undoDisabled: u.disabled, undoAria: u.getAttribute('aria-disabled'),
      redoDisabled: rd.disabled, redoAria: rd.getAttribute('aria-disabled'),
      undoDepth: window.SvgApp.getUndoDepth(),
      redoDepth: window.SvgApp.getRedoDepth(),
      uw: Math.round(ur.width * 10) / 10, uh: Math.round(ur.height * 10) / 10
    };
  });
  rec('X4', 'no history at boot -> undo/redo disabled + aria-disabled, still a 44px target',
    r.undoDisabled === true && r.undoAria === 'true' && r.redoDisabled === true &&
    r.redoAria === 'true' && r.undoDepth === 0 && r.redoDepth === 0 &&
    r.uw >= 43.9 && r.uh >= 43.9,
    JSON.stringify(r));
  await page.screenshot({ path: SHOTS + '/v4-04-undo-disabled.png' });

  // version bump (v5: aligned with the APK manifest versionName)
  r = await page.evaluate(() => window.SvgApp.version);
  rec('X17', 'SvgApp.version is 1.2.0', r === '1.2.0', String(r));
  await ctx.close();

  await browser.close();

  /* ---------------- summary ---------------- */
  const errs = consoleMsgs.filter(m => m.type === 'error');
  const warns = consoleMsgs.filter(m => m.type === 'warning');
  console.log('\n=== SUMMARY ===');
  const pass = results.filter(x => x.pass).length;
  console.log(`results: ${pass}/${results.length} pass`);
  console.log(`console.error=${errs.length} warning=${warns.length} pageerror=${pageErrors.length}`);
  if (errs.length) console.log(JSON.stringify(errs, null, 1));
  if (warns.length) console.log(JSON.stringify(warns, null, 1));
  if (pageErrors.length) console.log(JSON.stringify(pageErrors, null, 1));
  console.log('FAILS: ' + JSON.stringify(results.filter(x => !x.pass), null, 1));
  fs.writeFileSync(path.join(OUT_DIR, 'qa-results.json'), JSON.stringify({ results, consoleMsgs, pageErrors }, null, 1));
}

run().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
