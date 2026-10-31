// Página "Play a Game": lista os mapas publicados e abre o jogo (motor em game.js).
(function () {
  'use strict';
  const W = window.World;
  const $ = id => document.getElementById(id);
  const levelParam = parseInt(new URLSearchParams(location.search).get('level'), 10);

  async function showList() {
    const box = $('gamelist');
    const { data, error } = await db.from('levels')
      .select('id, name, updated_at, profiles(username)')
      .eq('published', true).order('updated_at', { ascending: false }).limit(100);
    if (error) { box.textContent = error.message; return; }
    if (!data.length) { box.textContent = 'No games have been published yet. Be the first!'; return; }
    const t = document.createElement('table');
    t.className = 'mygb-table';
    t.innerHTML = '<tr><th>Game</th><th>Author</th><th>Updated</th></tr>';
    data.forEach(g => {
      const tr = document.createElement('tr');
      const a = document.createElement('a');
      a.href = 'play.html?level=' + g.id;
      a.textContent = g.name;
      a.style.textDecoration = 'underline';
      const c1 = document.createElement('td'); c1.appendChild(a);
      const c2 = document.createElement('td'); c2.textContent = (g.profiles && g.profiles.username) || '?';
      const c3 = document.createElement('td'); c3.textContent = new Date(g.updated_at).toLocaleDateString();
      tr.append(c1, c2, c3);
      t.appendChild(tr);
    });
    box.innerHTML = '';
    box.appendChild(t);
  }

  async function startGame(id) {
    const { data: row, error } = await db.from('levels').select('id, name, data').eq('id', id).maybeSingle();
    if (error || !row) {
      $('gamelist').textContent = error ? error.message : 'Game not found (or it is not published).';
      return;
    }
    document.body.classList.add('fullapp');
    $('page').style.display = 'none';
    const sf = document.querySelector('.site-footer');
    if (sf) sf.style.display = 'none';
    $('gameview').style.display = 'block';
    $('hud-title').textContent = row.name;

    // multiplayer: precisa estar logado; use ?solo=1 no endereço para jogar sozinho
    const params = new URLSearchParams(location.search);
    let multiplayer = null;
    const { data: sess } = await db.auth.getSession();
    if (sess.session && !params.has('solo')) {
      const { data: prof } = await db.from('profiles').select('username').eq('id', sess.session.user.id).maybeSingle();
      multiplayer = { client: db, room: 'game-' + id, userId: sess.session.user.id, name: (prof && prof.username) || 'player' };
    }
    const box = $('hud-top').querySelector('.hudbox');
    const alt = document.createElement('a');
    alt.style.cssText = 'display:block;margin-top:4px;font-size:11px;text-decoration:underline';
    if (multiplayer) { alt.href = 'play.html?level=' + id + '&solo=1'; alt.textContent = 'Play alone'; }
    else if (sess.session) { alt.href = 'play.html?level=' + id; alt.textContent = 'Play online with others'; }
    else { alt.href = 'signin.html'; alt.textContent = 'Sign in to play online with others'; }
    box.appendChild(alt);

    const g = window.Game.start({ level: W.cleanLevel(row.data), container: $('gameview'), multiplayer });
    $('hud-respawn').onclick = g.respawn;
    $('hud-exit').onclick = () => { location.href = 'play.html'; };
    $('gameview').appendChild(W.makeCameraMenu({
      rotate: g.rotateCamera, zoom: g.zoomCamera, reset: g.resetCamera
    }));
  }

  if (levelParam) startGame(levelParam); else showList();
})();
