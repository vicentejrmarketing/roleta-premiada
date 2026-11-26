/* Roleta Premiada multi-loja.
   Cada totem abre o endereço da sua loja (ex.: /colombo). Este arquivo descobre a loja pelo endereço
   e faz todas as chamadas da roleta irem para as funções rede_* com a loja junto. */
(function () {
  'use strict';
  const RESERVED = ['admin', 'index', 'app', 'api'];
  const m = location.pathname.match(/^\/([a-z0-9][a-z0-9-]{1,39})\/?$/i);
  const slug = m && !RESERVED.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : '';
  window.EDC_LOJA = slug;

  // Sem loja no endereço: abre a última loja usada neste aparelho (app instalado no totem abre em "/")
  if (!slug) {
    let last = '';
    try { last = localStorage.getItem('edc_loja') || ''; } catch (e) {}
    if (last && /^[a-z0-9][a-z0-9-]{1,39}$/.test(last)) { location.replace('/' + last); return; }
  } else {
    try { localStorage.setItem('edc_loja', slug); } catch (e) {}
  }

  const of = window.fetch.bind(window);
  const re = /(\/rest\/v1\/rpc\/)roleta2?_/;
  window.fetch = function (input, init) {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
    if (url && re.test(url)) {
      url = url.replace(re, '$1rede_');
      let body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
      body = Object.assign({ p_loja: slug }, body);
      init = Object.assign({}, init, { body: JSON.stringify(body) });
      const p = of(url, init);
      if (/rede_get_config$/.test(url)) p.then(r => r.clone().json()).then(status, () => {});
      return p;
    }
    return of(input, init);
  };

  /* aviso na tela quando a loja não existe, está sem campanha ou fora do período */
  const MSG = {
    loja: ['Loja não encontrada', slug ? 'Confira o endereço desta roleta com o marketing.' : 'Abra o endereço da sua loja, por exemplo: ' + location.host + '/nome-da-loja'],
    campanha: ['Roleta em preparação', 'Esta loja ainda não tem uma campanha ativa. Volte em breve!'],
    periodo: ['Promoção encerrada', 'No momento não há promoção ativa nesta loja. Volte em breve!']
  };
  let box = null;
  function status(cfg) {
    if (!cfg) return;
    const st = cfg.status || 'ok';
    if (cfg.loja && cfg.loja.nome) {
      const tag = document.querySelector('.tag span');
      if (tag) tag.textContent = '★ Roleta premiada · ' + cfg.loja.nome;
      document.title = 'Roleta Premiada — ' + cfg.loja.nome;
    }
    if (st === 'ok') { if (box) box.remove(); box = null; return; }
    const t = MSG[st] || MSG.campanha;
    if (!box) {
      box = document.createElement('div');
      box.className = 'overlay show';
      box.style.zIndex = '39';
      document.body.appendChild(box);
    }
    box.innerHTML = '<div class="dialog"><h3>' + t[0].toUpperCase() + '</h3><p>' + t[1] + '</p>' +
      (slug ? '<p style="margin:14px 0 0"><a id="stAdmin" style="color:var(--y);font-weight:800;cursor:pointer">Área do lojista</a></p>'
            : '<p style="margin:14px 0 0"><a href="/admin" style="color:var(--y);font-weight:800">Painel do marketing</a></p>') + '</div>';
    const a = box.querySelector('#stAdmin');
    if (a) a.onclick = () => { const b = document.getElementById('openAdmin'); if (b) b.click(); };
  }
})();
