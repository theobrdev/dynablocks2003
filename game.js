// Motor do jogo do DynaBlocks (usado por play.html e pelo botão Play do editor).
// Lê um mapa (já limpo por World.cleanLevel), desenha, simula o jogador e roda os scripts Lua.
// Game.start({ level, container }) devolve { stop, respawn, rotateCamera, zoomCamera, resetCamera }.
(function () {
  'use strict';
  const W = window.World;

  // ---------------------------------------------------------------------
  //  Lua: o script do jogador roda numa caixa isolada (env): sem acesso à
  //  página, ao js, ao pcall/load/require/os/io/debug.
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
    'local touch, click, timers = {}, {}, {}',
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
    'env.onClick = function(name, fn)',
    '  if type(fn) == "function" then click[tostring(name)] = fn end',
    'end',
    'env.every = function(seconds, fn)',
    '  if type(fn) == "function" and #timers < 20 then',
    '    local s = num(seconds, 1)',
    '    if s < 0.05 then s = 0.05 end',
    '    timers[#timers + 1] = { acc = 0, every = s, fn = fn }',
    '  end',
    'end',
    '',
    'env.addScore = function(n) DB:addScore(num(n)) end',
    'env.setScore = function(n) DB:setScore(num(n)) end',
    'env.getScore = function() return DB:getScore() end',
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
    'function __fire_click()',
    '  local fn = click[DB.arg]',
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

  const HOP = [0, 18, 27, 38];   // força do pulo dos blocos "Hopper": nenhum, baixo, médio, alto

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function start(opts) {
    const level = opts.level;
    const container = opts.container;
    const layer = el('div', 'gamelayer');
    container.appendChild(layer);

    let running = true, raf = 0, msgTimer = null;
    const cleanups = [];
    const on = (target, ev, fn, o) => { target.addEventListener(ev, fn, o); cleanups.push(() => target.removeEventListener(ev, fn, o)); };

    // --- cena ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    layer.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    W.applySky(scene, level.sky);
    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 3000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(20, 40, 10);
    scene.add(sun);
    function resize() {
      const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    on(window, 'resize', resize);
    resize();

    // --- HUD: Timer, Score, mensagem e console ---
    const hud = el('div', 'gv-hud');
    const timerEl = el('div', null, 'Timer: 0.0');
    const scoreEl = el('div', null, 'Score: 0');
    hud.append(timerEl, scoreEl);
    const onlineEl = el('div', null, '');
    onlineEl.style.fontSize = '16px';
    if (opts.multiplayer) hud.append(onlineEl);
    const msgEl = el('div', 'gv-msg');
    const logEl = el('div', 'gv-log');
    layer.append(hud, msgEl, logEl);

    let score = 0, elapsed = 0, finished = false;
    const updateScore = () => { scoreEl.textContent = 'Score: ' + score; };
    function showMsg(text, ms) {
      msgEl.textContent = text;
      msgEl.style.display = 'block';
      clearTimeout(msgTimer);
      if (ms) msgTimer = setTimeout(() => { msgEl.style.display = 'none'; }, ms);
    }
    const logLines = [];
    function hudLog(text) {
      logLines.push(String(text).slice(0, 200));
      while (logLines.length > 8) logLines.shift();
      logEl.textContent = logLines.join('\n');
      logEl.style.display = 'block';
    }
    function winGame(text) {
      if (finished) return;
      finished = true;
      showMsg(text, 0);
    }

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
      const p = { obj: o, mesh, visible: true, solid: o.controller !== 'Coin', touching: false, box: null };
      computeBox(p);
      parts.push(p);
      (byName[o.name] = byName[o.name] || []).push(p);
    });
    const named = n => byName[String(n)] || [];

    // --- jogador: personagem clássico (cabeça e braços amarelos, roupa de cor aleatória) ---
    const half = { x: 0.5, y: 1, z: 0.5 };
    const P = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: false, standing: null };
    let face = 0, moving = false, walkT = 0, swingAmp = 0;

    const SHIRTS = [0xcc2222, 0xe8d020, 0x2e9e3e, 0x2a5bd7, 0x20c8d8, 0xcc2aa8];   // vermelho, amarelo, verde, azul, ciano, magenta
    const shirt = SHIRTS.includes(opts.shirtColor) ? opts.shirtColor : SHIRTS[Math.floor(Math.random() * SHIRTS.length)];
    const SKIN = 0xf2c81a;
    function charBox(w, h, d, color) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x000000 })));
      return m;
    }
    function limb(w, h, d, color, x, y) {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      const m = charBox(w, h, d, color);
      m.position.y = -h / 2;
      g.add(m);
      return g;
    }
    function makeCharacterBasic(shirtColor) {
      const pants = new THREE.Color(shirtColor).multiplyScalar(0.8).getHex();
      const group = new THREE.Group();
      const torso = charBox(0.7, 0.75, 0.4, shirtColor);
      torso.position.set(0, 0.075, 0);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), new THREE.MeshPhongMaterial({ color: SKIN, shininess: 70 }));
      head.position.set(0, 0.725, 0);
      const armL = limb(0.28, 0.75, 0.4, SKIN, -0.49, 0.45);
      const armR = limb(0.28, 0.75, 0.4, SKIN, 0.49, 0.45);
      const legL = limb(0.35, 0.7, 0.4, pants, -0.175, -0.3);
      const legR = limb(0.35, 0.7, 0.4, pants, 0.175, -0.3);
      group.add(torso, head, armL, armR, legL, legR);
      return { group, armL, armR, legL, legR };
    }
    function makeCharacter(shirtColor) {
      return window.Avatar ? window.Avatar.make(shirtColor) : makeCharacterBasic(shirtColor);
    }
    const mine = makeCharacter(shirt);
    if (mine.setOutfit && opts.outfit) mine.setOutfit(opts.outfit);
    const playerMesh = mine.group, armL = mine.armL, armR = mine.armR, legL = mine.legL, legR = mine.legR;
    scene.add(playerMesh);

    const spawnPart = named('SpawnBlock')[0] || parts[0];
    let spawn = { x: 0, y: 5, z: 0 };
    if (spawnPart) {
      const o = spawnPart.obj;
      spawn = { x: o.position.x, y: o.position.y + o.size.y / 2 + half.y + 0.05, z: o.position.z };
    }
    function teleport(x, y, z) { P.pos.set(x, y, z); P.vel.set(0, 0, 0); }
    function respawn() { teleport(spawn.x, spawn.y, spawn.z); }
    respawn();

    // --- ponte JS <-> Lua (só valores simples passam daqui) ---
    const clampPos = v => W.num(v, 0, -5000, 5000);
    const DB = {
      name: '', src: '', arg: '', dt: 0,
      log: s => hudLog(s),
      message: s => showMsg(String(s).slice(0, 120), 4000),
      win: s => winGame(String(s).slice(0, 120)),
      kill: () => { respawn(); showMsg('You died!', 1500); },
      teleport: (x, y, z) => teleport(clampPos(x), clampPos(y), clampPos(z)),
      addScore: n => { score += Math.round(W.num(n, 0, -1e6, 1e6)); updateScore(); },
      setScore: n => { score = Math.round(W.num(n, 0, -1e9, 1e9)); updateScore(); },
      getScore: () => score,
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
      setVisible: (n, v) => { named(n).forEach(p => { p.visible = !!v; p.mesh.visible = !!v; }); }
    };

    // --- inicia o Lua e roda os scripts do mapa ---
    let luaRun = null, luaTouch = null, luaTick = null, luaClick = null;
    try {
      if (!window.fengari) throw new Error('Lua engine did not load');
      window.__DB = DB;
      window.fengari.load(PRELUDE)();
      window.__DB = undefined;
      luaRun = window.fengari.load('__run_pending()');
      luaTouch = window.fengari.load('__fire_touch()');
      luaClick = window.fengari.load('__fire_click()');
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

    // --- controles: teclado + mouse no computador; joystick, botão de pular e gestos no celular ---
    const keys = {};
    const touchMove = { x: 0, y: 0 };            // joystick: x = direita, y = baixo (como na tela)
    let touchJump = false;
    let lastTouchAt = 0;                         // o celular também gera "cliques de mouse" falsos; ignoramos esses
    on(window, 'keydown', e => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
    on(window, 'keyup', e => { keys[e.code] = false; });
    let yaw = 0, pitch = 0.45, dist = 12, looking = false, lx = 0, ly = 0;
    const cv = renderer.domElement;
    cv.style.touchAction = 'none';

    // clicar (mouse) ou tocar (celular) numa parte do mapa: dispara onClick("Parte", ...) dos scripts
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function clickAt(cx, cy) {
      if (!luaClick) return;
      const rect = cv.getBoundingClientRect();
      ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(parts.filter(p => p.visible).map(p => p.mesh), false);
      if (!hits.length) return;
      const p = parts.find(q => q.mesh === hits[0].object);
      if (!p) return;
      DB.arg = p.obj.name;
      try { luaClick(); } catch (e) { hudLog('[error] ' + (e && e.message ? e.message : e)); }
    }

    // mouse
    let mdown = null;
    on(cv, 'contextmenu', e => e.preventDefault());
    on(cv, 'mousedown', e => {
      if (e.button === 2) { looking = true; lx = e.clientX; ly = e.clientY; e.preventDefault(); }
      else if (e.button === 0) mdown = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    on(window, 'mouseup', e => {
      looking = false;
      if (e.button === 0 && mdown) {
        const moved = Math.hypot(e.clientX - mdown.x, e.clientY - mdown.y);
        if (moved < 6 && performance.now() - mdown.t < 500 && performance.now() - lastTouchAt > 700) clickAt(e.clientX, e.clientY);
        mdown = null;
      }
    });
    on(window, 'mousemove', e => {
      if (!looking) return;
      api.rotateCamera(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
    });
    on(cv, 'wheel', e => { e.preventDefault(); api.zoomCamera(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

    // celular: aparece sozinho em telas de toque (ou force com opts.touch = true / ?touch=1 no endereço)
    const isTouch = opts.touch === true ||
      (opts.touch !== false && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (isTouch) {
      layer.classList.add('touch-ui');
      const joy = el('div', 'tc-joy');
      const knob = el('div', 'tc-knob');
      joy.append(knob);
      const jumpBtn = el('div', 'tc-jump', 'JUMP');
      layer.append(joy, jumpBtn);

      // joystick (esquerda): move o personagem na direção em que a câmera olha
      let joyId = null;
      function joyUpdate(e) {
        const rect = joy.getBoundingClientRect();
        const half = rect.width / 2;
        let dx = e.clientX - (rect.left + half), dy = e.clientY - (rect.top + half);
        const d = Math.hypot(dx, dy);
        if (d > half) { dx = dx / d * half; dy = dy / d * half; }
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        const nx = dx / half, ny = dy / half;
        if (Math.hypot(nx, ny) < 0.2) { touchMove.x = 0; touchMove.y = 0; }   // zona morta no centro
        else { touchMove.x = nx; touchMove.y = ny; }
      }
      const joyEnd = e => {
        if (e.pointerId !== joyId) return;
        joyId = null; knob.style.transform = ''; touchMove.x = 0; touchMove.y = 0;
      };
      joy.addEventListener('pointerdown', e => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); lastTouchAt = performance.now(); joyUpdate(e); e.preventDefault(); });
      joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyUpdate(e); });
      joy.addEventListener('pointerup', joyEnd);
      joy.addEventListener('pointercancel', joyEnd);

      // botão de pular (direita)
      let jumpId = null;
      const jumpEnd = e => { if (e.pointerId !== jumpId) return; jumpId = null; touchJump = false; jumpBtn.classList.remove('on'); };
      jumpBtn.addEventListener('pointerdown', e => { jumpId = e.pointerId; jumpBtn.setPointerCapture(e.pointerId); lastTouchAt = performance.now(); touchJump = true; jumpBtn.classList.add('on'); e.preventDefault(); });
      jumpBtn.addEventListener('pointerup', jumpEnd);
      jumpBtn.addEventListener('pointercancel', jumpEnd);

      // resto da tela: 1 dedo arrastando gira a câmera, 2 dedos (pinça) dão zoom, um toque rápido "clica"
      const fingers = new Map();
      let pinch = 0, tap = null;
      const spread = () => {
        const pts = [...fingers.values()];
        return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      };
      cv.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'touch') return;
        lastTouchAt = performance.now();
        cv.setPointerCapture(e.pointerId);
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        tap = fingers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
        if (fingers.size === 2) pinch = spread();
        e.preventDefault();
      });
      cv.addEventListener('pointermove', e => {
        if (e.pointerType !== 'touch' || !fingers.has(e.pointerId)) return;
        const prev = fingers.get(e.pointerId);
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (fingers.size === 1) {
          api.rotateCamera(dx * 1.4, dy * 1.4);
          if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap = null;   // virou arrasto, não é toque
        } else if (fingers.size === 2) {
          const d = spread();
          if (pinch > 0 && d > 0) api.zoomCamera(pinch / d);       // dedos se afastando = aproxima
          pinch = d;
        }
      });
      const fingerEnd = e => {
        if (e.pointerType !== 'touch' || !fingers.has(e.pointerId)) return;
        lastTouchAt = performance.now();
        if (e.type === 'pointerup' && fingers.size === 1 && tap && performance.now() - tap.t < 450) clickAt(e.clientX, e.clientY);
        fingers.delete(e.pointerId);
        tap = null; pinch = 0;
      };
      cv.addEventListener('pointerup', fingerEnd);
      cv.addEventListener('pointercancel', fingerEnd);
    }

    // --- física simples (caixas alinhadas aos eixos) ---
    const hits = b => (
      P.pos.x + half.x > b.min.x && P.pos.x - half.x < b.max.x &&
      P.pos.y + half.y > b.min.y && P.pos.y - half.y < b.max.y &&
      P.pos.z + half.z > b.min.z && P.pos.z - half.z < b.max.z);
    function moveAxis(ax, d) {
      if (d === 0) return;
      P.pos[ax] += d;
      for (const p of parts) {
        if (!p.visible || !p.solid || !hits(p.box)) continue;
        if (d > 0) P.pos[ax] = p.box.min[ax] - half[ax] - 0.001;
        else {
          P.pos[ax] = p.box.max[ax] + half[ax] + 0.001;
          if (ax === 'y') { P.onGround = true; P.standing = p; }
        }
        P.vel[ax] = 0;
        if (ax === 'y' && d < 0) {                       // blocos "Hopper": jogam o personagem para cima
          const hp = HOP[p.obj.hopper | 0] || 0;
          if (hp) { P.vel.y = hp; P.onGround = false; P.standing = null; }
        }
      }
    }
    function physics(dt) {
      const surf = (P.onGround && P.standing) ? P.standing.obj.surface : 'Smooth';
      let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
      let r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      if (touchMove.x || touchMove.y) { f += -touchMove.y; r += touchMove.x; }   // joystick do celular
      const mag = Math.min(1, Math.hypot(f, r));                                 // empurrar o joystick pela metade = andar mais devagar
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // para frente (da câmera para o jogador)
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // para a direita
      let vx = fx * f + rx * r, vz = fz * f + rz * r;
      const len = Math.hypot(vx, vz);
      moving = len > 0;
      const speed = surf === 'Sticky' ? 4.5 : 9;
      if (moving) { vx = vx / len * speed * mag; vz = vz / len * speed * mag; face = Math.atan2(vx, vz); }
      if (surf === 'Ice') {                               // gelo: escorrega
        const k = Math.min(1, dt * 1.2);
        P.vel.x += (vx - P.vel.x) * k;
        P.vel.z += (vz - P.vel.z) * k;
      } else { P.vel.x = vx; P.vel.z = vz; }
      if ((keys.Space || touchJump) && P.onGround) { P.vel.y = 13; P.onGround = false; }
      P.vel.y -= 32 * dt;
      if (P.vel.y < -60) P.vel.y = -60;
      P.onGround = false;
      P.standing = null;
      moveAxis('x', P.vel.x * dt);
      moveAxis('z', P.vel.z * dt);
      moveAxis('y', P.vel.y * dt);
      if (P.pos.y < -120) { respawn(); showMsg('You fell!', 1200); }
    }

    function touched(p) {                                  // comportamento do "Controller" + scripts Lua
      const c = p.obj.controller;
      if (c === 'Kill') DB.kill();
      else if (c === 'Goal') winGame('You win!');
      else if (c === 'Checkpoint') {
        spawn = { x: p.obj.position.x, y: p.obj.position.y + p.obj.size.y / 2 + half.y + 0.05, z: p.obj.position.z };
        showMsg('Checkpoint!', 1200);
      } else if (c === 'Coin') {
        DB.addScore(100);
        p.visible = false; p.mesh.visible = false;
      }
      if (luaTouch) {
        DB.arg = p.obj.name;
        try { luaTouch(); } catch (e) { hudLog('[error] ' + (e && e.message ? e.message : e)); }
      }
    }
    function checkTouches() {
      for (const p of parts) {
        if (!p.visible) { p.touching = false; continue; }
        const m = 0.08, b = p.box;
        const t = P.pos.x + half.x + m > b.min.x && P.pos.x - half.x - m < b.max.x &&
                  P.pos.y + half.y + m > b.min.y && P.pos.y - half.y - m < b.max.y &&
                  P.pos.z + half.z + m > b.min.z && P.pos.z - half.z - m < b.max.z;
        if (t && !p.touching) touched(p);
        p.touching = t;
      }
    }

    // --- multiplayer (Supabase Realtime): cada jogador manda a própria posição; os outros aparecem como personagens com nome ---
    const cfg = opts.multiplayer || null;
    const MP_MAX = 8;
    const remotes = {};
    let mp = null;
    function makeLabel(text) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const x = c.getContext('2d');
      x.font = 'bold 30px Arial'; x.textAlign = 'center';
      x.lineWidth = 6; x.strokeStyle = '#000'; x.strokeText(text, 128, 42);
      x.fillStyle = '#fff'; x.fillText(text, 128, 42);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
      sp.scale.set(2.4, 0.6, 1);
      sp.position.y = 1.5;
      return sp;
    }
    const cleanNick = s => String(s || '?').replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 20) || '?';
    function dropRemote(id) {
      const r = remotes[id];
      if (!r) return;
      scene.remove(r.ch.group);
      r.label.material.map.dispose();
      r.label.material.dispose();
      delete remotes[id];
    }
    function onRemote(p) {                         // tudo que chega da rede é tratado como "não confiável"
      if (!p || typeof p.id !== 'string' || !cfg || p.id === cfg.userId) return;
      const id = p.id.slice(0, 40);
      let r = remotes[id];
      if (!r) {
        if (Object.keys(remotes).length >= MP_MAX) return;
        const ch = makeCharacter(SHIRTS.includes(p.c) ? p.c : SHIRTS[0]);
        const label = makeLabel(cleanNick(p.n));
        ch.group.add(label);
        scene.add(ch.group);
        if (window.Avatar && ch.setOutfit) window.Avatar.loadOutfit(cfg.client, id).then(o => ch.setOutfit(o)).catch(() => {});
        r = remotes[id] = { ch, label, tx: 0, ty: 0, tz: 0, tf: 0, moving: false, last: 0, init: false, walk: 0, amp: 0 };
      }
      r.tx = W.num(p.x, 0, -5000, 5000); r.ty = W.num(p.y, 0, -5000, 5000); r.tz = W.num(p.z, 0, -5000, 5000);
      r.tf = W.num(p.f, 0, -10, 10); r.moving = p.m === 1; r.last = performance.now();
      if (!r.init) { r.ch.group.position.set(r.tx, r.ty, r.tz); r.init = true; }
    }
    if (cfg) {
      try {
        const chan = cfg.client.channel(cfg.room, { config: { broadcast: { self: false }, presence: { key: cfg.userId } } });
        mp = { chan, ready: false, count: 1, sendT: 0 };
        onlineEl.textContent = 'Online: connecting...';
        chan.on('broadcast', { event: 'pos' }, msg => onRemote(msg && msg.payload));
        chan.on('presence', { event: 'sync' }, () => {
          mp.count = Math.max(1, Object.keys(chan.presenceState()).length);
          onlineEl.textContent = 'Online: ' + mp.count;
        });
        chan.on('presence', { event: 'leave' }, ev => { if (ev && ev.key) dropRemote(ev.key); });
        chan.subscribe(status => {
          if (status === 'SUBSCRIBED') { mp.ready = true; chan.track({ name: cfg.name }); }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onlineEl.textContent = 'Online: offline';
        });
      } catch (e) {
        hudLog('[multiplayer unavailable] ' + (e && e.message ? e.message : e));
      }
    }
    function mpUpdate(now, dt) {
      for (const id of Object.keys(remotes)) {
        const r = remotes[id];
        if (now - r.last > 6000) { dropRemote(id); continue; }       // sumiu há 6 segundos: remove
        const k = Math.min(1, dt * 10), g = r.ch.group;
        g.position.x += (r.tx - g.position.x) * k;
        g.position.y += (r.ty - g.position.y) * k;
        g.position.z += (r.tz - g.position.z) * k;
        const d = Math.atan2(Math.sin(r.tf - g.rotation.y), Math.cos(r.tf - g.rotation.y));
        g.rotation.y += d * k;
        r.walk += dt * 10;
        r.amp += ((r.moving ? 0.8 : 0) - r.amp) * Math.min(1, dt * 12);
        const sw = Math.sin(r.walk) * r.amp;
        r.ch.armL.rotation.x = sw; r.ch.armR.rotation.x = -sw;
        r.ch.legL.rotation.x = -sw; r.ch.legR.rotation.x = sw;
      }
      // só envia se tiver mais alguém na sala; ~6 vezes por segundo (o plano gratuito tem limite de mensagens)
      if (mp && mp.ready && mp.count > 1 && now - mp.sendT > 160) {
        mp.sendT = now;
        mp.chan.send({ type: 'broadcast', event: 'pos', payload: {
          id: cfg.userId, n: cfg.name, c: shirt,
          x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2),
          f: +face.toFixed(2), m: (moving && P.onGround) ? 1 : 0 } });
      }
    }
    function mpStop() {
      if (mp) { try { cfg.client.removeChannel(mp.chan); } catch (e) { /* ignora */ } }
    }

    // --- laço principal ---
    let last = performance.now();
    function loop(now) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
      for (let i = 0; i < steps; i++) physics(dt / steps);
      checkTouches();
      if (luaTick) {
        DB.dt = dt;
        try { luaTick(); } catch (e) { hudLog('[error] ' + (e && e.message ? e.message : e)); }
      }
      if (!finished) { elapsed += dt; timerEl.textContent = 'Timer: ' + elapsed.toFixed(1); }

      mpUpdate(now, dt);
      playerMesh.position.copy(P.pos);
      playerMesh.rotation.y = face;
      walkT += dt * 10;
      swingAmp += ((moving && P.onGround ? 0.8 : 0) - swingAmp) * Math.min(1, dt * 12);
      const sw = Math.sin(walkT) * swingAmp;
      armL.rotation.x = sw; armR.rotation.x = -sw;
      legL.rotation.x = -sw; legR.rotation.x = sw;

      const tx = P.pos.x, ty = P.pos.y + 0.8, tz = P.pos.z;
      camera.position.set(
        tx + Math.sin(yaw) * Math.cos(pitch) * dist,
        ty + Math.sin(pitch) * dist,
        tz + Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(tx, ty, tz);
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(loop);

    const api = {
      respawn,
      rotateCamera: (dx, dy) => {
        yaw -= dx * 0.008;
        pitch = Math.min(1.4, Math.max(-0.2, pitch + dy * 0.006));
      },
      zoomCamera: f => { dist = Math.min(40, Math.max(4, dist * f)); },
      resetCamera: () => { yaw = 0; pitch = 0.45; dist = 12; },
      stop: () => {
        running = false;
        cancelAnimationFrame(raf);
        clearTimeout(msgTimer);
        cleanups.forEach(f => f());
        window.__DB = undefined;
        mpStop();
        renderer.dispose();
        layer.remove();
      }
    };
    return api;
  }

  window.Game = { start };
})();
