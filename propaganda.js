/* Vídeo de propaganda em ciclo: vídeo em tela cheia -> roleta por 5 minutos -> vídeo -> ...
   O vídeo é enviado no /admin ("Vídeo de propaganda") e vale para todas as lojas.
   Nunca interrompe um cliente: se der a hora no meio de um cadastro, giro ou prêmio, espera terminar. */
(function () {
  'use strict';
  const API_URL = 'https://ziuxfcxkpovnplrxofxz.supabase.co/rest/v1/rpc/';
  const API_KEY = 'sb_publishable_D6Po0ZWEHrQSylbAhbQ85g_gaDyyvwX';
  const INTERVALO = 5 * 60 * 1000;   // tempo da roleta entre um vídeo e outro
  const CALMO = 20 * 1000;           // só entra se ninguém tocou na tela nos últimos 20 s
  const CACHE = 'edc-video-v1';

  // Guarda as músicas criadas pelo music.js para pausar a de fundo enquanto o vídeo toca
  const audios = [];
  const A = window.Audio;
  if (A) {
    window.Audio = function (src) { const a = new A(src); audios.push(a); return a; };
    window.Audio.prototype = A.prototype;
  }

  async function rpc(fn, body) {
    // o db.js troca "roleta2_" pelas funções da rede e acrescenta a loja
    const r = await fetch(API_URL + fn, { method: 'POST', headers: { apikey: API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function b64ToBlob(b64, mime) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); }

  /* ---------- tela do vídeo ---------- */
  const st = document.createElement('style');
  st.textContent =
    '#promo{position:fixed;inset:0;z-index:75;display:none;align-items:center;justify-content:center;background:#111;cursor:pointer;overflow:hidden}' +
    '#promo.show{display:flex;animation:promoIn .5s ease}' +
    '#promo.out{animation:promoOut .45s ease forwards}' +
    '#promo video{position:relative;height:100%;width:100%;object-fit:contain;display:block}' +
    '#promo canvas{position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);filter:blur(28px) brightness(.96);pointer-events:none}' +
    '@keyframes promoIn{from{opacity:0}}@keyframes promoOut{to{opacity:0}}';
  document.head.appendChild(st);
  const box = document.createElement('div');
  box.id = 'promo';
  box.setAttribute('aria-hidden', 'true');
  const vid = document.createElement('video');
  vid.playsInline = true; vid.setAttribute('playsinline', ''); vid.preload = 'auto';
  const bg = document.createElement('canvas'); bg.width = 48; bg.height = 27;
  const bgx = bg.getContext('2d');
  box.appendChild(bg);
  box.appendChild(vid);
  document.body.appendChild(box);

  let ver = null, url = null, showing = false, timer = null, lastTouch = 0, paused = [];

  ['pointerdown', 'touchstart', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (!showing) lastTouch = Date.now(); }, { passive: true, capture: true }));

  // laterais: o próprio vídeo ampliado e desfocado (o vídeo é em pé e a tela pode ser deitada)
  function fundo() {
    if (!showing) return;
    try {
      const vw = vid.videoWidth, vh = vid.videoHeight;
      if (vw && vh) {
        const k = Math.max(bg.width / vw, bg.height / vh), w = vw * k, h = vh * k;
        bgx.drawImage(vid, (bg.width - w) / 2, (bg.height - h) / 2, w, h);
      }
    } catch (e) {}
    requestAnimationFrame(fundo);
  }

  function ocupado() {
    if (document.hidden) return true;
    if (document.querySelector('.overlay.show') || document.querySelector('#admin.show')) return true;
    const s = document.getElementById('stage');
    if (s && s.classList.contains('spinning')) return true;
    return Date.now() - lastTouch < CALMO;
  }

  function pausarMusicas() {
    paused = audios.filter(a => !a.paused && a.loop);
    paused.forEach(a => a.pause());
  }
  function voltarMusicas() { paused.forEach(a => a.play().catch(() => {})); paused = []; }

  function agendar(ms) { clearTimeout(timer); timer = setTimeout(tentar, ms); }
  function tentar() {
    if (!url) return;
    if (ocupado()) return agendar(5000);
    mostrar();
  }

  async function mostrar() {
    if (showing || !url) return;
    showing = true;
    box.classList.remove('out'); box.classList.add('show');
    requestAnimationFrame(fundo);
    pausarMusicas();
    vid.currentTime = 0;
    vid.muted = false;
    try { await vid.play(); }
    catch (e) {
      // sem um toque na tela o navegador não deixa tocar com som: toca sem som
      vid.muted = true;
      try { await vid.play(); } catch (e2) { esconder(); return; }
    }
  }
  function esconder() {
    if (!showing) return;
    showing = false;
    vid.pause();
    box.classList.add('out');
    setTimeout(() => { if (!showing) box.classList.remove('show', 'out'); }, 450);
    voltarMusicas();
    lastTouch = Date.now() - CALMO; // conta os 5 min a partir de agora
    agendar(INTERVALO);
  }
  vid.addEventListener('ended', esconder);
  vid.addEventListener('error', () => { if (showing) esconder(); });
  // tocar na tela durante o vídeo abre a roleta na hora
  box.addEventListener('pointerdown', e => { e.preventDefault(); esconder(); });
  // se a música de fundo tentar voltar durante o vídeo, pausa de novo
  setInterval(() => { if (showing) audios.forEach(a => { if (!a.paused && a.loop) { a.pause(); if (!paused.includes(a)) paused.push(a); } }); }, 500);

  /* ---------- carrega o vídeo enviado no painel (com cópia no aparelho para funcionar offline) ---------- */
  async function doCache(v) { try { const c = await caches.open(CACHE); const r = await c.match('/__video/propaganda?v=' + v); if (r) return await r.blob(); } catch (e) {} return null; }
  async function praCache(v, blob) {
    try { const c = await caches.open(CACHE); for (const k of await c.keys()) await c.delete(k); await c.put('/__video/propaganda?v=' + v, new Response(blob, { headers: { 'Content-Type': blob.type } })); } catch (e) {}
  }
  async function carregar(v) {
    if (v === ver) return;
    if (!v) { ver = null; if (showing) esconder(); clearTimeout(timer); if (url) URL.revokeObjectURL(url); url = null; vid.removeAttribute('src'); vid.load(); return; }
    let blob = await doCache(v);
    if (!blob) {
      let a = null;
      try { a = await rpc('roleta2_get_asset', { p_name: 'propaganda' }); } catch (e) { return; }
      if (!a || !a.b64) return;
      blob = b64ToBlob(a.b64, a.mime || 'video/mp4');
      praCache(v, blob);
    }
    const primeira = !ver;
    if (showing) esconder();
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    vid.src = url; vid.load();
    ver = v;
    if (primeira) agendar(1500); // ao abrir a roleta, o vídeo aparece primeiro
  }
  async function sync() { try { const cfg = await rpc('roleta2_get_config'); if (cfg && 'propaganda' in cfg) carregar(cfg.propaganda || null); } catch (e) {} }
  sync();
  setInterval(() => { if (!document.hidden) sync(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
})();
