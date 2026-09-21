/* Generates a fully self-contained UI review harness.
 *
 * Why: ui-review.html used to load app/index.html via <iframe src>. That works
 * in a normal browser, but sandboxed preview panels (and any page served from
 * a restrictive context) block nested file:// iframes, so the user saw two
 * empty frames. Inlining the app HTML as srcdoc removes the nested-file
 * dependency entirely: the harness is one file, works everywhere, and the
 * iframes become same-origin with the parent (so we can call window.SvgApp
 * inside them, e.g. to replay the onboarding tour).
 *
 * Usage: node make-review.cjs   (run from E:/svg_view/repo)
 */
const fs = require('fs');

const APP = 'app/index.html';
const OUT = '../_local/ui-review.html';

let app = fs.readFileSync(APP, 'utf8');

/* Escape for embedding inside a double-quoted JS string literal that itself
 * lives in a <script> block: backslash, quote, newlines, and -- critically --
 * "</script" must be broken up or the HTML parser terminates the script tag
 * early no matter what the JS string says. */
app = app
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\r?\n/g, '\\n')
  .replace(/<\/script/gi, '<\\/script')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UI 走查台 · SVG 查看器 App</title>
<style>
  :root{
    --bg:#F9FAFB; --surface:#FFFFFF; --subtle:#F2F4F7;
    --border:#E4E7EC; --border-strong:#D0D5DD;
    --text:#101828; --muted:#475467; --accent:#5E6AD2;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--bg); color:var(--text);
    font-family:Inter,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
    font-size:13px; line-height:20px;
  }
  .bar{
    position:sticky; top:0; z-index:20;
    background:var(--surface); border-bottom:1px solid var(--border);
    padding:10px 20px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  }
  .bar h1{font-size:15px; font-weight:600; margin:0 4px 0 0}
  .hint{font-size:12px; color:var(--muted)}
  .spacer{flex:1}
  .btn{
    height:32px; padding:0 14px; border:1px solid var(--border);
    background:var(--surface); color:var(--text); border-radius:6px;
    font-size:13px; cursor:pointer; font-family:inherit;
  }
  .btn:hover{background:var(--subtle)}
  .btn.primary{background:var(--accent); border-color:var(--accent); color:#fff}
  .btn.primary:hover{filter:brightness(1.08)}
  .zoomval{
    font-size:12px; color:var(--muted); min-width:44px; text-align:center;
    font-variant-numeric:tabular-nums;
  }
  .holder{padding:24px; overflow:auto}
  .stage{display:flex; gap:32px; align-items:flex-start; width:max-content}
  .unit{display:flex; flex-direction:column; gap:10px}
  .cap{display:flex; align-items:baseline; gap:8px}
  .cap b{font-size:13px; font-weight:600}
  .cap span{font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums}
  .frame{
    background:#fff; overflow:hidden; flex:0 0 auto;
    box-shadow:0 4px 8px -2px rgba(16,24,40,.10), 0 2px 4px -2px rgba(16,24,40,.06);
  }
  .frame.phone{width:390px; height:844px; border:1px solid var(--border-strong); border-radius:28px}
  .frame.tablet{width:820px; height:1180px; border:1px solid var(--border-strong); border-radius:16px}
  iframe{border:0; display:block; width:100%; height:100%; background:#fff}
</style>
</head>
<body>

<div class="bar">
  <h1>UI 走查台</h1>
  <span class="hint">两侧真实运行，可直接点击操作 — 所见即 App 内效果</span>
  <div class="spacer"></div>
  <button class="btn" id="btnOut" type="button" title="缩小">−</button>
  <span class="zoomval" id="zval">100%</span>
  <button class="btn" id="btnIn" type="button" title="放大">＋</button>
  <button class="btn" id="btnFit" type="button">适应宽度</button>
  <button class="btn" id="btnTour" type="button">重看新手引导</button>
  <button class="btn primary" id="btnReload" type="button">重新载入</button>
</div>

<div class="holder">
  <div class="stage" id="stage">
    <div class="unit">
      <div class="cap"><b>手机</b><span>390 × 844</span></div>
      <div class="frame phone"><iframe title="手机视图"></iframe></div>
    </div>
    <div class="unit">
      <div class="cap"><b>平板</b><span>820 × 1180</span></div>
      <div class="frame tablet"><iframe title="平板视图"></iframe></div>
    </div>
  </div>
</div>

<script>
/* The whole app page, inlined by make-review.cjs. Regenerate with:
     node make-review.cjs
   after any change to app/index.html. */
var APP_HTML = "${app}";

function frames() { return document.querySelectorAll('iframe'); }

function mount() {
  for (var i = 0; i < frames().length; i++) { frames()[i].srcdoc = APP_HTML; }
}

/* Same-origin srcdoc means we can reach into the frames and drive the app. */
function withApp(fn) {
  for (var i = 0; i < frames().length; i++) {
    try {
      var w = frames()[i].contentWindow;
      if (w && w.SvgApp) { fn(w.SvgApp); }
    } catch (e) { /* not ready yet */ }
  }
}

function reloadFrames() { mount(); }

function replayTour() {
  withApp(function (app) {
    if (typeof app.startTour === 'function') { app.startTour(); }
  });
}

var stage = document.getElementById('stage');
var zval = document.getElementById('zval');
var scale = 1;

function setZoom(v) {
  scale = Math.max(0.4, Math.min(1.6, Math.round(v * 100) / 100));
  stage.style.zoom = scale;
  zval.textContent = Math.round(scale * 100) + '%';
}

document.getElementById('btnIn').addEventListener('click', function () { setZoom(scale + 0.1); });
document.getElementById('btnOut').addEventListener('click', function () { setZoom(scale - 0.1); });
document.getElementById('btnFit').addEventListener('click', function () {
  var avail = document.documentElement.clientWidth - 48;
  var natural = stage.scrollWidth || 1242;
  setZoom(avail / natural);
});
document.getElementById('btnReload').addEventListener('click', reloadFrames);
document.getElementById('btnTour').addEventListener('click', replayTour);

document.addEventListener('keydown', function (e) {
  if (e.key === '+' || e.key === '=') { setZoom(scale + 0.1); }
  else if (e.key === '-' || e.key === '_') { setZoom(scale - 0.1); }
  else if (e.key === '0') { setZoom(1); }
});

mount();
</script>

</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
const b = fs.readFileSync(OUT);
console.log('written:', OUT, b.length, 'bytes  BOM:', (b[0] === 0xEF) ? 'yes' : 'no');
