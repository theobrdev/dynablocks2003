// Cursor "ocupado" animado do Old Roblox (os arquivos .ani não funcionam em navegadores,
// então os 12 quadros viraram PNG e aqui a gente troca de quadro).
//
//   DynaCursor.busy()     cursor "Busy" (esperando)
//   DynaCursor.working()  cursor "Working in Background" (trabalhando)
//   DynaCursor.idle()     volta ao cursor normal
//
// Os cursores comuns (seta, mão, ajuda, redimensionar...) são só CSS: veja style.css e editor.css.
(function () {
  'use strict';
  const N = 12, MS = 167;                                   // 12 quadros, ~167 ms cada (como no original)
  const SETS = {
    busy:    { prefix: 'busy',    hot: '15 15', fallback: 'wait' },
    working: { prefix: 'working', hot: '3 3',   fallback: 'progress' }
  };
  const html = document.documentElement;
  const url = (s, i) => 'img/cursors/' + s.prefix + '-' + String(i).padStart(2, '0') + '.png';
  const preloaded = {};
  let timer = null, safety = null, idx = 0;
 
  function preload(s) {                                      // carrega os quadros antes, para não piscar
    if (preloaded[s.prefix]) return;
    preloaded[s.prefix] = true;
    for (let i = 0; i < N; i++) { const im = new Image(); im.src = url(s, i); }
  }
  function start(name) {
    stop();
    const s = SETS[name];
    preload(s);
    html.classList.add('dyna-busy');                         // faz TODOS os elementos herdarem este cursor
    idx = 0;
    const step = () => { html.style.cursor = 'url("' + url(s, idx++ % N) + '") ' + s.hot + ', ' + s.fallback; };
    step();
    timer = setInterval(step, MS);
    safety = setTimeout(stop, 30000);                        // por garantia: nunca fica "ocupado" para sempre
  }
  function stop() {
    clearInterval(timer); clearTimeout(safety);
    timer = safety = null;
    html.classList.remove('dyna-busy');
    html.style.removeProperty('cursor');
  }
  window.DynaCursor = { busy: () => start('busy'), working: () => start('working'), idle: stop };
})();
 