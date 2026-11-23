/* Roleta Premiada usa a sua própria base (roleta2_*), separada da roleta original (roleta_*). */
(function () {
  'use strict';
  const of = window.fetch.bind(window);
  const re = /(\/rest\/v1\/rpc\/)roleta_/;
  window.fetch = function (input, init) {
    if (typeof input === 'string' && re.test(input)) input = input.replace(re, '$1roleta2_');
    else if (input instanceof URL && re.test(input.href)) input = input.href.replace(re, '$1roleta2_');
    return of(input, init);
  };
})();
