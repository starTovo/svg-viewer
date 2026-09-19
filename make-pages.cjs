/* Generates docs/index.html — the public GitHub Pages showcase.
 *
 * The page embeds the real app UI twice (phone 390x844 + tablet 820x1180) via
 * srcdoc, so the hosted page stays a single self-contained file with zero
 * external requests. That matters for GitHub Pages: no build step, no assets
 * to upload, works over https the same as over file://.
 *
 * Usage: node make-pages.cjs   (run from repo root)
 * Re-run after any change to app/index.html.
 */
const fs = require('fs');

const APP = 'app/index.html';
const OUT = 'docs/index.html';

let app = fs.readFileSync(APP, 'utf8');

/* Escape for a double-quoted JS string living inside a <script> block.
 * "</script" must be split or the HTML parser ends the script tag early
 * regardless of JS string context. */
app = app
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\r?\n/g, '\\n')
  .replace(/<\/script/gi, '<\\/script')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

fs.mkdirSync('docs', { recursive: true });

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SVG 查看器 · 手机 / 平板界面实时演示</title>
<meta name="description" content="安卓 SVG 查看器与编辑器：打开、编辑、查看、缩放、导出 PNG。手机与平板界面在线实时演示。">
<style>
  :root{
    --bg:#F9FAFB; --surface:#FFFFFF; --subtle:#F2F4F7;
    --border:#E4E7EC; --strong:#D0D5DD;
    --text:#101828; --muted:#475467; --accent:#5E6AD2;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    margin:0; background:var(--bg); color:var(--text);
    font-family:Inter,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
    font-size:14px; line-height:22px;
  }
  .wrap{max-width:1400px; margin:0 auto; padding:32px 24px 64px}

  header h1{font-size:26px; line-height:34px; font-weight:700; margin:0 0 6px}
  header p.lead{margin:0 0 4px; color:var(--muted); font-size:15px}
  header p.meta{margin:0; color:var(--muted); font-size:13px}
  .pill{
    display:inline-block; font-size:12px; padding:2px 10px; border-radius:999px;
    background:#EEF0FE; color:#3F47A0; border:1px solid #D8DCFB; margin-right:6px;
  }

  .features{
    margin:24px 0 28px; padding:16px 20px; background:var(--surface);
    border:1px solid var(--border); border-radius:12px;
  }
  .features ul{margin:0; padding-left:20px}
  .features li{margin:2px 0}

  .note{
    font-size:13px; color:var(--muted); margin:0 0 12px;
  }

  .toolbar{
    display:flex; align-items:center; gap:8px; flex-wrap:wrap;
    padding:10px 12px; background:var(--surface); border:1px solid var(--border);
    border-radius:10px; margin-bottom:16px;
  }
  .toolbar .sp{flex:1}
  button{
    height:32px; padding:0 13px; border:1px solid var(--border); background:var(--surface);
    color:var(--text); border-radius:6px; font-size:13px; cursor:pointer; font-family:inherit;
  }
  button:hover{background:var(--subtle)}
  button.on{background:var(--accent); border-color:var(--accent); color:#fff}
  .zv{font-size:12px; color:var(--muted); min-width:44px; text-align:center;
      font-variant-numeric:tabular-nums}

  .stagebox{border:1px solid var(--strong); border-radius:12px; background:var(--surface);
            padding:20px; overflow:auto}
  .stage{display:flex; gap:28px; align-items:flex-start; width:max-content}
  .unit{display:flex; flex-direction:column; gap:8px}
  .cap{display:flex; align-items:baseline; gap:8px}
  .cap b{font-size:13px; font-weight:600}
  .cap span{font-size:11px; color:var(--muted)}
  .frame{background:#fff; overflow:hidden; flex:0 0 auto;
    box-shadow:0 4px 8px -2px rgba(16,24,40,.10), 0 2px 4px -2px rgba(16,24,40,.06)}
  .frame.phone{width:390px; height:844px; border:1px solid var(--strong); border-radius:28px}
  .frame.tablet{width:820px; height:1180px; border:1px solid var(--strong); border-radius:16px}
  iframe{border:0; display:block; width:100%; height:100%; background:#fff}

  footer{margin-top:40px; padding-top:20px; border-top:1px solid var(--border);
         font-size:13px; color:var(--muted)}
  footer a{color:var(--accent); text-decoration:none}
  footer a:hover{text-decoration:underline}

  @media (max-width:700px){
    .wrap{padding:20px 14px 48px}
    header h1{font-size:21px; line-height:29px}
  }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <h1>SVG 查看器</h1>
    <p class="lead">安卓手机 / 平板上的 SVG 查看与编辑工具 —— 打开、改代码、看效果、导出 PNG，全程离线可用。</p>
    <p class="meta">
      <span class="pill">单一 HTML 文件</span>
      <span class="pill">离线可用</span>
      <span class="pill">Android 8.0+</span>
      <span class="pill">AI 辅助开发</span>
    </p>
  </header>

  <div class="features">
    <ul>
      <li><b>打开</b>本地 SVG，或从文件管理器直接「用其他应用打开」</li>
      <li><b>编辑</b>源码：一键清空、多步撤销重做、语法排错会直接报出<b>行号列号</b>并跳到出错位置</li>
      <li><b>查看</b>：双指缩放（0.1x–8x）、单指平移、双击放大、棋盘格看透明背景</li>
      <li><b>导出</b> PNG（2x 清晰度）或保存 SVG，可自定义导出目录</li>
      <li>写代码写坏了也不怕：画面保留上一次成功渲染，只在下方提示哪里出错</li>
    </ul>
  </div>

  <p class="note">下面是<b>真实运行的界面</b>，不是截图 —— 可以直接点、可以缩放、可以改代码看效果。</p>

  <div class="toolbar">
    <button id="out" type="button" title="缩小">−</button>
    <span class="zv" id="zv">100%</span>
    <button id="in" type="button" title="放大">＋</button>
    <button id="fit" type="button">适应宽度</button>
    <button id="tour" type="button">重看新手引导</button>
    <button id="reload" type="button">重新载入</button>
    <span class="sp"></span>
    <span class="zv" id="ver"></span>
  </div>

  <div class="stagebox">
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

  <footer>
    <p>
      <b>关于 AI 参与</b>：本项目采用 Vibe Coding 方式开发 —— 需求与验收由人决策，
      界面实现、构建脚本、自动化验证由 AI 完成。详见仓库 README。
    </p>
    <p>
      界面版本 <span id="fv"></span> · 源码见
      <a href="https://github.com/" target="_blank" rel="noopener">GitHub 仓库</a>
    </p>
  </footer>

</div>

<script>
/* The whole app UI, inlined by make-pages.cjs. Regenerate with:
     node make-pages.cjs
   after any change to app/index.html. */
var APP_HTML = "${app}";

function frames(){ return document.querySelectorAll('iframe'); }
function mount(){ var f=frames(); for(var i=0;i<f.length;i++){ f[i].srcdoc = APP_HTML; } }
function each(fn){
  var f=frames();
  for(var i=0;i<f.length;i++){
    try{ var w=f[i].contentWindow; if(w && w.SvgApp){ fn(w.SvgApp); } }catch(e){}
  }
}

var stage=document.getElementById('stage');
var zv=document.getElementById('zv');
var scale=1;
function setZoom(v){
  scale=Math.max(0.35, Math.min(1.6, Math.round(v*100)/100));
  stage.style.zoom=scale;
  zv.textContent=Math.round(scale*100)+'%';
}

document.getElementById('in').addEventListener('click', function(){ setZoom(scale+0.1); });
document.getElementById('out').addEventListener('click', function(){ setZoom(scale-0.1); });
document.getElementById('fit').addEventListener('click', function(){
  var box=stage.parentNode;
  var avail=box.clientWidth-40;
  setZoom(avail/(stage.scrollWidth||1242));
});
document.getElementById('reload').addEventListener('click', mount);
document.getElementById('tour').addEventListener('click', function(){
  each(function(a){ if(typeof a.startTour==='function'){ a.startTour(); } });
});
document.addEventListener('keydown', function(e){
  if(e.key==='+'||e.key==='='){ setZoom(scale+0.1); }
  else if(e.key==='-'||e.key==='_'){ setZoom(scale-0.1); }
  else if(e.key==='0'){ setZoom(1); }
});

mount();

setTimeout(function(){
  each(function(a){
    if(a.version && !document.getElementById('ver').textContent){
      document.getElementById('ver').textContent='v'+a.version;
      document.getElementById('fv').textContent='v'+a.version;
    }
  });
}, 1200);
</script>

</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
const b = fs.readFileSync(OUT);
console.log('written:', OUT, b.length, 'bytes  BOM:', (b[0] === 0xEF) ? 'yes' : 'no');
