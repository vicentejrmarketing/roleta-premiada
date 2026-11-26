/* Painel do marketing: lojas, campanhas, prêmios por loja (com estoque) e leads de toda a rede. */
(() => {
'use strict';
const API_URL = 'https://ziuxfcxkpovnplrxofxz.supabase.co/rest/v1/rpc/';
const API_KEY = 'sb_publishable_D6Po0ZWEHrQSylbAhbQ85g_gaDyyvwX';
async function rpc(fn, body) {
  const r = await fetch(API_URL + fn, { method: 'POST', headers: { apikey: API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const ERR = {
  pin: 'Sua sessão expirou. Entre de novo.', senha: 'E-mail ou senha incorretos.', curta: 'A nova senha precisa ter pelo menos 8 caracteres.', bloqueado: 'Muitas tentativas erradas. Aguarde 15 minutos.',
  premios: 'Cada lista precisa ter de 2 a 16 prêmios.', formato: 'Senha inválida: use de 4 a 20 caracteres (letras, números ou hífen). A senha mestra precisa de 6.',
  slug: 'Endereço inválido: use letras minúsculas, números e hífen (ex.: colombo-centro).', slug_usado: 'Já existe uma loja com esse endereço.',
  nome: 'Preencha o nome.', campanha: 'Esta loja ainda não tem campanha. Escolha uma campanha para ela primeiro.',
  arquivo: 'Formato de arquivo não aceito.', tamanho: 'Arquivo grande demais.', loja: 'Loja não encontrada.'
};
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let tT; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(tT); tT = setTimeout(() => el.classList.remove('show'), 3000); }
const fail = r => toast(ERR[r && r.error] || 'Não foi possível salvar. Tente de novo.');
const offline = () => toast('Sem conexão. Tente novamente.');
const open = id => $(id).classList.add('show');
const close = el => el.classList.remove('show');
$$('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) close(o); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.overlay.show').forEach(close); });

let PIN = null, D = { lojas: [], campanhas: [] }, LEADS = [];
const SITE = location.origin;
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '';
const fmtDT = d => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const LIM = { rede: '1 por WhatsApp na rede', loja: '1 por WhatsApp por loja', livre: 'Sem limite' };
const isEsg = p => p.estoque !== null && p.estoque !== undefined && (+p.saidos || 0) >= +p.estoque;

/* ---------- login ---------- */
function enter(tok, who) {
  PIN = tok; try { sessionStorage.setItem('edc_adm', JSON.stringify({ t: tok, who })); } catch (e) {}
  $('#meInfo').textContent = 'Logado como ' + who + '. Mínimo 8 caracteres.';
  $('#loginView').hidden = true; $('#panel').hidden = false; load();
}
function exit(msg) {
  PIN = null; try { sessionStorage.removeItem('edc_adm'); } catch (e) {}
  $('#panel').hidden = true; $('#loginView').hidden = false;
  if (msg) { $('#loginMsg span').textContent = msg; $('#loginMsg').classList.add('show'); }
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const b = $('#loginForm .btn-main'); b.disabled = true;
  let r = null; try { r = await rpc('rede_m_login_email', { p_email: $('#mEmail').value.trim(), p_senha: $('#mSenha').value }); } catch (err) {}
  b.disabled = false;
  if (r && r.ok) { $('#mSenha').value = ''; enter(r.token, r.email); }
  else { $('#loginMsg span').textContent = r ? (ERR[r.error] || 'E-mail ou senha incorretos.') : 'Sem conexão. Tente novamente.'; $('#loginMsg').classList.add('show'); $('#mSenha').select(); }
});
['#mEmail', '#mSenha'].forEach(s => $(s).addEventListener('input', () => $('#loginMsg').classList.remove('show')));
$('#logout').addEventListener('click', () => { const t = PIN; exit(); rpc('rede_m_logout', { p_pin: t }).catch(() => {}); });
try { const s = JSON.parse(sessionStorage.getItem('edc_adm') || 'null'); if (s && s.t) enter(s.t, s.who); } catch (e) {}
$('#reload').addEventListener('click', () => load(true));

async function load(msg) {
  let r = null; try { r = await rpc('rede_m_overview', { p_pin: PIN }); } catch (e) { return offline(); }
  if (r && r.error === 'pin') return exit(ERR.pin);
  if (!r || r.error) return fail(r);
  D = r; render(); if (msg) toast('Dados atualizados.');
}

/* ---------- abas ---------- */
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('on', x === t));
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + t.dataset.tab));
  if (t.dataset.tab === 'leads' && !LEADS.length) loadLeads();
}));

function campName(id) { const c = D.campanhas.find(c => c.id === id); return c ? c.nome : null; }
function render() {
  const L = D.lojas;
  $('#stLojas').textContent = L.filter(l => l.ativo).length;
  $('#stHoje').textContent = L.reduce((s, l) => s + l.giros_hoje, 0);
  $('#stCamp').textContent = L.reduce((s, l) => s + l.giros_campanha, 0);
  $('#stEsg').textContent = L.reduce((s, l) => s + l.premios.filter(p => p.active && isEsg(p)).length, 0);

  $('#lojaRows').innerHTML = L.map(l => {
    const esg = l.premios.filter(p => p.active && isEsg(p)).length;
    const low = l.premios.filter(p => p.active && !isEsg(p) && p.estoque !== null && p.estoque !== undefined && (+p.estoque - (+p.saidos || 0)) <= 3).length;
    const cn = campName(l.campanha_id);
    return `<tr>
      <td><b>${esc(l.nome)}</b>${l.ativo ? '' : ' <span class="pill-s off">desativada</span>'}${l.edita_premios ? '<div class="mut">gerente edita prêmios</div>' : ''}</td>
      <td><a href="/${esc(l.slug)}" target="_blank" rel="noopener">${esc(location.host)}/${esc(l.slug)}</a></td>
      <td>${cn ? esc(cn) : '<span class="pill-s off">sem campanha</span>'}</td>
      <td>${l.giros_hoje}</td><td>${l.giros_campanha}</td>
      <td class="mut">${fmtDT(l.ultimo_giro)}</td>
      <td>${!l.campanha_id ? '—' : esg ? `<span class="pill-s red">${esg} esgotado${esg > 1 ? 's' : ''}</span>` : low ? `<span class="pill-s">${low} acabando</span>` : '<span class="pill-s off">ok</span>'}</td>
      <td><div class="row-btns" style="flex-wrap:nowrap"><button class="btn-o" data-prem="${l.id}"${l.campanha_id ? '' : ' disabled title="Escolha uma campanha primeiro"'}>Prêmios</button><button class="btn-o" data-edit="${l.id}">Editar</button></div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8"><div class="empty">Nenhuma loja ainda. Crie uma campanha e depois clique em "+ Nova loja".</div></td></tr>`;

  $('#campRows').innerHTML = D.campanhas.map(c => {
    const per = c.inicio || c.fim ? `${c.inicio ? fmtDate(c.inicio) : '…'} a ${c.fim ? fmtDate(c.fim) : '…'}` : 'Sem datas';
    return `<tr><td><b>${esc(c.nome)}</b><div class="mut">${c.premios.filter(p => p.active).length} prêmios padrão</div></td><td>${per}</td><td>${LIM[c.limite]}</td><td>${c.validade} dias</td><td>${c.lojas}</td><td>${c.giros}</td>
      <td><div class="row-btns" style="flex-wrap:nowrap"><button class="btn-o" data-cprem="${c.id}">Prêmios padrão</button><button class="btn-o" data-cedit="${c.id}">Editar</button><button class="btn-y" data-capl="${c.id}">Colocar nas lojas</button></div></td></tr>`;
  }).join('') || `<tr><td colspan="7"><div class="empty">Nenhuma campanha ainda. Clique em "+ Nova campanha".</div></td></tr>`;

  const lOpt = '<option value="">Todas as lojas</option>' + L.map(l => `<option value="${l.id}">${esc(l.nome)}</option>`).join('');
  const cOpt = '<option value="">Todas as campanhas</option>' + D.campanhas.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  const fl = $('#fLoja').value, fc = $('#fCamp').value;
  $('#fLoja').innerHTML = lOpt; $('#fLoja').value = fl; $('#fCamp').innerHTML = cOpt; $('#fCamp').value = fc;
}

/* ---------- lojas ---------- */
let editLoja = null;
const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function showUrl() { $('#lUrl').textContent = location.host + '/' + ($('#lSlug').value || 'nome-da-loja'); }
$('#lNome').addEventListener('input', () => { if (!editLoja || !editLoja._slugTouched) { if (!editLoja) $('#lSlug').value = slugify($('#lNome').value); showUrl(); } });
$('#lSlug').addEventListener('input', () => { $('#lSlug').value = slugify($('#lSlug').value.replace(/\s/g, '-')) + ($('#lSlug').value.endsWith('-') ? '-' : ''); showUrl(); });
function campOptions(sel) {
  return '<option value="">Sem campanha</option>' + D.campanhas.map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.nome)}</option>`).join('');
}
function openLoja(l) {
  editLoja = l || null;
  $('#lojaTitle').textContent = l ? 'EDITAR LOJA' : 'NOVA LOJA';
  $('#lNome').value = l ? l.nome : ''; $('#lSlug').value = l ? l.slug : ''; $('#lWa').value = l ? l.whatsapp : '';
  $('#lCamp').innerHTML = campOptions(l ? l.campanha_id : (D.campanhas[0] && D.campanhas[0].id));
  $('#lPin').value = ''; $('#lPin').placeholder = l ? 'Deixe vazio para manter' : 'Senha inicial do gerente';
  $('#lPinHint').textContent = l ? 'Preencha só se quiser trocar a senha do gerente.' : 'De 4 a 20 caracteres: letras, números ou hífen.';
  $('#lEdita').checked = l ? l.edita_premios : false; $('#lAtivo').checked = l ? l.ativo : true;
  showUrl(); open('#dlgLoja'); setTimeout(() => $('#lNome').focus(), 60);
}
$('#newLoja').addEventListener('click', () => openLoja(null));
$('#formLoja').addEventListener('submit', async e => {
  e.preventDefault();
  const b = $('#formLoja .btn-y'); b.disabled = true;
  const body = { id: editLoja ? editLoja.id : null, nome: $('#lNome').value.trim(), slug: $('#lSlug').value.replace(/-+$/, ''), whatsapp: $('#lWa').value,
    campanha_id: $('#lCamp').value || null, pin: $('#lPin').value.trim().toUpperCase(), edita_premios: $('#lEdita').checked, ativo: $('#lAtivo').checked };
  let r = null; try { r = await rpc('rede_m_save_loja', { p_pin: PIN, p_loja: body }); } catch (err) { b.disabled = false; return offline(); }
  b.disabled = false;
  if (r && r.ok) { close($('#dlgLoja')); toast(editLoja ? 'Loja atualizada.' : 'Loja criada! Endereço do totem: ' + location.host + '/' + body.slug); load(); }
  else fail(r);
});

/* ---------- editor de prêmios (loja ou padrão da campanha) ---------- */
let pdraft = [], pmode = null, pid = null;
function renderPrem() {
  const act = pdraft.filter(p => p.active), total = act.reduce((s, p) => s + Math.max(0, +p.weight || 0), 0);
  $('#premRows').innerHTML = pdraft.map((p, i) => {
    const pct = p.active && total ? Math.max(0, +p.weight || 0) / total * 100 : 0;
    const est = p.estoque === null || p.estoque === undefined ? '' : p.estoque, sd = +p.saidos || 0;
    const info = pmode === 'loja' ? `<div class="est-info">${sd} saíram${est === '' ? '' : ' · ' + (est - sd > 0 ? 'restam ' + (est - sd) : '<b>esgotado</b>')}</div>` : `<div class="est-info">${est === '' ? 'sem limite' : 'por loja'}</div>`;
    return `<tr><td><input class="in" data-i="${i}" data-k="label" value="${esc(p.label)}" maxlength="34"></td>
      <td><input class="in num" type="number" min="0" max="1000" data-i="${i}" data-k="weight" value="${+p.weight || 0}"></td>
      <td><input class="in num" type="number" min="0" data-i="${i}" data-k="estoque" value="${est}" placeholder="∞">${info}</td>
      <td><span class="pct">${pct.toFixed(1).replace('.', ',')}%</span></td>
      <td><label class="sw"><input type="checkbox" data-i="${i}" data-k="active"${p.active ? ' checked' : ''}><span></span></label></td>
      <td><button class="icon-btn" data-pdel="${i}" title="Remover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></td></tr>`;
  }).join('');
  const w = [];
  if (act.length % 2 === 1) w.push('Use um número par de prêmios ativos para manter a alternância entre preto e amarelo.');
  if (act.length < 2) w.push('Deixe pelo menos 2 prêmios ativos.');
  if (act.length > 12) w.push('Mais de 12 prêmios deixa os textos pequenos demais na roleta.');
  $('#premWarn').innerHTML = w.join('<br>'); $('#premWarn').classList.toggle('show', w.length > 0);
}
$('#premRows').addEventListener('input', e => {
  const el = e.target, k = el.dataset.k; if (!k) return; const p = pdraft[+el.dataset.i];
  if (k === 'active') { p.active = el.checked; renderPrem(); }
  else if (k === 'weight') p.weight = Math.max(0, +el.value || 0);
  else if (k === 'estoque') p.estoque = el.value === '' ? null : Math.max(0, parseInt(el.value) || 0);
  else p.label = el.value;
});
$('#premRows').addEventListener('change', e => { if (e.target.dataset.k === 'weight') renderPrem(); });
$('#premRows').addEventListener('click', e => { const b = e.target.closest('[data-pdel]'); if (b) { pdraft.splice(+b.dataset.pdel, 1); renderPrem(); } });
$('#premAdd').addEventListener('click', () => { if (pdraft.length >= 16) return toast('Limite de 16 prêmios.'); pdraft.push({ label: 'Novo prêmio', weight: 10, estoque: null, saidos: 0, active: true }); renderPrem(); const ins = $$('#premRows input[data-k="label"]'); ins[ins.length - 1].select(); });
function openPrem(mode, obj) {
  pmode = mode; pid = obj.id; pdraft = JSON.parse(JSON.stringify(obj.premios || []));
  if (mode === 'loja') { $('#premTitle').textContent = 'PRÊMIOS — ' + obj.nome.toUpperCase(); $('#premSub').textContent = 'Campanha: ' + (campName(obj.campanha_id) || '—') + '. Valem só para esta loja. Estoque vazio = sem limite; quando esgota, o prêmio sai da roleta sozinho.'; }
  else { $('#premTitle').textContent = 'PRÊMIOS PADRÃO — ' + obj.nome.toUpperCase(); $('#premSub').textContent = 'Lojas que entrarem nesta campanha recebem esta lista (o estoque vale para cada loja). Para trocar a lista de lojas que já estão na campanha, use "Colocar nas lojas" com "Substituir prêmios".'; }
  renderPrem(); open('#dlgPrem');
}
$('#premSave').addEventListener('click', async () => {
  const list = pdraft.map(p => ({ label: (p.label || '').trim(), weight: +p.weight || 0, estoque: p.estoque === '' ? null : p.estoque, active: !!p.active })).filter(p => p.label);
  if (list.filter(p => p.active).length < 2) return toast('Deixe pelo menos 2 prêmios ativos.');
  const b = $('#premSave'); b.disabled = true; let r = null;
  try {
    if (pmode === 'loja') r = await rpc('rede_m_save_premios', { p_pin: PIN, p_loja_id: pid, p_premios: list });
    else { const c = D.campanhas.find(c => c.id === pid); r = await rpc('rede_m_save_campanha', { p_pin: PIN, p_c: Object.assign({}, c, { premios: list }) }); }
  } catch (e) { b.disabled = false; return offline(); }
  b.disabled = false;
  if (r && r.ok) { close($('#dlgPrem')); toast(pmode === 'loja' ? 'Prêmios salvos! A roleta da loja já foi atualizada.' : 'Prêmios padrão salvos.'); load(); }
  else fail(r);
});

$('#lojaRows').addEventListener('click', e => {
  const a = e.target.closest('[data-edit]'), p = e.target.closest('[data-prem]');
  if (a) openLoja(D.lojas.find(l => l.id === +a.dataset.edit));
  if (p) openPrem('loja', D.lojas.find(l => l.id === +p.dataset.prem));
});

/* ---------- campanhas ---------- */
let editCamp = null;
function openCamp(c) {
  editCamp = c || null;
  $('#campTitle').textContent = c ? 'EDITAR CAMPANHA' : 'NOVA CAMPANHA';
  $('#cNome').value = c ? c.nome : ''; $('#cIni').value = c && c.inicio || ''; $('#cFim').value = c && c.fim || '';
  $('#cLim').value = c ? c.limite : 'rede'; $('#cVal').value = c ? c.validade : 7;
  open('#dlgCamp'); setTimeout(() => $('#cNome').focus(), 60);
}
$('#newCamp').addEventListener('click', () => openCamp(null));
$('#formCamp').addEventListener('submit', async e => {
  e.preventDefault();
  const base = editCamp ? editCamp.premios : (D.campanhas[0] ? D.campanhas[0].premios : [
    { label: 'Película grátis', weight: 18, active: true }, { label: '10% OFF em acessórios', weight: 20, active: true },
    { label: 'Capinha grátis', weight: 15, active: true }, { label: 'R$ 50 OFF no celular novo', weight: 5, active: true }]);
  const body = { id: editCamp ? editCamp.id : null, nome: $('#cNome').value.trim(), inicio: $('#cIni').value, fim: $('#cFim').value,
    limite: $('#cLim').value, validade: +$('#cVal').value || 7, premios: base.map(p => ({ label: p.label, weight: p.weight, estoque: p.estoque, active: p.active })) };
  if (body.inicio && body.fim && body.fim < body.inicio) return toast('A data de fim é antes do início.');
  const b = $('#formCamp .btn-y'); b.disabled = true; let r = null;
  try { r = await rpc('rede_m_save_campanha', { p_pin: PIN, p_c: body }); } catch (err) { b.disabled = false; return offline(); }
  b.disabled = false;
  if (r && r.ok) {
    close($('#dlgCamp')); await load();
    if (!editCamp) { toast('Campanha criada! Agora confira os prêmios padrão.'); openPrem('campanha', D.campanhas.find(c => c.id === r.id)); }
    else toast('Campanha atualizada.');
  } else fail(r);
});
let aplId = null;
$('#campRows').addEventListener('click', e => {
  const ed = e.target.closest('[data-cedit]'), pr = e.target.closest('[data-cprem]'), ap = e.target.closest('[data-capl]');
  if (ed) openCamp(D.campanhas.find(c => c.id === +ed.dataset.cedit));
  if (pr) openPrem('campanha', D.campanhas.find(c => c.id === +pr.dataset.cprem));
  if (ap) {
    const c = D.campanhas.find(c => c.id === +ap.dataset.capl); aplId = c.id;
    if (!D.lojas.length) return toast('Crie as lojas primeiro, em "Lojas".');
    $('#aplTitle').textContent = 'COLOCAR "' + c.nome.toUpperCase() + '" NAS LOJAS';
    $('#aplList').innerHTML = D.lojas.map(l => `<label><input type="checkbox" value="${l.id}"${l.campanha_id === c.id ? ' checked' : ''}> ${esc(l.nome)}${l.campanha_id && l.campanha_id !== c.id ? `<span class="mut">(hoje: ${esc(campName(l.campanha_id))})</span>` : ''}</label>`).join('');
    $('#aplAll').checked = false; $('#aplSub').checked = false; open('#dlgApl');
  }
});
$('#aplAll').addEventListener('change', e => $$('#aplList input').forEach(i => i.checked = e.target.checked));
$('#aplSave').addEventListener('click', async () => {
  const ids = $$('#aplList input:checked').map(i => +i.value);
  if (!ids.length) return toast('Marque pelo menos uma loja.');
  const b = $('#aplSave'); b.disabled = true; let r = null;
  try { r = await rpc('rede_m_aplicar_campanha', { p_pin: PIN, p_campanha_id: aplId, p_lojas: ids, p_substituir: $('#aplSub').checked }); } catch (e) { b.disabled = false; return offline(); }
  b.disabled = false;
  if (r && r.ok) { close($('#dlgApl')); toast(`Campanha colocada em ${r.lojas} loja${r.lojas > 1 ? 's' : ''}. As roletas atualizam em até 30 segundos.`); load(); }
  else fail(r);
});

/* ---------- leads ---------- */
async function loadLeads() {
  $('#leadCount').textContent = 'Carregando...';
  let r = null;
  try { r = await rpc('rede_m_leads', { p_pin: PIN, p_loja_id: +$('#fLoja').value || null, p_campanha_id: +$('#fCamp').value || null, p_desde: $('#fDe').value || null, p_ate: $('#fAte').value || null }); }
  catch (e) { $('#leadCount').textContent = ''; return offline(); }
  if (!r || !Array.isArray(r.rows)) { $('#leadCount').textContent = ''; return fail(r); }
  LEADS = r.rows;
  $('#leadCount').textContent = LEADS.length + ' giro' + (LEADS.length === 1 ? '' : 's') + (LEADS.length >= 20000 ? ' (mostrando os 20.000 mais recentes; use os filtros)' : '');
  $('#leadRows').innerHTML = LEADS.slice(0, 1000).map(p => `<tr><td class="mut">${fmtDT(p.date)}</td><td>${esc(p.loja)}</td><td>${esc(p.name)}</td><td>${esc(p.phone)}</td><td><span class="pill-s">${esc(p.prize)}</span></td><td style="font-weight:800;letter-spacing:.06em">${esc(p.code)}</td><td>${p.optin ? 'Sim' : 'Não'}</td></tr>`).join('')
    + (LEADS.length > 1000 ? `<tr><td colspan="7" class="mut">Mostrando 1.000 de ${LEADS.length}. A planilha baixada tem todos.</td></tr>` : '')
    || `<tr><td colspan="7"><div class="empty">Nenhum giro encontrado com esses filtros.</div></td></tr>`;
}
$('#fGo').addEventListener('click', loadLeads);
function csv() {
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return ['Data;Loja;Campanha;Nome;WhatsApp;Prêmio;Código;Aceita ofertas', ...LEADS.map(p => [new Date(p.date).toLocaleString('pt-BR'), p.loja, p.campanha, p.name, p.phone, p.prize, p.code, p.optin ? 'Sim' : 'Não'].map(q).join(';'))].join('\n');
}
$('#dlCsv').addEventListener('click', () => {
  if (!LEADS.length) return toast('Nenhum lead para exportar. Clique em Buscar.');
  const blob = new Blob(['﻿' + csv()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'leads-roleta-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#copyCsv').addEventListener('click', () => {
  if (!LEADS.length) return toast('Nenhum lead para copiar. Clique em Buscar.');
  navigator.clipboard.writeText(csv()).then(() => toast('CSV copiado! Cole em uma planilha.'), () => toast('Não consegui copiar. Use "Baixar planilha".'));
});

/* ---------- configurações ---------- */
$('#savePass').addEventListener('click', async () => {
  const nv = $('#newPass').value;
  if (nv.length < 8) return toast(ERR.curta);
  let r = null; try { r = await rpc('rede_m_set_senha', { p_pin: PIN, p_atual: $('#curPass').value, p_nova: nv }); } catch (e) { return offline(); }
  if (r && r.ok) { $('#curPass').value = ''; $('#newPass').value = ''; toast('Sua senha foi trocada.'); }
  else toast(r && r.error === 'senha' ? 'A senha atual está errada.' : (ERR[r && r.error] || 'Não foi possível trocar.'));
});
$('#saveMaster').addEventListener('click', async () => {
  const v = $('#newMaster').value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,20}$/.test(v)) return toast(ERR.formato);
  let r = null; try { r = await rpc('rede_m_set_master_pin', { p_pin: PIN, p_new: v }); } catch (e) { return offline(); }
  if (r && r.ok) { $('#newMaster').value = ''; toast('Senha mestra das lojas trocada.'); } else fail(r);
});
const toB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
async function upload(name, f, maxMB) {
  if (!f) return;
  if (f.size > maxMB * 1024 * 1024) return toast(`Arquivo grande demais (máximo ${maxMB} MB).`);
  let mime = f.type || 'application/octet-stream'; if (mime === 'audio/mp3') mime = 'audio/mpeg';
  if (name === 'mascote') {
    const url = URL.createObjectURL(f);
    const dims = await new Promise(res => { const v = document.createElement('video'); v.muted = true; v.preload = 'metadata'; v.onloadedmetadata = () => res([v.videoWidth, v.videoHeight]); v.onerror = () => res(null); v.src = url; });
    URL.revokeObjectURL(url);
    if (!dims) return toast('Não consegui ler esse vídeo.');
    if (dims[1] / dims[0] < 1.83) return toast('Use o arquivo mascote.mp4 preparado (com o fundo já removido).');
  }
  toast('Enviando...');
  let r = null; try { r = await rpc('rede_admin_set_asset', { p_loja: '', p_pin: PIN, p_name: name, p_mime: mime, p_b64: await toB64(f) }); } catch (e) { return offline(); }
  if (r && r.ok) toast('Enviado! Aparece em todas as lojas em até 30 segundos.'); else fail(r);
}
$('#fMascote').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; upload('mascote', f, 4.2); });
$('#fFundo').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; upload('musica_fundo', f, 5); });
$('#fPremio').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; upload('musica_premio', f, 5); });
$$('[data-del]').forEach(b => b.addEventListener('click', async () => {
  let r = null; try { r = await rpc('rede_admin_delete_asset', { p_loja: '', p_pin: PIN, p_name: b.dataset.del }); } catch (e) { return offline(); }
  if (r && r.ok) toast('Removido de todas as lojas.'); else fail(r);
}));
})();
