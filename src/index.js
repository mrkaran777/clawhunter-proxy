/**
 * Claw Hunter Free Image API Proxy
 * Cloudflare Worker - Web UI + OpenAI API
 * 3 free models + Image-to-Image + Drag & Drop + Lightbox
 */

var BASE = "https://clawhunter.fun";
var TOKEN_URL = BASE + "/api/v1/studio/token";
var IMAGE_URL = BASE + "/api/studio/images";

// ============ Dynamic Relay Pool (KV-persisted) ============
// Relay pool supports:
// 1. RELAY_URLS env var (comma-separated)
// 2. /admin/add-relay API (persisted to KV)
// 3. /admin/remove-relay API
// Each relay = different platform/account = different IP = independent quota
var KV_KEY = "relay-pool";
var KV_HEALTH_KEY = "relay-health";
var inMemoryRelays = [];
var relayHealth = {};

async function loadRelays(env) {
  if (env && env.RELAY_POOL) {
    try {
      var data = await env.RELAY_POOL.get(KV_KEY, "json");
      if (data && Array.isArray(data)) inMemoryRelays = data;
      var health = await env.RELAY_POOL.get(KV_HEALTH_KEY, "json");
      if (health) relayHealth = health;
    } catch(e) {}
  }
}

async function saveRelays(env) {
  if (env && env.RELAY_POOL) {
    try {
      await env.RELAY_POOL.put(KV_KEY, JSON.stringify(inMemoryRelays));
      await env.RELAY_POOL.put(KV_HEALTH_KEY, JSON.stringify(relayHealth));
    } catch(e) {}
  }
}

async function getRelayPool(env) {
  try { await loadRelays(env); } catch(e) {}
  var envRelays = [];
  if (env && env.RELAY_URLS) {
    envRelays = env.RELAY_URLS.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
  }
  var memRelays = Array.isArray(inMemoryRelays) ? inMemoryRelays : [];
  var seen = {};
  var merged = [];
  envRelays.concat(memRelays).forEach(function(url) {
    if (url && !seen[url]) { seen[url] = true; merged.push(url); }
  });
  return merged;
}

async function addRelay(env, url) {
  await loadRelays(env);
  url = url.trim().replace(/\/$/, "");
  if (inMemoryRelays.indexOf(url) === -1) {
    inMemoryRelays.push(url);
    relayHealth[url] = { ok: true, lastCheck: 0, errors: 0 };
    await saveRelays(env);
    return true;
  }
  return false;
}

async function removeRelay(env, url) {
  await loadRelays(env);
  var idx = inMemoryRelays.indexOf(url);
  if (idx !== -1) {
    inMemoryRelays.splice(idx, 1);
    delete relayHealth[url];
    await saveRelays(env);
    return true;
  }
  return false;
}

function markRelayBad(url) {
  if (relayHealth[url]) {
    relayHealth[url].errors++;
    relayHealth[url].ok = relayHealth[url].errors < 3;
  }
}

function markRelayGood(url) {
  if (relayHealth[url]) {
    relayHealth[url].errors = 0;
    relayHealth[url].ok = true;
    relayHealth[url].lastCheck = Date.now();
  }
}

// Shuffle array (Fisher-Yates)
function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

async function relayFetch(relayUrl, clawReq, secret) {
  var headers = { "Content-Type": "application/json" };
  if (secret) headers["X-Relay-Token"] = secret;
  var endpoint = relayUrl;
  if (!endpoint.endsWith("/relay") && !endpoint.endsWith("/api/relay")) {
    endpoint = endpoint + "/relay";
  }
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, 25000);
  try {
    var resp = await fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ request: clawReq }),
      signal: controller.signal
    });
    clearTimeout(timer);
    var data = await resp.json().catch(function() { return {}; });
    return { status: resp.status, data: data };
  } catch(e) {
    clearTimeout(timer);
    return { status: 0, data: { error: e.name === "AbortError" ? "Relay timeout" : e.message } };
  }
}

var MODELS = [
  { id: "gpt-image-2",     name: "GPT Image 2",     provider: "OpenAI",  cost: 0, tag: "FREE", freeRes: "1K", edit: true, ar: true },
  { id: "nano-banana-2",   name: "Nano Banana 2",   provider: "Google",  cost: 0, tag: "FREE", freeRes: "1K", edit: true, ar: false },
  { id: "kling-v3",        name: "Kling V3",        provider: "Kuaishou", cost: 0, tag: "FREE", edit: false, ar: false }
];

var pool = [];

async function getToken() {
  var now = Date.now() / 1000 | 0;
  pool = pool.filter(function(t) { return t.exp - 120 > now; });
  if (pool.length > 0) {
    pool.sort(function(a, b) { return a.used - b.used; });
    pool[0].used = now;
    return pool[0].tok;
  }
  var r = await fetch(TOKEN_URL);
  var d = await r.json();
  pool.push({ tok: d.token, exp: d.expiresAt, used: now });
  return d.token;
}

async function refreshPool(count) {
  var n = Math.min(count || 3, 3);
  for (var i = 0; i < n; i++) {
    try {
      var r = await fetch(TOKEN_URL);
      var d = await r.json();
      pool.push({ tok: d.token, exp: d.expiresAt, used: 0 });
    } catch(e) {}
  }
}

function jsonResp(data, code, headers) {
  return new Response(JSON.stringify(data), {
    status: code || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {})
  });
}

function errResp(code, msg) {
  return jsonResp({ error: { message: msg, type: "invalid_request_error", code: code } }, code);
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function getClientJS() {
  var modelJSON = JSON.stringify(MODELS);
  var L = [];
  L.push("var MODELS = " + modelJSON + ";");
  L.push("var selModel = MODELS[0].id, selAR = '1:1', selQ = 'medium';");
  L.push("var refImage = null;");
  L.push("");
  L.push("function renderModels() {");
  L.push("  var grid = document.getElementById('modelGrid');");
  L.push("  grid.innerHTML = '';");
  L.push("  MODELS.forEach(function(m) {");
  L.push("    var btn = document.createElement('button');");
  L.push("    btn.className = 'model-card' + (m.id === selModel ? ' active' : '');");
  L.push("    btn.setAttribute('data-mid', m.id);");
  L.push("    var badge = m.freeRes ? ' (' + m.freeRes + ')' : '';");
  L.push("    var editTag = m.edit ? ' +Edit' : '';");
  L.push("    var mn = document.createElement('div');");
  L.push("    mn.className = 'mn';");
  L.push("    mn.textContent = m.name + badge;");
  L.push("    btn.appendChild(mn);");
  L.push("    var mp = document.createElement('div');");
  L.push("    mp.className = 'mp';");
  L.push("    mp.textContent = m.provider + ' - ' + m.tag + editTag;");
  L.push("    btn.appendChild(mp);");
  L.push("    var mc = document.createElement('div');");
  L.push("    mc.className = 'mc';");
  L.push("    mc.textContent = 'FREE';");
  L.push("    btn.appendChild(mc);");
  L.push("    grid.appendChild(btn);");
  L.push("  });");
  L.push("  updateImageSection();");
  L.push("}");
  L.push("");
  L.push("function updateImageSection() {");
  L.push("  var m = MODELS.find(function(x) { return x.id === selModel; });");
  L.push("  var section = document.getElementById('imgSection');");
  L.push("  if (m && m.edit) { section.style.display = 'block'; }");
  L.push("  else { section.style.display = 'none'; refImage = null; }");
  L.push("  var btn = document.getElementById('genBtn');");
  L.push("  if (btn) btn.innerHTML = refImage ? 'Edit Image' : 'Generate';");
  L.push("  // Show/hide aspect ratio options based on model support");
  L.push("  var arSection = document.getElementById('arOpts');");
  L.push("  var arLabel = arSection ? arSection.parentElement.querySelector('label') : null;");
  L.push("  if (m && m.ar) {");
  L.push("    arSection.style.opacity = '1';");
  L.push("    arSection.style.pointerEvents = 'auto';");
  L.push("    if (arLabel) arLabel.innerHTML = 'Aspect Ratio';");
  L.push("  } else {");
  L.push("    arSection.style.opacity = '0.4';");
  L.push("    arSection.style.pointerEvents = 'none';");
  L.push("    if (arLabel) arLabel.innerHTML = 'Aspect Ratio <span style=\"color:var(--muted)\">(not supported by this model)</span>';");
  L.push("    selAR = '1:1';");
  L.push("    document.querySelectorAll('#arOpts .opt-btn').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-val') === '1:1'); });");
  L.push("  }");
  L.push("}");
  L.push("");
  L.push("function pickModel(id) {");
  L.push("  selModel = id;");
  L.push("  document.querySelectorAll('.model-card').forEach(function(el) {");
  L.push("    el.classList.toggle('active', el.getAttribute('data-mid') === id);");
  L.push("  });");
  L.push("  updateImageSection();");
  L.push("}");
  L.push("");
  L.push("function handleImageUpload(file) {");
  L.push("  if (!file) return;");
  L.push("  if (file.size > 10 * 1024 * 1024) { showStatus('Image too large (max 10MB)', 'err'); return; }");
  L.push("  var reader = new FileReader();");
  L.push("  reader.onload = function(ev) {");
  L.push("    refImage = ev.target.result;");
  L.push("    var preview = document.getElementById('refPreview');");
  L.push("    preview.innerHTML = '';");
  L.push("    var img = document.createElement('img');");
  L.push("    img.src = refImage;");
  L.push("    img.style.cssText = 'max-width:100%;max-height:150px;border-radius:8px;cursor:pointer';");
  L.push("    img.setAttribute('data-lb', refImage);");
  L.push("    preview.appendChild(img);");
  L.push("    var btn = document.getElementById('genBtn');");
  L.push("    if (btn) btn.innerHTML = 'Edit Image';");
  L.push("  };");
  L.push("  reader.readAsDataURL(file);");
  L.push("}");
  L.push("");
  L.push("function removeImage() {");
  L.push("  refImage = null;");
  L.push("  var preview = document.getElementById('refPreview');");
  L.push("  preview.innerHTML = '<p>Click or drag image here</p><p class=hint>PNG, JPEG, WebP | Max 10MB</p>';");
  L.push("  var inp = document.getElementById('imageInput');");
  L.push("  if (inp) inp.value = '';");
  L.push("  var btn = document.getElementById('genBtn');");
  L.push("  if (btn) btn.innerHTML = 'Generate';");
  L.push("}");
  L.push("");
  L.push("function setupDragDrop() {");
  L.push("  var zone = document.getElementById('uploadZone');");
  L.push("  if (!zone) return;");
  L.push("  zone.addEventListener('dragover', function(e) {");
  L.push("    e.preventDefault(); zone.style.borderColor = 'var(--accent)';");
  L.push("  });");
  L.push("  zone.addEventListener('dragleave', function() {");
  L.push("    zone.style.borderColor = '';");
  L.push("  });");
  L.push("  zone.addEventListener('drop', function(e) {");
  L.push("    e.preventDefault(); zone.style.borderColor = '';");
  L.push("    if (e.dataTransfer.files.length > 0)");
  L.push("      handleImageUpload(e.dataTransfer.files[0]);");
  L.push("  });");
  L.push("}");
  L.push("");
  L.push("function openLightbox(src) {");
  L.push("  var lb = document.getElementById('lightbox');");
  L.push("  var img = document.getElementById('lightboxImg');");
  L.push("  if (!lb || !img || !src) return;");
  L.push("  img.src = src;");
  L.push("  lb.style.display = 'flex';");
  L.push("  lb.classList.add('open');");
  L.push("  document.body.style.overflow = 'hidden';");
  L.push("}");
  L.push("");
  L.push("function closeLightbox() {");
  L.push("  var lb = document.getElementById('lightbox');");
  L.push("  if (!lb) return;");
  L.push("  lb.classList.remove('open');");
  L.push("  lb.style.display = 'none';");
  L.push("  document.body.style.overflow = '';");
  L.push("}");
  L.push("");
  L.push("document.addEventListener('keydown', function(e) {");
  L.push("  if (e.key === 'Escape') closeLightbox();");
  L.push("});");
  L.push("");
  L.push("document.getElementById('lightbox').addEventListener('click', function(e) {");
  L.push("  if (e.target === this || e.target.classList.contains('lightbox-close')) closeLightbox();");
  L.push("});");
  L.push("");
  L.push("document.getElementById('uploadZone').addEventListener('click', function(e) {");
  L.push("  if (e.target.tagName !== 'INPUT') document.getElementById('imageInput').click();");
  L.push("});");
  L.push("");
  L.push("document.getElementById('imageInput').addEventListener('change', function(e) {");
  L.push("  if (e.target.files.length > 0) handleImageUpload(e.target.files[0]);");
  L.push("});");
  L.push("");
  L.push("document.getElementById('removeBtn').addEventListener('click', function(e) {");
  L.push("  e.stopPropagation(); removeImage();");
  L.push("});");
  L.push("");
  L.push("document.getElementById('preview').addEventListener('click', function(e) {");
  L.push("  var img = e.target.closest('[data-lb]');");
  L.push("  if (img) openLightbox(img.getAttribute('data-lb'));");
  L.push("});");
  L.push("");
  L.push("document.getElementById('refPreview').addEventListener('click', function(e) {");
  L.push("  var img = e.target.closest('[data-lb]');");
  L.push("  if (img) openLightbox(img.getAttribute('data-lb'));");
  L.push("});");
  L.push("");
  L.push("document.getElementById('arOpts').addEventListener('click', function(e) {");
  L.push("  var btn = e.target.closest('.opt-btn');");
  L.push("  if (!btn) return;");
  L.push("  selAR = btn.getAttribute('data-val');");
  L.push("  document.querySelectorAll('#arOpts .opt-btn').forEach(function(b) { b.classList.remove('active'); });");
  L.push("  btn.classList.add('active');");
  L.push("});");
  L.push("");
  L.push("document.getElementById('qOpts').addEventListener('click', function(e) {");
  L.push("  var btn = e.target.closest('.opt-btn');");
  L.push("  if (!btn) return;");
  L.push("  selQ = btn.getAttribute('data-val');");
  L.push("  document.querySelectorAll('#qOpts .opt-btn').forEach(function(b) { b.classList.remove('active'); });");
  L.push("  btn.classList.add('active');");
  L.push("});");
  L.push("");
  L.push("document.getElementById('modelGrid').addEventListener('click', function(e) {");
  L.push("  var card = e.target.closest('.model-card');");
  L.push("  if (!card) return;");
  L.push("  pickModel(card.getAttribute('data-mid'));");
  L.push("});");
  L.push("");
  L.push("function showStatus(msg, type) {");
  L.push("  var el = document.getElementById('status');");
  L.push("  el.textContent = msg;");
  L.push("  el.className = 'status show ' + type;");
  L.push("}");
  L.push("");
  L.push("async function generate() {");
  L.push("  var prompt = document.getElementById('prompt').value.trim();");
  L.push("  if (!prompt) { showStatus('Please enter a prompt', 'err'); return; }");
  L.push("  var btn = document.getElementById('genBtn');");
  L.push("  var preview = document.getElementById('preview');");
  L.push("  btn.disabled = true;");
  L.push("  btn.innerHTML = 'Generating...';");
  L.push("  var loading = document.createElement('div');");
  L.push("  loading.className = 'loading';");
  L.push("  var spinner = document.createElement('div');");
  L.push("  spinner.className = 'spinner';");
  L.push("  loading.appendChild(spinner);");
  L.push("  preview.innerHTML = '';");
  L.push("  preview.appendChild(loading);");
  L.push("  try {");    L.push("    var reqBody = { model: selModel, prompt: prompt, n: 1 };");
    L.push("    var m = MODELS.find(function(x) { return x.id === selModel; });");
    L.push("    if (m && m.ar) { reqBody.aspect_ratio = selAR; reqBody.resolution = '1K'; }");
    L.push("    if (m && m.ar) reqBody.quality = selQ;");
    L.push("    if (refImage) reqBody.image = refImage;");
  L.push("    var resp = await fetch('/v1/images/generations', {");
  L.push("      method: 'POST',");
  L.push("      headers: {'Content-Type':'application/json','Authorization':'Bearer free'},");
  L.push("      body: JSON.stringify(reqBody)");
  L.push("    });");
  L.push("    var data = await resp.json();");
  L.push("    if (data.error) { var em = (typeof data.error === 'string') ? data.error : (data.error.message || JSON.stringify(data.error) || 'Unknown error'); throw new Error(em); }");
  L.push("    if (data.data && data.data.length > 0) {");
  L.push("      var url = data.data[0].url;");
  L.push("      var img = document.createElement('img');");
  L.push("      img.src = url;");
  L.push("      img.alt = 'Generated';");
  L.push("      img.style.cursor = 'pointer';");
  L.push("      img.setAttribute('data-lb', url);");
  L.push("      preview.innerHTML = '';");
  L.push("      preview.appendChild(img);");
  L.push("      var cost = resp.headers.get('X-Claw-Cost') || '0';");
  L.push("      var mode = refImage ? 'Edit' : 'Generate';");
  L.push("      showStatus('OK! ' + mode + ' | Cost: $' + parseFloat(cost).toFixed(4) + ' | Model: ' + (resp.headers.get('X-Claw-Model') || selModel), 'ok');");
  L.push("    }");
  L.push("  } catch(e) {");
  L.push("    preview.innerHTML = '';");
  L.push("    var ph = document.createElement('div');");
  L.push("    ph.className = 'placeholder';");
  L.push("    var errMsg = e.message || 'Unknown error';");
  L.push("    var errHTML = '<div class=\"icon\">Error</div><p>' + errMsg + '</p>';");
  L.push("    if (errMsg.indexOf('daily') !== -1 || errMsg.indexOf('limit') !== -1) {");
  L.push("      errHTML += '<p style=\"margin-top:12px;font-size:12px;color:var(--muted)\">' +");
  L.push("        'This IP has used its daily free quota.<br>' +");
  L.push("        'Deploy relays for more IPs: <code>./deploy-relays.sh all</code><br>' +");
  L.push("        'Or wait for quota to reset (~23h).</p>';");
  L.push("    }");
  L.push("    ph.innerHTML = errHTML;");
  L.push("    preview.appendChild(ph);");
  L.push("    showStatus('Error: ' + errMsg, 'err');");
  L.push("  } finally {");
  L.push("    btn.disabled = false;");
  L.push("    btn.innerHTML = refImage ? 'Edit Image' : 'Generate';");
  L.push("  }");
  L.push("}");
  L.push("");
  L.push("document.getElementById('genBtn').addEventListener('click', generate);");
  L.push("document.getElementById('prompt').addEventListener('keydown', function(e) {");
  L.push("  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate();");
  L.push("});");
  L.push("");
  L.push("setupDragDrop();");
  L.push("renderModels();");
  return L.join("\n");
}

function getHTML() {
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Claw Hunter - Free Image Gen</title><style>',
    '*{margin:0;padding:0;box-sizing:border-box}',
    ':root{--bg:#0a0a0f;--card:#12121a;--border:#1e1e2e;--accent:#6366f1;--accent2:#818cf8;--text:#e2e8f0;--muted:#64748b;--green:#22c55e;--red:#ef4444}',
    'body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}',
    '.wrap{max-width:1000px;margin:0 auto;padding:20px}',
    'header{text-align:center;padding:30px 0;border-bottom:1px solid var(--border)}',
    'header h1{font-size:28px;margin-bottom:8px}',
    'header h1 span{color:var(--accent)}',
    'header p{color:var(--muted);font-size:14px}',
    '.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:rgba(34,197,94,.15);color:var(--green)}',
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px}',
    '@media(max-width:768px){.grid{grid-template-columns:1fr}}',
    '.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px}',
    '.panel h2{font-size:16px;margin-bottom:16px}',
    '.field{margin-bottom:16px}',
    '.field label{display:block;font-size:13px;color:var(--muted);margin-bottom:6px}',
    '.field textarea{width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;outline:none;min-height:100px;resize:vertical}',
    '.field textarea:focus{border-color:var(--accent)}',
    '.model-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
    '.model-card{padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:transparent;color:var(--text);text-align:left}',
    '.model-card:hover{border-color:var(--accent)}',
    '.model-card.active{border-color:var(--accent);background:rgba(99,102,241,.1)}',
    '.model-card .mn{font-size:13px;font-weight:600}',
    '.model-card .mp{font-size:11px;color:var(--muted);margin-top:2px}',
    '.model-card .mc{font-size:11px;color:var(--green);font-weight:600}',
    '.opts{display:flex;gap:8px;flex-wrap:wrap}',
    '.opt-btn{padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);font-size:12px;cursor:pointer}',
    '.opt-btn:hover{border-color:var(--accent)}',
    '.opt-btn.active{background:var(--accent);border-color:var(--accent);color:white}',
    '.gen-btn{padding:12px 24px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--accent);color:white}',
    '.gen-btn:hover{background:var(--accent2)}',
    '.gen-btn:disabled{opacity:.5;cursor:not-allowed}',
    '.preview{min-height:300px;display:flex;align-items:center;justify-content:center;border:2px dashed var(--border);border-radius:12px;overflow:hidden;position:relative;text-align:center}',
    '.preview img{width:100%;height:auto;object-fit:contain;border-radius:8px;cursor:pointer;transition:transform .2s;display:block}',
    '.preview img:hover{transform:scale(1.02)}',
    '.placeholder{text-align:center;color:var(--muted)}',
    '.placeholder .icon{font-size:48px;margin-bottom:8px}',
    '.loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7)}',
    '.spinner{width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '.status{margin-top:12px;padding:10px;border-radius:8px;font-size:13px;display:none}',
    '.status.show{display:block}',
    '.status.ok{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);color:var(--green)}',
    '.status.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:var(--red)}',
    '.upload-zone{border:2px dashed var(--border);border-radius:8px;padding:16px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s}',
    '.upload-zone:hover{border-color:var(--accent)}',
    '.upload-zone input{display:none}',
    '.upload-zone .hint{font-size:11px;color:var(--muted);margin-top:4px}',
    '.ref-actions{display:flex;gap:8px;margin-top:8px}',
    '.ref-btn{padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--muted);font-size:11px;cursor:pointer}',
    '.ref-btn:hover{border-color:var(--red);color:var(--red)}',
    '.api-info{margin-top:24px;padding:16px;background:var(--card);border:1px solid var(--border);border-radius:12px}',
    '.api-info h3{font-size:14px;margin-bottom:12px}',
    '.api-info pre{background:var(--bg);padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;line-height:1.6}',
    '#lightbox{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0);transition:background .2s ease}',
    '#lightbox.open{display:flex;background:rgba(0,0,0,.92)}',
    '#lightbox img{max-width:92vw;max-height:92vh;object-fit:contain;border-radius:8px;box-shadow:0 0 80px rgba(0,0,0,.6)}',
    '.lightbox-close{position:absolute;top:20px;right:20px;width:44px;height:44px;border:none;border-radius:50%;background:rgba(255,255,255,.1);color:white;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;z-index:1}',
    '.lightbox-close:hover{background:rgba(255,255,255,.25)}',
    '.lightbox-hint{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.4);font-size:12px}',
    '</style></head><body>',
    '<header><h1>&#128062; <span>Claw Hunter</span> Free Image Gen</h1>',
    '<p>OpenAI Compatible API | 3 Free Models | Text-to-Image + Image-to-Image</p></header>',
    '<div class=\"wrap\"><div class=\"grid\">',
    '<div class=\"panel\"><h2>&#9997;&#65039; Input</h2>',
    '<div class=\"field\"><label>Prompt</label><textarea id=\"prompt\" placeholder=\"Describe the image you want to generate...\"></textarea></div>',
    '<div class=\"field\"><label>Model <span class=\"badge\">FREE</span></label><div class=\"model-grid\" id=\"modelGrid\"></div></div>',
    '<div class=\"field\" id=\"imgSection\" style=\"display:none\"><label>Reference Image (Edit)</label>',
    '<div class=\"upload-zone\" id=\"uploadZone\">',
    '<input type=\"file\" id=\"imageInput\" accept=\"image/png,image/jpeg,image/webp\">',
    '<div id=\"refPreview\"><p>&#128247; Click or drag image here</p><p class=\"hint\">PNG, JPEG, WebP | Max 10MB</p></div></div>',
    '<div class=\"ref-actions\"><button class=\"ref-btn\" id=\"removeBtn\">Remove</button></div></div>',
    '<div class=\"field\"><label>Aspect Ratio</label><div class=\"opts\" id=\"arOpts\">',
    '<button class=\"opt-btn active\" data-val=\"1:1\">1:1</button>',
    '<button class=\"opt-btn\" data-val=\"16:9\">16:9</button>',
    '<button class=\"opt-btn\" data-val=\"9:16\">9:16</button>',
    '<button class=\"opt-btn\" data-val=\"4:3\">4:3</button>',
    '<button class=\"opt-btn\" data-val=\"3:4\">3:4</button>',
    '</div></div>',
    '<div class=\"field\"><label>Quality</label><div class=\"opts\" id=\"qOpts\">',
    '<button class=\"opt-btn\" data-val=\"low\">Low</button>',
    '<button class=\"opt-btn active\" data-val=\"medium\">Medium</button>',
    '<button class=\"opt-btn\" data-val=\"high\">High</button>',
    '</div></div>',
    '<button class=\"gen-btn\" id=\"genBtn\">&#127912; Generate</button>',
    '<div class=\"status\" id=\"status\"></div></div>',
    '<div class=\"panel\"><h2>&#128444;&#65039; Preview</h2>',
    '<div class=\"preview\" id=\"preview\"><div class=\"placeholder\"><div class=\"icon\">&#127912;</div><p>Enter prompt and click Generate</p></div></div>',
    '</div></div>',
    '<div class=\"api-info\"><h3>&#128225; API Usage (Python)</h3>',
    '<pre><code>from openai import OpenAI\\n\\nclient = OpenAI(\\n  base_url=\"https://YOUR-WORKER.workers.dev/v1\",\\n  api_key=\"your-key\"\\n)\\n\\n# Text-to-Image\\nresp = client.images.generate(\\n  model=\"gpt-image-2\",\\n  prompt=\"A cute cat\", n=1\\n)\\n\\n# Image-to-Image\\nimport base64\\nwith open(\"input.png\", \"rb\") as f:\\n  img_b64 = \"data:image/png;base64,\" + base64.b64encode(f.read()).decode()\\nresp = client.images.generate(\\n  model=\"gpt-image-2\",\\n  prompt=\"Add sunglasses\",\\n  extra_body={\"image\": img_b64}\\n)\\nprint(resp.data[0].url)</code></pre></div></div>',
    '<div id=\"lightbox\">',
    '<button class=\"lightbox-close\">&times;</button>',
    '<img id=\"lightboxImg\" src=\"\" alt=\"Enlarged\">',
    '<div class=\"lightbox-hint\">Click outside or press ESC to close</div>',
    '</div>',
    '<script src=\"/app.js\"></script></body></html>'
  ].join("\n");
}

/* --- Request Handler --- */

async function handleRequest(request, env) {
  var url = new URL(request.url);
  var C = cors();

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: C });

  if (url.pathname === "/") {
    return new Response(getHTML(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (url.pathname === "/app.js") {
    return new Response(getClientJS(), { headers: { "Content-Type": "application/javascript; charset=utf-8" } });
  }

  if (url.pathname === "/health") {
    try {
      // Token pool status
      var poolCount = 0;
      try { await getToken(); poolCount = pool ? pool.length : 0; } catch(e1) {}
      // Relay pool status
      var relayUrls = [];
      try { relayUrls = await getRelayPool(env); } catch(e2) {}
      if (!relayUrls) relayUrls = [];
      var platformCount = {};
      relayUrls.forEach(function(r) {
        var p = "custom";
        if (r.indexOf("vercel.app") !== -1) p = "vercel";
        else if (r.indexOf("deno.dev") !== -1) p = "deno";
        else if (r.indexOf("netlify.app") !== -1) p = "netlify";
        else if (r.indexOf("workers.dev") !== -1) p = "cf-worker";
        platformCount[p] = (platformCount[p] || 0) + 1;
      });
      return jsonResp({
        status: "ok",
        token_pool: poolCount,
        relays: relayUrls.length,
        platforms: platformCount,
        edge_nodes: "direct + " + relayUrls.length + " relays",
        models: ["gpt-image-2", "nano-banana-2", "kling-v3"]
      }, 200, C);
    } catch(e) {
      return jsonResp({ status: "error", msg: e.message }, 503, C);
    }
  }

  if (url.pathname === "/admin/refresh-tokens" && request.method === "POST") {
    await refreshPool(3);
    return jsonResp({ status: "ok", pool_size: pool.length }, 200, C);
  }

  // ============ Relay Pool Management ============
  if (url.pathname === "/admin/add-relay" && request.method === "POST") {
    var rb;
    try { rb = await request.json(); } catch(e) { return errResp(400, "Invalid JSON"); }
    var relayUrl = rb.url || rb.relay;
    if (!relayUrl) return errResp(400, "Missing 'url' field");
    var added = await addRelay(env, relayUrl);
    var pool = await getRelayPool(env);
    return jsonResp({ status: added ? "added" : "exists", relays: pool, count: pool.length }, 200, C);
  }

  if (url.pathname === "/admin/remove-relay" && request.method === "POST") {
    var rb2;
    try { rb2 = await request.json(); } catch(e) { return errResp(400, "Invalid JSON"); }
    var removed = await removeRelay(env, rb2.url || rb2.relay || "");
    var pool2 = await getRelayPool(env);
    return jsonResp({ status: removed ? "removed" : "not_found", relays: pool2, count: pool2.length }, 200, C);
  }

  if (url.pathname === "/admin/relays") {
    var allRelays = await getRelayPool(env);
    var healthInfo = allRelays.map(function(r) {
      var h = relayHealth[r] || { ok: true, errors: 0, lastCheck: 0 };
      return { url: r, ok: h.ok, errors: h.errors, lastCheck: h.lastCheck };
    });
    return jsonResp({ relays: healthInfo, count: allRelays.length }, 200, C);
  }

  if (url.pathname === "/admin/batch-relays" && request.method === "POST") {
    var rb3;
    try { rb3 = await request.json(); } catch(e) { return errResp(400, "Invalid JSON"); }
    var urls = rb3.urls || [];
    var addedCount = 0;
    for (var bi = 0; bi < urls.length; bi++) {
      if (await addRelay(env, urls[bi])) addedCount++;
    }
    var pool3 = await getRelayPool(env);
    return jsonResp({ status: "ok", added: addedCount, total: pool3.length, relays: pool3 }, 200, C);
  }

  if (url.pathname === "/v1/models") {
    var list = MODELS.map(function(m) {
      return { id: m.id, object: "model", owned_by: "clawhunter-free", pricing: { image: m.cost }, capabilities: m.edit ? ["generate", "edit"] : ["generate"] };
    });
    return jsonResp({ object: "list", data: list }, 200, C);
  }

  if (url.pathname === "/v1/images/generations" && request.method === "POST") {
    var body;
    try { body = await request.json(); } catch(e) { return errResp(400, "Invalid JSON body"); }

    var model = body.model || MODELS[0].id;
    var prompt = body.prompt;
    var n = Math.min(body.n || 1, 4);
    var quality = body.quality || "medium";

    if (!prompt) return errResp(400, "prompt is required");

    var modelIds = MODELS.map(function(m) { return m.id; });
    if (modelIds.indexOf(model) === -1) {
      return errResp(400, "Model not available. Free models: " + modelIds.join(", "));
    }

    var ar = body.aspect_ratio || "1:1";
    var res = body.resolution || "1K";
    if (!body.aspect_ratio && body.size) {
      var wh = body.size.split("x").map(Number);
      if (wh[0] === wh[1]) ar = "1:1";
      else if (wh[0] === 1792 && wh[1] === 1024) ar = "16:9";
      else if (wh[0] === 1024 && wh[1] === 1792) ar = "9:16";
      else if (wh[0] === 1024 && wh[1] === 768) ar = "4:3";
      else if (wh[0] === 768 && wh[1] === 1024) ar = "3:4";
      else if (wh[0] > wh[1]) ar = "16:9";
      else ar = "9:16";
    }

    // Only send aspect_ratio for models that support it (gpt-image-2)
    // nano-banana-2 and kling-v3 do NOT support aspect_ratio
    var AR_MODELS = ["gpt-image-2"];
    var QUALITY_MODELS = ["gpt-image-2"];
    var RESOLUTION_MODELS = ["gpt-image-2", "nano-banana-2"];
    var clawReq = { prompt: prompt, model: model, n: n };
    if (AR_MODELS.indexOf(model) !== -1) clawReq.aspect_ratio = ar;
    if (QUALITY_MODELS.indexOf(model) !== -1) clawReq.quality = quality;
    if (RESOLUTION_MODELS.indexOf(model) !== -1) clawReq.resolution = res;

    var refImages = [];
    if (body.image) refImages.push(body.image);
    if (body.image_url) refImages.push(body.image_url);
    if (body.input_images && Array.isArray(body.input_images)) {
      refImages = refImages.concat(body.input_images);
    }
    if (body.reference_images && Array.isArray(body.reference_images)) {
      refImages = refImages.concat(body.reference_images);
    }
    
    if (refImages.length > 0) {
      var modelInfo = MODELS.find(function(m) { return m.id === model; });
      if (!modelInfo || !modelInfo.edit) {
        return errResp(400, "Model " + model + " does not support image editing. Use gpt-image-2 or nano-banana-2.");
      }
      clawReq.image_url = refImages[0];
      if (refImages.length > 1) {
        clawReq.input_images = refImages;
      }
    }

    // Collect relay pool from env + KV
    var relays = [];
    try { relays = await getRelayPool(env); } catch(e0) {}
    if (!Array.isArray(relays)) relays = [];
    var relaySecret = (env && env.RELAY_SECRET) || "";
    var lastErr = "";
    var dailyLimitHit = false;

    // CF edge node colos - each has different outbound IP
    // Shuffle for random distribution across edge nodes
    var COLOS = shuffle(["NRT","SIN","HKG","LAX","FRA","LHR","AMS","CDG","JFK","ORD","SFO","SEA","MIA","ATL"]);
    var MAX_COLOS = Math.min(8, COLOS.length); // Limit to stay under CF subrequest limit

    // Phase 1: Try direct requests with different edge nodes
    for (var attempt = 0; attempt < MAX_COLOS; attempt++) {
      try {
        if (!Array.isArray(pool)) pool = [];
        if (pool.length < 2) await refreshPool(3);
        var tok = await getToken();
        var clawResp = await fetch(IMAGE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-studio-token": tok },
          body: JSON.stringify(clawReq),
          cf: { colo: COLOS[attempt] }
        });

        var clawData = await clawResp.json().catch(function() { return {};
        });
        if (!clawData) clawData = {};

        // Success
        var images = clawData.images || [];
        if (clawResp.ok && !clawData.error && images.length > 0) {
          var billing = clawData.billing || {};
          var resultData = images.map(function(img) {
            if (img.url) return { url: img.url };
            // Detect actual image format from base64 data
            var b64 = img.b64_json || "";
            var mime = "image/png"; // default
            if (b64.length > 0) {
              try {
                var raw = atob(b64.substring(0, 16));
                if (raw.charCodeAt(0) === 0xFF && raw.charCodeAt(1) === 0xD8) mime = "image/jpeg";
                else if (raw.substring(0, 4) === "RIFF") mime = "image/webp";
                else if (raw.charCodeAt(0) === 0x89 && raw.substring(1, 4) === "PNG") mime = "image/png";
              } catch(e) {}
            }
            return { url: "data:" + mime + ";base64," + b64 };
          });
          return jsonResp({
            created: Math.floor(Date.now() / 1000),
            data: resultData,
            model: model
          }, 200, Object.assign({
            "X-Claw-Model": billing.model || model,
            "X-Claw-Cost": String(billing.usd || 0),
            "X-Claw-Note": billing.note || "",
            "X-Claw-Edge": "direct-" + COLOS[attempt]
          }, C));
        }

        // Parse error message
        var errMsg = "";
        if (clawData.error) {
          errMsg = (typeof clawData.error === "string") ? clawData.error : (clawData.error.message || JSON.stringify(clawData.error));
        } else if (clawResp.status === 429) {
          errMsg = "Rate limited";
        } else {
          errMsg = "HTTP " + clawResp.status;
        }
        lastErr = errMsg;
        var retrySec = clawData.retry_after_seconds || 0;

        // Daily limit on this colo - try next colo (different edge = different IP)
        if (errMsg.indexOf("daily") !== -1 || errMsg.indexOf("limit") !== -1) {
          lastErr = errMsg;
          continue; // Try next colo
        }

        // Temporary rate limit - try next colo with fresh token
        if (clawResp.status === 429) {
          pool = [];
          await refreshPool(3);
          continue;
        }

        return errResp(clawResp.status || 500, errMsg || "Generation failed");

      } catch(e) {
        return errResp(500, "Internal error: " + e.message);
      }
    }

    // Phase 2: Daily limit hit on direct - try relay Workers (shuffled for load balancing)
    if (dailyLimitHit && relays.length > 0) {
      var shuffledRelays = shuffle(relays.slice());
      for (var ri = 0; ri < shuffledRelays.length; ri++) {
        var relayUrl = shuffledRelays[ri];
        // Skip relays marked as bad
        if (relayHealth[relayUrl] && !relayHealth[relayUrl].ok) continue;
        try {
          var relayResult = await relayFetch(relayUrl, clawReq, relaySecret);
          var rd = relayResult.data;

          // Relay success
          var rdImages = rd.images || [];
          if (relayResult.status === 200 && !rd.error && rdImages.length > 0) {
            markRelayGood(relayUrl);
            var billing2 = rd.billing || {};
            var resultData2 = rdImages.map(function(img) {
              if (img.url) return { url: img.url };
              var b64r = img.b64_json || "";
              var mime2 = "image/png";
              if (b64r.length > 0) {
                try {
                  var raw2 = atob(b64r.substring(0, 16));
                  if (raw2.charCodeAt(0) === 0xFF && raw2.charCodeAt(1) === 0xD8) mime2 = "image/jpeg";
                  else if (raw2.substring(0, 4) === "RIFF") mime2 = "image/webp";
                } catch(e) {}
              }
              return { url: "data:" + mime2 + ";base64," + b64r };
            });
            return jsonResp({
              created: Math.floor(Date.now() / 1000),
              data: resultData2,
              model: model
            }, 200, Object.assign({
              "X-Claw-Model": billing2.model || model,
              "X-Claw-Cost": String(billing2.usd || 0),
              "X-Claw-Note": billing2.note || "",
              "X-Claw-Edge": "relay-" + (ri + 1)
            }, C));
          }

          // Relay also failed - mark as bad and try next
          markRelayBad(relayUrl);
          var relayErr = "";
          if (rd.error) {
            relayErr = (typeof rd.error === "string") ? rd.error : (rd.error.message || JSON.stringify(rd.error));
          } else {
            relayErr = "HTTP " + relayResult.status;
          }
          lastErr = relayErr;
          continue;

        } catch(e) {
          markRelayBad(relayUrl);
          lastErr = "Relay error: " + e.message;
          continue;
        }
      }
    }

    // All attempts exhausted - provide helpful error with relay setup guide
    var retrySec2 = 0;
    if (lastErr.indexOf("resets in") !== -1) {
      var m = lastErr.match(/resets in (\d+)h/);
      if (m) retrySec2 = parseInt(m[1]) * 3600;
    }
    var resetTime = retrySec2 > 0 ? Math.ceil(retrySec2 / 3600) + "h" : "~23h";
    var relayCount = relays.length;
    var helpMsg = lastErr;
    if (retrySec2 > 0) {
      helpMsg += " — resets in " + resetTime;
    }
    if (relayCount === 0) {
      helpMsg += ". Deploy relays for more IPs: ./deploy-relays.sh all";
    } else {
      helpMsg += " (" + relayCount + " relays also limited)";
    }
    return errResp(429, helpMsg);
  }

  return errResp(404, "Not found");
}

export default {
  fetch: async function(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch(e) {
      return errResp(500, "Worker error: " + e.message);
    }
  }
};
