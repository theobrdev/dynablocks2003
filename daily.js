// Bônus diário de login: ao abrir qualquer página com a conta logada, pede o bônus de hoje ao banco.
// O banco só paga UMA vez por dia (a regra fica no servidor), então chamar de novo é inofensivo.
(function () {
  'use strict';
  if (typeof db === 'undefined') return;

  const todayBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  let shown = 0;
  function toast(text) {
    const t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'position:fixed;top:' + (12 + shown * 52) + 'px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'background:#fff8dc;border:2px solid #c9a227;padding:8px 16px;font:bold 14px Arial,sans-serif;' +
      'box-shadow:3px 3px 10px rgba(0,0,0,.35);';
    document.body.appendChild(t);
    shown++;
    setTimeout(() => { t.remove(); shown = Math.max(0, shown - 1); }, 5000);
  }

  const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignora */ } };

  // Confere as conquistas no servidor e mostra o aviso amarelo das NOVAS (ainda não vistas).
  // Fica disponível para as outras páginas: depois de salvar o perfil ou vestir uma roupa, chamam window.checkAchievements().
  async function checkAch() {
    const { data: s } = await db.auth.getSession();
    if (!s.session) return;
    const ach = await db.rpc('check_achievements');
    if (ach.error) { console.warn('check_achievements:', ach.error.message); return; }   // ex.: o SQL das conquistas ainda não foi rodado
    (ach.data || []).forEach(a => toast('\u{1F3C6} Achievement unlocked: ' + a.name));
  }
  window.checkAchievements = checkAch;

  async function claim() {
    const { data: s } = await db.auth.getSession();
    if (!s.session) return;
    const uid = s.session.user.id, day = todayBR();

    // 1) conquistas: no máximo uma conferência a cada 5 minutos por navegador
    const kT = 'dyna_ach_t_' + uid;
    if (Date.now() - (parseInt(stored(kT) || '0', 10) || 0) > 5 * 60 * 1000) {
      store(kT, String(Date.now()));
      await checkAch();
    }

    // 2) bônus diário de pontos (uma vez por dia)
    if (stored('dyna_daily_' + uid) === day) return;
    const { data, error } = await db.rpc('claim_daily_bonus');
    if (error) return;
    store('dyna_daily_' + uid, day);
    if (data > 0) toast('+' + data + ' points: daily login bonus! \u{1F389}');
  }
  claim();
})();
