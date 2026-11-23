/* Músicas: PADRÃO em loop no fundo, COMEMORAÇÃO quando sai o prêmio */
(function () {
  const API_URL = 'https://ziuxfcxkpovnplrxofxz.supabase.co/rest/v1/rpc/';
  const API_KEY = 'sb_publishable_D6Po0ZWEHrQSylbAhbQ85g_gaDyyvwX';
  async function rpc(fn, body) {
    const r = await fetch(API_URL + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: API_KEY, Authorization: 'Bearer ' + API_KEY }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function b64ToBlob(b64, mime) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); }
  let tT; function toast(t) { const el = document.getElementById('toast'); if (!el) return; el.textContent = t; el.classList.add('show'); clearTimeout(tT); tT = setTimeout(() => el.classList.remove('show'), 2600); }
  const ERR = { pin: 'Senha expirada. Saia do painel e entre de novo.', bloqueado: 'Muitas tentativas erradas. Aguarde 15 minutos.', arquivo: 'Formato de áudio não aceito. Use MP3.', tamanho: 'Arquivo grande demais (máximo 5 MB).' };
  // Guarda a senha digitada ao entrar no painel (necessária para enviar as músicas)
  let adminPin = null;
  const pf = document.getElementById('pinForm');
  if (pf) pf.addEventListener('submit', () => { const v = document.getElementById('pin').value; adminPin = String(v || '').trim().toUpperCase(); }, true);
  const sp = document.getElementById('savePin');
  if (sp) sp.addEventListener('click', () => { const v = String(document.getElementById('cfgPin').value || '').trim().toUpperCase(); if (/^[A-Z0-9-]{4,20}$/.test(v)) { const old = adminPin; setTimeout(() => { if (document.getElementById('cfgPin').value === '') adminPin = v; else adminPin = old; }, 2500); } }, true);
  const NAMES = { fundo: 'musica_fundo', premio: 'musica_premio' };
  const KEY_ON = 'edc_som_on';
  const CACHE = 'edc-audio-v1';
  const BG_VOL = 0.55;
  const bg = new Audio(); bg.loop = true; bg.preload = 'auto'; bg.volume = BG_VOL;
  const win = new Audio(); win.preload = 'auto'; win.volume = 1;
  const ver = { fundo: null, premio: null };
  const urls = { fundo: null, premio: null };
  let on = true, unlocked = false, celebrating = false, fadeT = null;
  try { on = localStorage.getItem(KEY_ON) !== '0'; } catch (e) {}

  const btn = document.getElementById('sndBtn');
  const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>';
  // Aviso "toque para ligar o som" enquanto o navegador não libera o áudio
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.setAttribute('style', 'position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:45;display:none;align-items:center;gap:9px;padding:12px 20px;border-radius:999px;border:0;background:#FFD400;color:#080808;font:900 13px Montserrat,sans-serif;letter-spacing:.06em;text-transform:uppercase;box-shadow:0 0 0 6px rgba(255,212,0,.18),0 10px 30px rgba(0,0,0,.5);cursor:pointer;animation:edcPulse 1.6s ease-in-out infinite');
  hint.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>Toque para ligar o som';
  const kf = document.createElement('style'); kf.textContent = '@keyframes edcPulse{0%,100%{box-shadow:0 0 0 6px rgba(255,212,0,.18),0 10px 30px rgba(0,0,0,.5)}50%{box-shadow:0 0 0 14px rgba(255,212,0,.06),0 10px 30px rgba(0,0,0,.5)}}';
  document.head.appendChild(kf);
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(hint));
  if (document.body) document.body.appendChild(hint);
  function paintHint() { hint.style.display = (on && !unlocked && urls.fundo) ? 'inline-flex' : 'none'; }
  function paint() {
    paintHint();
    if (!btn) return;
    btn.hidden = !urls.fundo && !urls.premio;
    btn.innerHTML = (on ? ICON_ON : ICON_OFF) + '<span>' + (on ? 'Som ligado' : 'Som desligado') + '</span>';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function fadeTo(el, target, ms, done) {
    clearInterval(fadeT);
    const start = el.volume, t0 = performance.now();
    fadeT = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, start + (target - start) * k));
      if (k >= 1) { clearInterval(fadeT); if (done) done(); }
    }, 40);
  }
  function playBg() {
    if (!on || !unlocked || !urls.fundo || celebrating) return;
    if (bg.paused) { bg.volume = 0; bg.play().then(() => fadeTo(bg, BG_VOL, 900)).catch(() => {}); }
  }
  function stopAll() { clearInterval(fadeT); bg.pause(); win.pause(); celebrating = false; }

  // O navegador só libera som depois de um toque na tela
  function unlock() {
    if (unlocked) return;
    unlocked = true; paintHint();
    if (urls.premio) { win.muted = true; win.play().then(() => { win.pause(); win.currentTime = 0; win.muted = false; }).catch(() => { win.muted = false; }); }
    playBg();
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));

  function celebrate() {
    if (!on || !urls.premio) return;
    celebrating = true;
    if (!bg.paused) fadeTo(bg, 0, 350, () => bg.pause());
    win.currentTime = 0; win.volume = 1;
    win.play().catch(() => { celebrating = false; playBg(); });
  }
  win.addEventListener('ended', () => { celebrating = false; playBg(); });

  if (btn) btn.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(KEY_ON, on ? '1' : '0'); } catch (e) {}
    unlocked = true;
    if (on) playBg(); else stopAll();
    paint();
  });

  // Pausa quando o app vai para segundo plano
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { bg.pause(); } else playBg();
  });

  async function fromCache(name, v) {
    try {
      const c = await caches.open(CACHE);
      const r = await c.match('/__audio/' + name + '?v=' + v);
      if (r) return await r.blob();
    } catch (e) {}
    return null;
  }
  async function toCache(name, v, blob) {
    try {
      const c = await caches.open(CACHE);
      for (const k of await c.keys()) if (k.url.includes('/__audio/' + name + '?')) await c.delete(k);
      await c.put('/__audio/' + name + '?v=' + v, new Response(blob, { headers: { 'Content-Type': blob.type } }));
    } catch (e) {}
  }
  async function load(kind, v) {
    if (v === ver[kind]) return;
    const el = kind === 'fundo' ? bg : win;
    if (!v) {
      ver[kind] = null;
      if (urls[kind]) { el.pause(); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(urls[kind]); urls[kind] = null; }
      paint(); refreshAdmin(); return;
    }
    let blob = await fromCache(NAMES[kind], v);
    if (!blob) {
      let a = null;
      try { a = await rpc('roleta_get_asset', { p_name: NAMES[kind] }); } catch (e) { return; }
      if (!a || !a.b64) return;
      blob = b64ToBlob(a.b64, a.mime || 'audio/mpeg');
      toCache(NAMES[kind], v, blob);
    }
    const wasPlaying = kind === 'fundo' && !bg.paused;
    if (urls[kind]) URL.revokeObjectURL(urls[kind]);
    urls[kind] = URL.createObjectURL(blob);
    el.src = urls[kind];
    ver[kind] = v;
    if (kind === 'fundo' && (wasPlaying || unlocked)) playBg();
    paint(); refreshAdmin();
  }
  function onConfig(cfg) {
    if (!cfg || !('music' in cfg)) return;
    const m = cfg.music || {};
    load('fundo', m.fundo || null);
    load('premio', m.premio || null);
  }

  // Toca a comemoração quando abre a tela "PARABÉNS, VOCÊ GANHOU!" (não toca para quem já tinha girado)
  const wm = document.getElementById('winModal');
  if (wm) new MutationObserver(() => {
    const showing = wm.classList.contains('show');
    if (showing && !wm._mus) { wm._mus = true; const t = (document.getElementById('winTitle') || {}).textContent || ''; if (/PARAB/i.test(t)) celebrate(); }
    if (!showing) wm._mus = false;
  }).observe(wm, { attributes: true, attributeFilter: ['class'] });

  async function syncMusic() { try { onConfig(await rpc('roleta_get_config')); } catch (e) {} }
  setInterval(() => { if (!document.hidden) syncMusic(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncMusic(); });

  /* ---------- painel do lojista ---------- */
  function refreshAdmin() {
    const a = document.getElementById('musFundoSt'), b = document.getElementById('musPremioSt');
    if (a) a.textContent = ver.fundo ? 'Música no ar ✓' : 'Nenhuma música enviada.';
    if (b) b.textContent = ver.premio ? 'Música no ar ✓' : 'Nenhuma música enviada.';
  }
  function hookUpload(kind, inputId, delId, stId) {
    const inp = document.getElementById(inputId), del = document.getElementById(delId), st = document.getElementById(stId);
    if (!inp) return;
    inp.addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) return toast('Arquivo grande demais (máximo 5 MB).');
      const mime = f.type || (/\.m4a$/i.test(f.name) ? 'audio/mp4' : 'audio/mpeg');
      if (!/^audio\//.test(mime)) return toast('Envie um arquivo de áudio (MP3).');
      st.textContent = 'Enviando...';
      try {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
        const r = await rpc('roleta_admin_set_asset', { p_pin: adminPin, p_name: NAMES[kind], p_mime: mime === 'audio/mp3' ? 'audio/mpeg' : mime, p_b64: b64 });
        if (r && r.ok) {
          ver[kind] = '_';
          await syncMusic();
          st.textContent = 'Música no ar ✓';
          toast('Música enviada! Já toca em todos os aparelhos.');
        } else { st.textContent = ''; toast(ERR[r && r.error] || 'Não foi possível enviar.'); }
      } catch (err) { st.textContent = ''; toast('Sem conexão. Tente novamente.'); }
    });
    del.addEventListener('click', async () => {
      if (!ver[kind]) return toast('Nenhuma música enviada.');
      try {
        const r = await rpc('roleta_admin_delete_asset', { p_pin: adminPin, p_name: NAMES[kind] });
        if (r && r.ok) { load(kind, null); toast('Música removida.'); }
        else toast(ERR[r && r.error] || 'Não foi possível remover.');
      } catch (e) { toast('Sem conexão. Tente novamente.'); }
    });
  }
  hookUpload('fundo', 'musFundoFile', 'musFundoDel', 'musFundoSt');
  hookUpload('premio', 'musPremioFile', 'musPremioDel', 'musPremioSt');

  paint(); refreshAdmin();
  syncMusic();
})();
