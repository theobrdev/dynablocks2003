// Bônus diário de login: ao abrir qualquer página com a conta logada, pede o bônus de hoje ao banco.
// O banco só paga UMA vez por dia (a regra fica no servidor), então chamar de novo é inofensivo.
(function () {
  'use strict';
  if (typeof db === 'undefined') return;

  const todayBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  function toast(text) {
    const t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'background:#fff8dc;border:2px solid #c9a227;padding:8px 16px;font:bold 14px Arial,sans-serif;' +
      'box-shadow:3px 3px 10px rgba(0,0,0,.35);';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  async function claim() {
    const { data: s } = await db.auth.getSession();
    if (!s.session) return;
    const key = 'dyna_daily_' + s.session.user.id;
    try { if (localStorage.getItem(key) === todayBR()) return; } catch (e) { /* sem localStorage: segue */ }
    const { data, error } = await db.rpc('claim_daily_bonus');
    if (error) return;
    try { localStorage.setItem(key, todayBR()); } catch (e) { /* ignora */ }
    if (data > 0) toast('+' + data + ' points: daily login bonus! \u{1F389}');
  }
  claim();
})();
