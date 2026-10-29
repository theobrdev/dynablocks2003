// Jogo do DynaBlocks: lê um mapa (JSON) do Supabase, desenha, simula o jogador e roda os scripts Lua.
(function () {
  'use strict';
  const W = window.World;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const levelParam = parseInt(params.get('level'), 10);

  // ---------------------------------------------------------------------
  //  Lua: tudo que o script do jogador pode fazer fica neste "prelúdio".
  //  O script roda numa caixa isolada (env): sem acesso à página, ao js,
  //  ao pcall/load/require/os/io/debug. Isso é o que impede um mapa de
  //  roubar a sessão de quem joga.
  // ---------------------------------------------------------------------
  const PRELUDE = [
    'local js = require "js"',
    'local DB = js.global.__DB',
    'local sethook = debug and debug.sethook',
    'local pcall, load, tostring, tonumber, type, error, select, pairs, ipairs, next, setmetatable, assert, getmetatable =',
    '  pcall, load, tostring, tonumber, type, error, select, pairs, ipairs, next, setmetatable, assert, getmetatable',
    'local math, table, concat = math, table, table.concat',
    '',
    '-- string.rep pode travar a aba com um numero enorme: tira da biblioteca (inclusive de ("x"):rep)',
    'local safe_string = {}',
    'for k, v in pairs(string) do if k ~= "rep" then safe_string[k] = v end end',
    'getmetatable("").__index = safe_string',
    '',
    'local touch, timers = {}, {}',
    '',
    'local function num(v, d)',
    '  v = tonumber(v)',
    '  if v == nil or v ~= v then return d or 0 end',
    '  return v',
    'end',
    '',
    '-- limite de instrucoes: um "while true do end" nao congela o navegador',
    'local function guarded(f)',
    '  if sethook then sethook(function() error("script ran too long") end, "", 3000000) end',
    '  local ok, err = pcall(f)',
    '  if sethook then sethook() end',
    '  if not ok then DB:log("[error] " .. tostring(err)) end',
    'end',
    '',
    'local env = {',
    '  math = math, string = safe_string, table = table,',
    '  pairs = pairs, ipairs = ipairs, next = next, select = select,',
    '  type = type, tostring = tostring, tonumber = tonumber, assert = assert, error = error,',
    '  setmetatable = setmetatable,',
    '}',
    '',
    'env.print = function(...)',
    '  local t = {}',
    '  for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end',
    '  DB:log(concat(t, " "))',
    'end',
    'env.message = function(text) DB:message(tostring(text)) end',
    'env.win = function(text) DB:win(tostring(text or "You win!")) end',
    'env.kill = function() DB:kill() end',
    'env.teleport = function(x, y, z) DB:teleport(num(x), num(y), num(z)) end',
    'env.setColor = function(name, color) DB:setColor(tostring(name), tostring(color)) end',
    'env.setPosition = function(name, x, y, z) DB:setPosition(tostring(name), num(x), num(y), num(z)) end',
    'env.getPosition = function(name)',
    '  name = tostring(name)',
    '  return DB:getX(name), DB:getY(name), DB:getZ(name)',
    'end',
    'env.setVisible = function(name, visible) DB:setVisible(tostring(name), visible and true or false) end',
    'env.onTouch = function(name, fn)',
    '  if type(fn) == "function" then touch[tostring(name)] = fn end',
    'end',
    'env.every = function(seconds, fn)',
    '  if type(fn) == "function" and #timers < 20 then',
    '    local s = num(seconds, 1)',
    '    if s < 0.05 then s = 0.05 end',
    '    timers[#timers + 1] = { acc = 0, every = s, fn = fn }',
    '  end',
    'end',
    '',
    'function __run_pending()',
    '  local name, src = DB.name, DB.src',
    '  local f, err = load(src, "=" .. tostring(name), "t", env)',
    '  if not f then DB:log("[syntax error] " .. tostring(err)) return end',
    '  guarded(f)',
    'end',
    '',
    'function __fire_touch()',
    '  local fn = touch[DB.arg]',
    '  if fn then guarded(fn) end',
    'end',
    '',
    'function __tick()',
    '  local dt = num(DB.dt, 0)',
    '  for i = 1, #timers do',
    '    local t = timers[i]',
    '    t.acc = t.acc + dt',
    '    if t.acc >= t.every then',
    '      t.acc = t.acc - t.every',
    '      guarded(t.fn)',
    '    end',
    '  end',
    'end'
  ].join('\n');

  // ---------------------------------------------------------------------
  //  Lista de jogos
  // ---------------------------------------------------------------------
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

  // ---------------------------------------------------------------------
  //  Jogo
  // ---------------------------------------------------------------------
  async function startGame(id) {
    const { data: row, error } = await db.from('levels')
      .select('id, name, data').eq('id', id).maybeSingle();
    if (error || !row) {
      $('gamelist').textContent = error ? error.message : 'Game not found (or it is not published).';
      return;
    }
    const level = W.cleanLevel(row.data);

    document.body.classList.add('fullapp');
    $('page').style.display = 'none';
    const sf = document.querySelector('.site-footer');
    if (sf) sf.style.display = 'none';
    $('gameview').style.display = 'block';
    $('hud-title').textContent = row.name;

    // --- cena ---
    const view = $('gameview');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    view.insertBefore(renderer.domElement, view.firstChild);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9cc4ee);
    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 3000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(20, 40, 10);
    scene.add(sun);
    function resize() {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    // --- partes ---
    const parts = [];
    const byName = {};
    function computeBox(p) {
      const o = p.obj;
      p.box = {
        min: { x: o.position.x - o.size.x / 2, y: o.position.y - o.size.y / 2, z: o.position.z - o.size.z / 2 },
        max: { x: o.position.x + o.size.x / 2, y: o.position.y + o.size.y / 2, z: o.position.z + o.size.z / 2 }
      };
    }
    level.objects.filter(o => o.type === 'Part').forEach(o => {
      const mesh = W.makePartMesh(o);
      scene.add(mesh);
      const p = { obj: o, mesh, visible: true, touching: false, box: null };
      computeBox(p);
      parts.push(p);
      (byName[o.name] = byName[o.name] || []).push(p);
    });
    const named = n => byName[String(n)] || [];

    // --- jogador (caixa 1 x 2 x 1) ---
    const half = { x: 0.5, y: 1, z: 0.5 };
    const P = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: false };
    const playerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1), new THREE.MeshLambertMaterial({ color: 0xf0b020 }));
    playerMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(playerMesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x000000 })));
    scene.add(playerMesh);

    const spawnPart = (named('SpawnBlock')[0]) || parts[0];
    function spawnPoint() {
      if (!spawnPart) return { x: 0, y: 5, z: 0 };
      const o = spawnPart.obj;
      return { x: o.position.x, y: o.position.y + o.size.y / 2 + half.y + 0.05, z: o.position.z };
    }
    function teleport(x, y, z) {
      P.pos.set(x, y, z);
      P.vel.set(0, 0, 0);
    }
    function respawn() { const s = spawnPoint(); teleport(s.x, s.y, s.z); }
    respawn();

    // --- HUD ---
    let msgTimer = null;
    function showMsg(text, ms) {
      const el = $('hud-msg');
      el.textContent = text;
      el.style.display = 'block';
      clearTimeout(msgTimer);
      if (ms) msgTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
    }
    const logLines = [];
    function hudLog(text) {
      logLines.push(String(text).slice(0, 200));
      while (logLines.length > 8) logLines.shift();
      const el = $('hud-log');
      el.textContent = logLines.join('\n');
      el.style.display = 'block';
    }

    // --- ponte JS <-> Lua (só primitivos passam daqui) ---
    const clampPos = v => W.num(v, 0, -5000, 5000);
    const DB = {
      name: '', src: '', arg: '', dt: 0,
      log: s => hudLog(s),
      message: s => showMsg(String(s).slice(0, 120), 4000),
      win: s => showMsg(String(s).slice(0, 120), 0),
      kill: () => { respawn(); showMsg('You died!', 1500); },
      teleport: (x, y, z) => teleport(clampPos(x), clampPos(y), clampPos(z)),
      setColor: (n, c) => {
        if (W.COLORS[c] === undefined) return;
        named(n).forEach(p => { p.obj.color = c; p.mesh.material.color.setHex(W.COLORS[c]); });
      },
      setPosition: (n, x, y, z) => {
        named(n).forEach(p => {
          p.obj.position.x = clampPos(x); p.obj.position.y = clampPos(y); p.obj.position.z = clampPos(z);
          W.applyPart(p.mesh, p.obj);
          computeBox(p);
        });
      },
      getX: n => (named(n)[0] ? named(n)[0].obj.position.x : 0),
      getY: n => (named(n)[0] ? named(n)[0].obj.position.y : 0),
      getZ: n => (named(n)[0] ? named(n)[0].obj.position.z : 0),
      setVisible: (n, v) => {
        named(n).forEach(p => { p.visible = !!v; p.mesh.visible = !!v; });
      }
    };

    // --- inicia o Lua e roda os scripts do mapa ---
    let luaRun = null, luaTouch = null, luaTick = null;
    try {
      if (!window.fengari) throw new Error('Lua engine did not load');
      window.__DB = DB;
      window.fengari.load(PRELUDE)();
      window.__DB = undefined;
      luaRun = window.fengari.load('__run_pending()');
      luaTouch = window.fengari.load('__fire_touch()');
      luaTick = window.fengari.load('__tick()');
      level.objects.filter(o => o.type === 'Script').forEach(s => {
        DB.name = s.name;
        DB.src = s.source_code;
        try { luaRun(); } catch (e) { hudLog('[error] ' + (e && e.message ? e.message : e)); }
      });
    } catch (e) {
      window.__DB = undefined;
      hudLog('[Lua unavailable] ' + (e && e.message ? e.message : e));
    }

    // --- controles ---
    const keys = {};
    window.addEventListener('keydown', e => {
      keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });
    let yaw = 0, pitch = 0.45, dist = 12, looking = false, lx = 0, ly = 0;
    renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
    renderer.domElement.addEventListener('mousedown', e => {
      if (e.button === 2) { looking = true; lx = e.clientX; ly = e.clientY; e.preventDefault(); }
    });
    window.addEventListener('mouseup', () => { looking = false; });
    window.addEventListener('mousemove', e => {
      if (!looking) return;
      yaw -= (e.clientX - lx) * 0.008;
      pitch = Math.min(1.4, Math.max(-0.2, pitch + (e.clientY - ly) * 0.006));
      lx = e.clientX; ly = e.clientY;
    });
    renderer.domElement.addEventListener('wheel', e => {
      e.preventDefault();
      dist = Math.min(40, Math.max(4, dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: false });
    $('hud-respawn').onclick = respawn;
    $('hud-exit').onclick = () => { location.href = 'play.html'; };

    // --- física simples (caixas alinhadas aos eixos) ---
    const hits = b => (
      P.pos.x + half.x > b.min.x && P.pos.x - half.x < b.max.x &&
      P.pos.y + half.y > b.min.y && P.pos.y - half.y < b.max.y &&
      P.pos.z + half.z > b.min.z && P.pos.z - half.z < b.max.z);
    function moveAxis(ax, d) {
      if (d === 0) return;
      P.pos[ax] += d;
      for (const p of parts) {
        if (!p.visible || !hits(p.box)) continue;
        if (d > 0) P.pos[ax] = p.box.min[ax] - half[ax] - 0.001;
        else {
          P.pos[ax] = p.box.max[ax] + half[ax] + 0.001;
          if (ax === 'y') P.onGround = true;
        }
        P.vel[ax] = 0;
      }
    }
    function physics(dt) {
      const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
      const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // para frente (da câmera para o jogador)
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // para a direita
      let vx = fx * f + rx * r, vz = fz * f + rz * r;
      const len = Math.hypot(vx, vz);
      if (len > 0) { vx = vx / len * 9; vz = vz / len * 9; }
      P.vel.x = vx; P.vel.z = vz;
      if (keys.Space && P.onGround) { P.vel.y = 13; P.onGround = false; }
      P.vel.y -= 32 * dt;
      if (P.vel.y < -60) P.vel.y = -60;
      P.onGround = false;
      moveAxis('x', P.vel.x * dt);
      moveAxis('z', P.vel.z * dt);
      moveAxis('y', P.vel.y * dt);
      if (P.pos.y < -120) { respawn(); showMsg('You fell!', 1200); }
    }
    function checkTouches() {
      if (!luaTouch) return;
      for (const p of parts) {
        if (!p.visible) { p.touching = false; continue; }
        const m = 0.08, b = p.box;
        const t = P.pos.x + half.x + m > b.min.x && P.pos.x - half.x - m < b.max.x &&
                  P.pos.y + half.y + m > b.min.y && P.pos.y - half.y - m < b.max.y &&
                  P.pos.z + half.z + m > b.min.z && P.pos.z - half.z - m < b.max.z;
        if (t && !p.touching) {
          DB.arg = p.obj.name;
          try { luaTouch(); } catch (e) { hudLog('[error] ' + (e && e.message ? e.message : e)); }
        }
        p.touching = t;
      }
    }

    // --- laço principal ---
    let last = performance.now();
    (function loop(now) {
      requestAnimationFrame(loop);
      let dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
      for (let i = 0; i < steps; i++) physics(dt / steps);
      checkTouches();
      if (luaTick) {
        DB.dt = dt;
        try { luaTick(); } catch (e) { hudLog('[error] ' + (e && e.message ? e.message : e)); }
      }
      playerMesh.position.copy(P.pos);
      const tx = P.pos.x, ty = P.pos.y + 0.8, tz = P.pos.z;
      camera.position.set(
        tx + Math.sin(yaw) * Math.cos(pitch) * dist,
        ty + Math.sin(pitch) * dist,
        tz + Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(tx, ty, tz);
      renderer.render(scene, camera);
    })(performance.now());
  }

  if (levelParam) startGame(levelParam); else showList();
})();
