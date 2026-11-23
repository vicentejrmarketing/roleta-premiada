(() => {
'use strict';
const KEY = 'edc_roleta_v3';
const DEFAULTS = {
  prizes: [
    { label: '10% OFF em acessórios', weight: 20, active: true },
    { label: 'Película grátis', weight: 18, active: true },
    { label: 'R$ 100 OFF no celular novo', weight: 5, active: true },
    { label: 'Capinha grátis', weight: 15, active: true },
    { label: 'Carregador', weight: 6, active: true },
    { label: 'R$ 50 OFF no celular novo', weight: 10, active: true },
    { label: 'Fone Bluetooth', weight: 2, active: true }
  ],
  whatsapp: '', validity: 7, limit: false, pin: '1234'
};
const clone = o => JSON.parse(JSON.stringify(o));
let mem = null;
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return Object.assign(clone(DEFAULTS), { people: [], played: null }, JSON.parse(raw)); } catch (e) {}
  return mem || Object.assign(clone(DEFAULTS), { people: [], played: null });
}
let S = load();
function save() { mem = S; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

/* ---------- servidor (Supabase) ---------- */
const API_URL = 'https://ziuxfcxkpovnplrxofxz.supabase.co/rest/v1/rpc/';
const API_KEY = 'sb_publishable_D6Po0ZWEHrQSylbAhbQ85g_gaDyyvwX';
async function rpc(fn, body) {
  const r = await fetch(API_URL + fn, { method: 'POST', headers: { apikey: API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
let adminPin = null;
const ERR = { pin: 'Senha incorreta.', bloqueado: 'Muitas tentativas erradas. Aguarde 15 minutos.', premios: 'Mantenha de 2 a 16 prêmios.', formato: 'A senha deve ter de 4 a 20 caracteres: letras, números ou hífen.', arquivo: 'Formato de vídeo não aceito.', tamanho: 'Arquivo grande demais.' };
function applyRemote(cfg) {
  if (!cfg || !Array.isArray(cfg.prizes)) return false;
  const before = JSON.stringify([S.prizes, S.whatsapp, S.validity, S.limit]);
  S.prizes = cfg.prizes; S.whatsapp = cfg.whatsapp || ''; S.validity = cfg.validity || 7; S.limit = !!cfg.limit;
  save();
  return before !== JSON.stringify([S.prizes, S.whatsapp, S.validity, S.limit]);
}
async function syncConfig(force) {
  if (spinning && !force) return;
  try {
    const cfg = await rpc('roleta_get_config');
    if (applyRemote(cfg)) { highlight = -1; drawWheel(); strip(); }
    if (cfg && 'mascot' in cfg) loadMascot(cfg.mascot || null);
  } catch (e) {}
}
function cfgPayload() { return { prizes: S.prizes, whatsapp: S.whatsapp, validity: S.validity, limit: S.limit }; }
async function pushConfig(okMsg) {
  try {
    const r = await rpc('roleta_admin_save', { p_pin: adminPin, p_cfg: cfgPayload() });
    if (r && r.ok) { if (okMsg) toast(okMsg); return true; }
    toast(ERR[r && r.error] || 'Não foi possível salvar.'); return false;
  } catch (e) { toast('Sem conexão. Tente salvar novamente.'); return false; }
}

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const active = () => S.prizes.filter(p => p.active && p.label.trim());

/* ---------- toast ---------- */
let tT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(tT); tT = setTimeout(() => el.classList.remove('show'), 2600); }

/* ---------- áudio ---------- */
let AC = null, muted = false;
function audio() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { AC = null; } }
function beep(f, d, v, type) {
  if (!AC || muted) return;
  try {
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + 0.02);
  } catch (e) {}
}
const tickSound = () => beep(1500, 0.035, 0.035, 'square');
function winSound() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.28, 0.06, 'triangle'), i * 110)); }

/* ---------- roleta ---------- */
const cv = $('#wheel'), stage = $('#stage'), pointer = $('#pointer');
let rot = 0, spinning = false, highlight = -1;

function wrapText(c, text, maxW, fs, minFs) {
  const words = text.toUpperCase().split(/\s+/);
  for (let size = fs; size >= minFs; size -= 0.5) {
    c.font = `800 ${size}px Montserrat, sans-serif`;
    const lines = []; let cur = '';
    let ok = true;
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (c.measureText(test).width <= maxW) cur = test;
      else { if (cur) lines.push(cur); cur = w; if (c.measureText(w).width > maxW) ok = false; }
    }
    if (cur) lines.push(cur);
    if (ok && lines.length <= 2) return { lines, size };
    if (size - 0.5 < minFs) return { lines: lines.slice(0, 3), size };
  }
  return { lines: [text.toUpperCase()], size: minFs };
}

function drawWheel() {
  const list = active(); const n = Math.max(list.length, 1);
  const size = cv.clientWidth; if (!size) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr);
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = size / 2, seg = Math.PI * 2 / n;
  c.clearRect(0, 0, size, size);
  c.save(); c.translate(R, R);

  for (let i = 0; i < n; i++) {
    const mid = -Math.PI / 2 + i * seg, a0 = mid - seg / 2, a1 = mid + seg / 2;
    const yellow = i % 2 === 0;
    const g = c.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
    if (yellow) { g.addColorStop(0, '#FFEA00'); g.addColorStop(0.7, '#FFD400'); g.addColorStop(1, '#F2C900'); }
    else { g.addColorStop(0, '#1f1f1f'); g.addColorStop(0.65, '#151515'); g.addColorStop(1, '#080808'); }
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R, a0, a1); c.closePath();
    c.fillStyle = g; c.fill();
    if (i === highlight) {
      c.save(); c.clip();
      c.fillStyle = yellow ? 'rgba(255,255,255,.28)' : 'rgba(255,212,0,.16)'; c.fillRect(-R, -R, size, size);
      c.restore();
    }
    // separador
    c.strokeStyle = yellow ? 'rgba(8,8,8,.55)' : 'rgba(255,212,0,.35)'; c.lineWidth = 1.5; c.stroke();
  }
  // destaque do vencedor (contorno luminoso)
  if (n % 2 === 1 && n > 1) {
    const a = -Math.PI / 2 - seg / 2;
    c.save(); c.beginPath(); c.moveTo(Math.cos(a) * R * 0.25, Math.sin(a) * R * 0.25); c.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    c.strokeStyle = '#080808'; c.lineWidth = Math.max(5, R * 0.03); c.lineCap = 'round'; c.stroke(); c.restore();
  }
  if (highlight >= 0 && highlight < n) {
    const mid = -Math.PI / 2 + highlight * seg;
    c.save(); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R - 3, mid - seg / 2, mid + seg / 2); c.closePath();
    c.shadowColor = '#FFEA00'; c.shadowBlur = 24; c.strokeStyle = '#FFEA00'; c.lineWidth = 5; c.stroke(); c.restore();
  }
  // textos
  const hubR = R * 0.3;
  for (let i = 0; i < n; i++) {
    const p = list[i]; if (!p) continue;
    const mid = -Math.PI / 2 + i * seg, yellow = i % 2 === 0;
    c.save(); c.rotate(mid);
    const maxW = R * 0.88 - hubR - R * 0.06;
    const base = Math.min(R * 0.072, R * seg * 0.21);
    const { lines, size: fs } = wrapText(c, p.label, maxW, base, Math.max(9, base * 0.62));
    c.font = `800 ${fs}px Montserrat, sans-serif`;
    c.textAlign = 'right'; c.textBaseline = 'middle';
    c.fillStyle = yellow ? '#080808' : '#FFD400';
    if (!yellow) { c.shadowColor = 'rgba(255,212,0,.35)'; c.shadowBlur = 8; }
    const lh = fs * 1.12, y0 = -((lines.length - 1) * lh) / 2;
    lines.forEach((ln, k) => c.fillText(ln, R * 0.88, y0 + k * lh));
    c.restore();
  }
  // pinos na borda
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * seg - seg / 2;
    c.beginPath(); c.arc(Math.cos(a) * (R - 9), Math.sin(a) * (R - 9), Math.max(3, R * 0.016), 0, Math.PI * 2);
    c.fillStyle = '#FFEA00'; c.shadowColor = '#FFD400'; c.shadowBlur = 6; c.fill(); c.shadowBlur = 0;
    c.lineWidth = 1.5; c.strokeStyle = '#080808'; c.stroke();
  }
  // anel interno
  c.beginPath(); c.arc(0, 0, hubR, 0, Math.PI * 2); c.lineWidth = 2; c.strokeStyle = 'rgba(255,212,0,.6)'; c.stroke();
  c.beginPath(); c.arc(0, 0, R - 1.5, 0, Math.PI * 2); c.lineWidth = 3; c.strokeStyle = '#080808'; c.stroke();
  c.restore();

  $('#wheelNote').innerHTML = `<b>${list.length}</b> prêmios esperando por você`;
}
function applyRot() { cv.style.transform = `rotate(${rot}rad)`; }

/* lâmpadas */
const BULBS = 28; const bulbs = [];
function buildBulbs() {
  const rim = $('#rim'); rim.querySelectorAll('.bulb').forEach(b => b.remove()); bulbs.length = 0;
  const S_ = rim.clientWidth; const r = S_ / 2 - (S_ < 420 ? 11 : 15);
  for (let i = 0; i < BULBS; i++) {
    const b = document.createElement('i'); b.className = 'bulb';
    const a = i / BULBS * Math.PI * 2;
    b.style.transform = `translate(${Math.sin(a) * r}px, ${-Math.cos(a) * r}px)`;
    rim.appendChild(b); bulbs.push(b);
  }
}
let lightMode = 'idle', lightStep = 0, lightTimer = null;
function lights(mode) {
  lightMode = mode; clearInterval(lightTimer);
  const speed = mode === 'spin' ? 55 : mode === 'win' ? 140 : 520;
  const run = () => {
    lightStep++;
    bulbs.forEach((b, i) => {
      let on;
      if (mode === 'spin') on = (i + lightStep) % 4 === 0 || (i + lightStep) % 4 === 1;
      else if (mode === 'win') on = lightStep % 2 === 0;
      else on = (i + lightStep) % 2 === 0;
      b.classList.toggle('on', on);
    });
  };
  run(); lightTimer = setInterval(run, speed);
}

function pickIndex(list) {
  const total = list.reduce((s, p) => s + Math.max(0, +p.weight || 0), 0);
  if (total <= 0) return Math.floor(Math.random() * list.length);
  let r = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 : Math.random()) * total;
  for (let i = 0; i < list.length; i++) { r -= Math.max(0, +list[i].weight || 0); if (r < 0) return i; }
  return list.length - 1;
}

function spinTo(idx, n) {
  return new Promise(res => {
    const seg = Math.PI * 2 / n, TAU = Math.PI * 2;
    const jitter = (Math.random() - 0.5) * seg * 0.62;
    const k = Math.ceil((rot + 7 * TAU + idx * seg) / TAU);
    const target = TAU * k - idx * seg + jitter;
    const start = rot, delta = target - start, dur = 6200 + Math.random() * 800;
    const t0 = performance.now();
    let lastTick = Math.floor((start + seg / 2) / seg);
    const ease = t => 1 - Math.pow(1 - t, 4.2);
    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      rot = start + delta * ease(t); applyRot();
      const tk = Math.floor((rot + seg / 2) / seg);
      if (tk !== lastTick) {
        lastTick = tk; tickSound();
        pointer.classList.remove('tick'); void pointer.offsetWidth; pointer.classList.add('tick');
      }
      if (t < 1) requestAnimationFrame(frame); else { rot = target % TAU; applyRot(); res(); }
    }
    requestAnimationFrame(frame);
  });
}

/* ---------- mascote (vídeo com transparência: cor em cima, máscara embaixo) ---------- */
const MKEY = 'edc_mascote_v1';
const mVid = $('#mascotVid'), mCvs = $('#mascot');
let mascotV = null, mascotURL = null, glm = null, mLoop = false;
function b64ToBlob(b64, mime) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}
function setupGL() {
  let gl = null;
  try { gl = mCvs.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true }); } catch (e) {}
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D t;void main(){vec3 c=texture2D(t,vec2(v.x,v.y*.5)).rgb;float a=texture2D(t,vec2(v.x,.5+v.y*.5)).r;gl_FragColor=vec4(min(c,vec3(a)),a);}'));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.clearColor(0, 0, 0, 0);
  return gl;
}
function drawMascot() {
  if (!glm || mVid.readyState < 2 || !mCvs.width) return;
  try {
    glm.viewport(0, 0, mCvs.width, mCvs.height);
    glm.texImage2D(glm.TEXTURE_2D, 0, glm.RGB, glm.RGB, glm.UNSIGNED_BYTE, mVid);
    glm.clear(glm.COLOR_BUFFER_BIT); glm.drawArrays(glm.TRIANGLE_STRIP, 0, 4);
  } catch (e) {}
  if (winModal.classList.contains('show')) drawWinMascot();
}
const winModal = $('#winModal'), wCvs = $('#winMascot'), wCtx = wCvs.getContext('2d');
function drawWinMascot() {
  if (!mCvs.width) return;
  if (wCvs.width !== mCvs.width || wCvs.height !== mCvs.height) { wCvs.width = mCvs.width; wCvs.height = mCvs.height; }
  wCtx.clearRect(0, 0, wCvs.width, wCvs.height); wCtx.drawImage(mCvs, 0, 0);
}
function mascotTick() {
  drawMascot();
  if ('requestVideoFrameCallback' in mVid) mVid.requestVideoFrameCallback(mascotTick);
  else requestAnimationFrame(mascotTick);
}
function showMascot(url) {
  if (!glm) glm = setupGL();
  if (!glm) return;
  if (mascotURL) URL.revokeObjectURL(mascotURL);
  mascotURL = url;
  mVid.onloadeddata = () => {
    mCvs.width = mVid.videoWidth; mCvs.height = Math.round(mVid.videoHeight / 2);
    mCvs.style.aspectRatio = mCvs.width + ' / ' + mCvs.height;
    stage.classList.add('has-mascot'); drawMascot();
    mVid.play().catch(() => {});
    if (!mLoop) { mLoop = true; mascotTick(); }
  };
  mVid.src = url; mVid.load();
}
function hideMascot() {
  stage.classList.remove('has-mascot');
  mVid.pause(); mVid.removeAttribute('src'); mVid.load();
  if (mascotURL) { URL.revokeObjectURL(mascotURL); mascotURL = null; }
  try { localStorage.removeItem(MKEY); } catch (e) {}
}
async function loadMascot(v) {
  if (!v) { if (mascotV) hideMascot(); mascotV = null; return; }
  if (v === mascotV) return;
  let a = null;
  try { const c = JSON.parse(localStorage.getItem(MKEY) || 'null'); if (c && c.v === v && c.b64) a = c; } catch (e) {}
  if (!a) {
    try { a = await rpc('roleta_get_asset', { p_name: 'mascote' }); } catch (e) { return; }
    if (!a || !a.b64) return;
    try { localStorage.setItem(MKEY, JSON.stringify(a)); } catch (e) {}
  }
  mascotV = v;
  showMascot(URL.createObjectURL(b64ToBlob(a.b64, a.mime || 'video/mp4')));
}
document.addEventListener('pointerdown', () => { if (mascotV && mVid.paused && mVid.src) mVid.play().catch(() => {}); });

/* ---------- formulário ---------- */
const phoneEl = $('#phone');
function maskPhone(el) {
  let d = el.value.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  let out = d;
  if (d.length > 2) out = `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length > 7) out = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
  el.value = out;
}
phoneEl.removeAttribute('maxlength');
phoneEl.addEventListener('input', () => maskPhone(phoneEl));
function fieldErr(id, text) {
  const f = $(id); f.classList.remove('err'); void f.offsetWidth; f.classList.add('err');
  const m = $('#msg'); m.querySelector('span').textContent = text; m.classList.add('show');
}
['#name', '#phone'].forEach(s => $(s).addEventListener('input', () => { $(s).parentElement.classList.remove('err'); $('#msg').classList.remove('show'); }));

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
  const r = crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(6)) : Array.from({ length: 6 }, () => Math.random() * 256);
  for (let i = 0; i < 6; i++) s += A[r[i] % A.length];
  return 'EDC-' + s;
}

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  if (spinning) return;
  const btn = $('#spin');
  btn.classList.remove('press'); void btn.offsetWidth; btn.classList.add('press');
  const ring = btn.querySelector('.ring'); ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go');
  audio();
  const name = $('#name').value.trim(), phone = phoneEl.value.replace(/\D/g, '');
  if (name.length < 2) { fieldErr('#f-name', 'Preencha seu nome para girar a roleta.'); $('#name').focus(); return; }
  if (phone.length < 10) { fieldErr('#f-phone', 'Preencha seu WhatsApp com DDD para girar a roleta.'); phoneEl.focus(); return; }
  if (S.limit && S.played) { showWin(S.played, true); return; }
  spinning = true; btn.disabled = true;
  const stop = msg => { spinning = false; btn.disabled = false; if (msg) toast(msg); };
  await Promise.race([syncConfig(true), new Promise(r => setTimeout(r, 1500))]);
  // o servidor confere se o WhatsApp já participou, sorteia o prêmio e registra
  let res = null;
  try { res = await rpc('roleta_spin', { p_name: name, p_phone: phoneEl.value, p_optin: $('#optin').checked }); } catch (err) {}
  if (!res) return stop('Sem conexão. Verifique a internet e tente novamente.');
  if (res.error === 'repetido') {
    stop();
    const prev = { name: res.name || name, phone: phoneEl.value, prize: res.prize, code: res.code, date: res.date, repeat: true };
    S.played = prev; save(); showWin(prev, true); return;
  }
  if (res.error === 'nome') { stop(); return fieldErr('#f-name', 'Preencha seu nome para girar a roleta.'); }
  if (res.error === 'telefone') { stop(); return fieldErr('#f-phone', 'Confira o WhatsApp: informe o DDD + número.'); }
  if (!res.ok) return stop('A roleta está em manutenção. Volte em instantes!');
  let list = active(), idx = list.findIndex(p => p.label === res.prize);
  if (idx < 0) { await syncConfig(true); list = active(); idx = list.findIndex(p => p.label === res.prize); }
  if (idx < 0) idx = 0;

  highlight = -1; drawWheel();
  stage.classList.add('spinning'); lights('spin');
  if (window.matchMedia('(max-width:980px)').matches) stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await spinTo(idx, list.length);
  stage.classList.remove('spinning'); lights('win');
  highlight = idx; drawWheel(); winSound();
  const rec = { name, phone: phoneEl.value, prize: res.prize, code: res.code, date: res.date || new Date().toISOString(), optin: $('#optin').checked };
  S.people.unshift(rec); S.played = rec; save();
  setTimeout(() => { showWin(rec, false); spinning = false; btn.disabled = false; }, 1100);
  setTimeout(() => lights('idle'), 4000);
});

/* ---------- tela de ganhador ---------- */
function showWin(rec, again) {
  const first = (rec.name || '').split(' ')[0];
  $('#winTitle').textContent = again ? 'VOCÊ JÁ GIROU A ROLETA!' : 'PARABÉNS, VOCÊ GANHOU!';
  $('#winSub').textContent = again ? (rec.repeat ? `${first ? first + ', este' : 'Este'} WhatsApp já participou da promoção. Cada número pode girar só uma vez. Seu prêmio continua garantido:` : `${first ? first + ', s' : 'S'}eu prêmio continua garantido:`) : (first ? `${first}, seu prêmio já está reservado.` : 'Seu prêmio já está reservado!');
  $('#winPrize').textContent = rec.prize;
  $('#winCode').textContent = rec.code;
  const until = new Date(new Date(rec.date).getTime() + S.validity * 864e5);
  $('#winFine').textContent = `Válido até ${until.toLocaleDateString('pt-BR')}. Apresente o código em uma loja Espaço do Celular.`;
  const wa = String(S.whatsapp || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  const waEl = $('#waNum');
  if (wa.length >= 10) { const m = wa.match(/^(\d{2})(\d{4,5})(\d{4})$/); waEl.textContent = 'WhatsApp da loja: ' + (m ? `(${m[1]}) ${m[2]}-${m[3]}` : wa); waEl.classList.add('show'); }
  else waEl.classList.remove('show');
  const hasM = stage.classList.contains('has-mascot');
  $('#winWrap').classList.toggle('has-m', hasM);
  open('#winModal');
  if (hasM) { drawWinMascot(); if (mVid.paused) mVid.play().catch(() => {}); }
  if (!again) confetti();
}
function copy(text, msg) {
  try { navigator.clipboard.writeText(text).then(() => toast(msg || 'Copiado!'), () => toast('Seu código: ' + text)); }
  catch (e) { toast('Seu código: ' + text); }
}
$('#copyCode').addEventListener('click', () => copy($('#winCode').textContent, 'Código copiado!'));

function open(sel) { $(sel).classList.add('show'); }
function close(el) { el.classList.remove('show'); }
$$('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) close(o); });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.overlay.show').forEach(close); });

/* ---------- confetes ---------- */
const cc = $('#confetti'), cx = cc.getContext('2d'); let parts = [], confRaf = null;
function confetti() {
  const W = cc.width = innerWidth * (devicePixelRatio > 1 ? 2 : 1), H = cc.height = innerHeight * (devicePixelRatio > 1 ? 2 : 1);
  const sc = W / innerWidth;
  const cols = ['#FFD400', '#FFEA00', '#FFFFFF', '#FFD400', '#FFEA00'];
  const burst = (x, y, n, spread) => {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * spread, v = (7 + Math.random() * 11) * sc;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: (6 + Math.random() * 8) * sc, h: (8 + Math.random() * 10) * sc,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35, c: cols[i % cols.length], shape: Math.random() < 0.25 ? 'c' : 'r', life: 0, wob: Math.random() * 10 });
    }
  };
  burst(W * 0.5, H * 0.62, 160, 2.2);
  setTimeout(() => { burst(0, H * 0.8, 90, 1.2); }, 250);
  setTimeout(() => { burst(W, H * 0.8, 90, 1.2); }, 250);
  setTimeout(() => { for (let i = 0; i < 120; i++) parts.push({ x: Math.random() * W, y: -20 * sc, vx: (Math.random() - 0.5) * 2 * sc, vy: (2 + Math.random() * 3) * sc,
    w: (6 + Math.random() * 7) * sc, h: (8 + Math.random() * 9) * sc, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[i % cols.length], shape: Math.random() < 0.25 ? 'c' : 'r', life: 0, wob: Math.random() * 10 }); }, 700);
  if (!confRaf) loop();
  function loop() {
    cx.clearRect(0, 0, W, H);
    parts.forEach(p => {
      p.life++; p.vy += 0.22 * sc; p.vx *= 0.985; p.vy *= 0.985; p.wob += 0.12;
      p.x += p.vx + Math.sin(p.wob) * 0.8 * sc; p.y += p.vy; p.r += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c;
      if (p.shape === 'c') { cx.beginPath(); cx.arc(0, 0, p.w / 2.4, 0, Math.PI * 2); cx.fill(); }
      else { cx.scale(1, Math.abs(Math.cos(p.wob))); cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
      cx.restore();
    });
    parts = parts.filter(p => p.y < H + 40 && p.life < 600);
    if (parts.length) confRaf = requestAnimationFrame(loop); else { cx.clearRect(0, 0, W, H); confRaf = null; }
  }
}

/* ---------- faixa ---------- */
function strip() {
  const items = active().map(p => `<span>${esc(p.label.toUpperCase())}</span>`).join('');
  $('#strip').innerHTML = items + items + items + items;
}

/* ---------- admin ---------- */
const adminEl = $('#admin');
$('#openAdmin').addEventListener('click', () => { $('#pin').value = ''; $('#pinMsg').classList.remove('show'); open('#pinModal'); setTimeout(() => $('#pin').focus(), 50); });
$('#pinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pin = $('#pin').value.trim().toUpperCase(), b = $('#pinForm .btn-main');
  b.disabled = true;
  let r = null; try { r = await rpc('roleta_admin_login', { p_pin: pin }); } catch (err) {}
  b.disabled = false;
  if (r && r.ok) { adminPin = pin; close($('#pinModal')); openAdmin(); }
  else { $('#pinMsg span').textContent = r ? (ERR[r.error] || 'Senha incorreta.') : 'Sem conexão. Tente novamente.'; $('#pinMsg').classList.add('show'); $('#pin').select(); }
});
async function loadPeople() {
  try {
    const r = await rpc('roleta_admin_participants', { p_pin: adminPin });
    if (r && Array.isArray(r.rows)) { S.people = r.rows; renderPeople(); renderStats(); }
  } catch (e) {}
}
async function openAdmin() {
  parts = []; adminEl.classList.add('show'); document.body.style.overflow = 'hidden';
  $('#tab-people .p-head p').textContent = 'Todos os giros, de todos os aparelhos.';
  $('#tab-config .p-head p').textContent = 'As alterações valem na hora para todos os clientes.';
  renderAdmin();
  await syncConfig(true); renderAdmin(); loadPeople();
}
function closeAdmin() { adminEl.classList.remove('show'); document.body.style.overflow = ''; adminPin = null; }
$('#logout').addEventListener('click', closeAdmin);
$('#viewSite').addEventListener('click', closeAdmin);
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('on', x === t));
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + t.dataset.tab));
  if (t.dataset.tab === 'people' && adminPin) loadPeople();
}));

let draft = [];
function renderAdmin() {
  draft = clone(S.prizes); renderPrizes(); renderPeople(); renderStats();
  $('#cfgWa').value = S.whatsapp || ''; $('#cfgDays').value = S.validity; $('#cfgLimit').checked = !!S.limit; $('#cfgPin').value = '';
  $('#mascotSt').textContent = mascotV ? 'Mascote no ar ✓' : 'Nenhum mascote enviado.';
}
function renderStats() {
  const ppl = S.people; const today = new Date().toDateString();
  $('#stTotal').textContent = ppl.length;
  $('#stToday').textContent = ppl.filter(p => new Date(p.date).toDateString() === today).length;
  $('#stActive').textContent = active().length;
  const cnt = {}; ppl.forEach(p => cnt[p.prize] = (cnt[p.prize] || 0) + 1);
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  $('#stTop').textContent = top ? `${top[0]} (${top[1]})` : '—';
}
function renderPrizes() {
  const act = draft.filter(p => p.active);
  const total = act.reduce((s, p) => s + Math.max(0, +p.weight || 0), 0);
  let ai = 0;
  $('#prizeRows').innerHTML = draft.map((p, i) => {
    const pct = p.active && total ? (Math.max(0, +p.weight || 0) / total * 100) : 0;
    const color = p.active ? (ai++ % 2 === 0 ? 'y' : 'k') : '';
    return `<tr>
      <td>${p.active ? `<div class="swatch ${color}"></div>` : '<div class="swatch" style="opacity:.25"></div>'}</td>
      <td><input class="in" data-i="${i}" data-k="label" value="${esc(p.label)}" maxlength="34"></td>
      <td><input class="in num" type="number" min="0" max="1000" data-i="${i}" data-k="weight" value="${+p.weight || 0}"></td>
      <td><span class="pct">${pct.toFixed(1).replace('.', ',')}%</span><div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div></td>
      <td><label class="sw"><input type="checkbox" data-i="${i}" data-k="active" ${p.active ? 'checked' : ''}><span></span></label></td>
      <td><button class="icon-btn" data-del="${i}" title="Remover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></td>
    </tr>`;
  }).join('');
  const w = [];
  if (act.length % 2 === 1) w.push('Use um número par de prêmios ativos para manter a alternância perfeita entre preto e amarelo.');
  if (act.length < 4) w.push('Recomendamos ao menos 4 prêmios ativos.');
  if (act.length > 12) w.push('Mais de 12 prêmios deixa os textos pequenos demais na roleta.');
  if (total === 0 && act.length) w.push('Todos os pesos estão zerados: o sorteio será aleatório.');
  $('#prizeWarn').innerHTML = w.join('<br>'); $('#prizeWarn').classList.toggle('show', w.length > 0);
}
$('#prizeRows').addEventListener('input', e => {
  const el = e.target; if (!el.dataset.k) return; const p = draft[+el.dataset.i];
  if (el.dataset.k === 'active') { p.active = el.checked; renderPrizes(); }
  else if (el.dataset.k === 'weight') { p.weight = Math.max(0, +el.value || 0); refreshPct(); }
  else p.label = el.value;
});
function refreshPct() {
  const act = draft.filter(p => p.active); const total = act.reduce((s, p) => s + Math.max(0, +p.weight || 0), 0);
  $$('#prizeRows tr').forEach((tr, i) => {
    const p = draft[i]; const pct = p.active && total ? p.weight / total * 100 : 0;
    tr.querySelector('.pct').textContent = pct.toFixed(1).replace('.', ',') + '%';
    tr.querySelector('.bar i').style.width = Math.min(100, pct) + '%';
  });
}
$('#prizeRows').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  draft.splice(+b.dataset.del, 1); renderPrizes();
});
$('#addPrize').addEventListener('click', () => {
  if (draft.length >= 16) return toast('Limite de 16 prêmios.');
  draft.push({ label: 'Novo prêmio', weight: 10, active: true }); renderPrizes();
  const ins = $$('#prizeRows input[data-k="label"]'); const last = ins[ins.length - 1]; last.focus(); last.select();
});
$('#savePrizes').addEventListener('click', async () => {
  const act = draft.filter(p => p.active && p.label.trim());
  if (act.length < 2) return toast('Mantenha pelo menos 2 prêmios ativos.');
  const prev = S.prizes, b = $('#savePrizes');
  S.prizes = draft.map(p => ({ label: p.label.trim() || 'Prêmio', weight: Math.max(0, +p.weight || 0), active: !!p.active }));
  b.disabled = true; b.textContent = 'Salvando...';
  const ok = await pushConfig('Prêmios salvos! A roleta foi atualizada para todos os clientes.');
  b.disabled = false; b.textContent = 'Salvar alterações';
  if (ok) { save(); highlight = -1; drawWheel(); strip(); renderStats(); }
  else S.prizes = prev;
});

function renderPeople() {
  const rows = S.people.map(p => `<tr><td data-l="Prêmio"><span class="pz">${esc(p.prize || '—')}</span></td><td data-l="Nome">${p.name ? esc(p.name) : '<span class="nm-empty">Não informado</span>'}</td><td data-l="WhatsApp">${p.phone ? esc(p.phone) : '<span class="nm-empty">Não informado</span>'}</td><td data-l="Código" style="font-weight:800;letter-spacing:.08em">${esc(p.code)}</td><td data-l="Data" style="color:var(--muted)">${new Date(p.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td></tr>`).join('');
  $('#peopleRows').innerHTML = rows || `<tr><td colspan="5"><div class="empty">Nenhum participante ainda. Os giros aparecem aqui em tempo real.</div></td></tr>`;
}
$('#copyCsv').addEventListener('click', () => {
  if (!S.people.length) return toast('Nenhum participante para exportar.');
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const csv = ['Prêmio;Nome;WhatsApp;Código;Data;Aceita ofertas', ...S.people.map(p => [p.prize, p.name, p.phone, p.code, new Date(p.date).toLocaleString('pt-BR'), p.optin ? 'Sim' : 'Não'].map(q).join(';'))].join('\n');
  copy(csv, 'CSV copiado! Cole em uma planilha.');
});
let clearArm = 0;
$('#clearPeople').addEventListener('click', e => {
  if (Date.now() - clearArm > 3000) { clearArm = Date.now(); e.target.textContent = 'Confirmar limpeza'; setTimeout(() => e.target.textContent = 'Limpar lista', 3000); return; }
  e.target.textContent = 'Limpar lista';
  rpc('roleta_admin_clear', { p_pin: adminPin }).then(r => {
    if (r && r.ok) { S.people = []; save(); renderPeople(); renderStats(); toast('Lista de participantes limpa.'); }
    else toast(ERR[r && r.error] || 'Não foi possível limpar.');
  }, () => toast('Sem conexão. Tente novamente.'));
});
let cfgT;
function queueCfg(msg) { save(); clearTimeout(cfgT); cfgT = setTimeout(() => pushConfig(msg || 'Configuração salva para todos os clientes.'), 800); }
$('#cfgWa').addEventListener('input', e => { S.whatsapp = e.target.value.replace(/\D/g, ''); queueCfg(); });
$('#cfgDays').addEventListener('input', e => { const v = Math.min(90, Math.max(1, parseInt(e.target.value) || 7)); S.validity = v; queueCfg(); });
$('#cfgLimit').addEventListener('change', e => { S.limit = e.target.checked; queueCfg(S.limit ? 'Limite de 1 giro ativado.' : 'Giros ilimitados ativados.'); });
$('#unlock').addEventListener('click', () => { S.played = null; save(); toast('Novo giro liberado neste aparelho.'); });
$('#savePin').addEventListener('click', () => {
  const v = $('#cfgPin').value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,20}$/.test(v)) return toast(ERR.formato);
  rpc('roleta_admin_set_pin', { p_pin: adminPin, p_new: v }).then(r => {
    if (r && r.ok) { adminPin = v; $('#cfgPin').value = ''; toast('Senha atualizada em todos os aparelhos!'); }
    else toast(ERR[r && r.error] || 'Não foi possível trocar o PIN.');
  }, () => toast('Sem conexão. Tente novamente.'));
});
$('#mascotFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (f.size > 4400000) return toast('Arquivo grande demais (máximo 4 MB).');
  const url = URL.createObjectURL(f);
  const dims = await new Promise(res => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'metadata';
    v.onloadedmetadata = () => res([v.videoWidth, v.videoHeight]); v.onerror = () => res(null); v.src = url;
  });
  URL.revokeObjectURL(url);
  if (!dims) return toast('Não consegui ler esse vídeo.');
  if (dims[1] / dims[0] < 1.83) return toast('Use o arquivo mascote.mp4 preparado (com o fundo já removido).');
  const st = $('#mascotSt'); st.textContent = 'Enviando...';
  try {
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
    const r = await rpc('roleta_admin_set_asset', { p_pin: adminPin, p_name: 'mascote', p_mime: f.type || 'video/mp4', p_b64: b64 });
    if (r && r.ok) {
      try { localStorage.removeItem(MKEY); } catch (err) {}
      mascotV = null; await syncConfig(true);
      st.textContent = 'Mascote no ar ✓'; toast('Mascote enviado! Já aparece para todos os clientes.');
    } else { st.textContent = ''; toast(ERR[r && r.error] || 'Não foi possível enviar.'); }
  } catch (err) { st.textContent = ''; toast('Sem conexão. Tente novamente.'); }
});
$('#mascotDel').addEventListener('click', async () => {
  if (!mascotV) return toast('Nenhum mascote no ar.');
  try {
    const r = await rpc('roleta_admin_delete_asset', { p_pin: adminPin, p_name: 'mascote' });
    if (r && r.ok) { loadMascot(null); $('#mascotSt').textContent = 'Nenhum mascote enviado.'; toast('Mascote removido.'); }
    else toast(ERR[r && r.error] || 'Não foi possível remover.');
  } catch (e) { toast('Sem conexão. Tente novamente.'); }
});
let resetArm = 0;
$('#resetAll').addEventListener('click', e => {
  if (Date.now() - resetArm > 3000) { resetArm = Date.now(); e.target.textContent = 'Confirmar'; setTimeout(() => e.target.textContent = 'Restaurar', 3000); return; }
  e.target.textContent = 'Restaurar';
  const prev = clone(S), d = clone(DEFAULTS);
  S.prizes = d.prizes; S.whatsapp = d.whatsapp; S.validity = d.validity; S.limit = d.limit;
  pushConfig('Configurações restauradas para todos os clientes.').then(ok => {
    if (!ok) S = prev;
    save(); highlight = -1; drawWheel(); strip(); renderAdmin();
  });
});

/* ---------- init ---------- */
function layout() { drawWheel(); applyRot(); buildBulbs(); lights(lightMode === 'spin' ? 'spin' : 'idle'); }
let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (!spinning) layout(); else drawWheel(); }, 120); });
strip();
(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(layout);
layout();
try { const c = JSON.parse(localStorage.getItem(MKEY) || 'null'); if (c && c.b64 && c.v) { mascotV = c.v; showMascot(URL.createObjectURL(b64ToBlob(c.b64, c.mime || 'video/mp4'))); } } catch (e) {}
syncConfig();
setInterval(() => { if (!document.hidden) syncConfig(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncConfig(); });
if (location.hash === '#admin') $('#openAdmin').click();
})();
