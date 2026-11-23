/* Cadastro em pop-up: o centro da roleta abre o formulário; ao enviar, o pop-up fecha e a roleta gira. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const modal = $('#formModal'), stage = $('#stage'), msg = $('#msg'), btn = $('#spin');
  if (!modal || !stage) return;

  function openForm() {
    if (stage.classList.contains('spinning') || btn.disabled) return;
    modal.classList.add('show');
    setTimeout(() => {
      const n = $('#name'), p = $('#phone');
      if (n.value.trim().length < 2) n.focus();
      else if (p.value.replace(/\D/g, '').length < 10) p.focus();
    }, 80);
  }

  $('#rim').addEventListener('click', openForm);
  $('#hubBtn').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openForm(); } });

  // Roda depois da validação do app.js: se os dados estiverem certos, fecha o pop-up para mostrar o giro.
  $('#form').addEventListener('submit', () => {
    if (!msg.classList.contains('show')) modal.classList.remove('show');
  });

  // Se o servidor recusar nome ou telefone depois do envio, reabre o pop-up com o aviso.
  new MutationObserver(() => {
    if (msg.classList.contains('show') && !modal.classList.contains('show')) modal.classList.add('show');
  }).observe(msg, { attributes: true, attributeFilter: ['class'] });
})();
