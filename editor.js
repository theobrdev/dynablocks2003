// Level Editor do DynaBlocks. Usa: THREE, db (Supabase), World (world.js) e Game (game.js).
(function () {
  'use strict';
  const W = window.World;
  const $ = id => document.getElementById(id);

  // Aviso claro se algum arquivo do site estiver desatualizado (cache do navegador ou arquivo não enviado)
  if (!W || !W.makeCameraMenu || !window.Game || !window.THREE) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:999;background:#fff3cd;' +
      'border:2px solid #b58100;padding:10px 14px;font:13px Arial,sans-serif;max-width:520px;box-shadow:3px 3px 10px rgba(0,0,0,.4)">' +
      '<b>Some editor files are out of date.</b><br>Upload the latest <code>editor.html</code>, <code>editor.css</code>, ' +
      '<code>editor.js</code>, <code>world.js</code> and <code>game.js</code> to GitHub, wait a minute and press Ctrl+F5.</div>');
    return;
  }

  // ---------- estado ("a memória do editor") ----------
  // ?mode=model abre o editor como "Build a Model": constrói um modelo para a Toolbox (em vez de um jogo)
  const MODEL_MODE = new URLSearchParams(location.search).get('mode') === 'model';
  const emptyModel = () => ({ map_name: 'Untitled Model', sky: W.defaultLevel().sky, objects: [] });
  let level = MODEL_MODE ? emptyModel() : W.defaultLevel();      // { map_name, objects: [...] }
  let modelId = null, modelStatus = null, modelOwner = null;     // modelo aberto (só no modo modelo)
  let isAdmin = false;
  let levelId = null;                // id no Supabase (null = ainda não salvo)
  let me = null;
  let selectedId = null;
  let tool = 'select';               // select | resize | rotate
  let activeTab = null;              // model | surface | color | controller | hopper
  let dirty = false;
  let playing = false;
  let game = null;
  const meshes = {};                 // id -> THREE.Mesh

  const objById = id => level.objects.find(o => o.id === id);
  const selected = () => (selectedId ? objById(selectedId) : null);
  const SNAP = 0.5;
  const snap = v => Math.round(v / SNAP) * SNAP;
  const r2 = v => Math.round(v * 100) / 100;
  const hex = n => '#' + n.toString(16).padStart(6, '0');

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) e[k] = props[k];
    kids.forEach(k => e.append(k));
    return e;
  }
  function status(text, isErr) {
    const s = $('status');
    s.textContent = text;
    s.className = isErr ? 'err' : '';
  }
  const HINTS = {
    select: 'Select: click a block. Drag to move it (Shift = height). Right-drag = camera, wheel = zoom.',
    resize: 'Resize: drag left/right = X size, up/down = Z size. Shift + drag = height.',
    rotate: 'Rotate: click a block to turn it 90 degrees.'
  };
  function markDirty() { dirty = true; }

  // ---------- desfazer / refazer ----------
  const undoStack = [], redoStack = [];
  let editSnap = null;
  const snapshot = () => JSON.stringify(level.objects);
  function updateUndoButtons() {
    $('t-undo').disabled = !undoStack.length;
    $('t-redo').disabled = !redoStack.length;
  }
  function pushUndo(json) {
    undoStack.push(json || snapshot());
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  }
  function restore(json) {
    level.objects = JSON.parse(json);
    if (selectedId && !objById(selectedId)) selectedId = null;
    rebuildScene();
    renderAll();
    markDirty();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    updateUndoButtons();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    updateUndoButtons();
  }
  function clearHistory() { undoStack.length = 0; redoStack.length = 0; updateUndoButtons(); }

  // ---------- Three.js ----------
  const container = $('viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  W.applySky(scene, level.sky);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(20, 40, 10);
  scene.add(sun);
  const grid = new THREE.GridHelper(100, 100, 0x555555, 0x7a8da0);
  grid.position.y = 0.02;
  scene.add(grid);
  const orbit = new W.OrbitCam(camera, renderer.domElement);

  function resize() {
    const w = container.clientWidth, hh = container.clientHeight;
    if (!w || !hh) return;
    renderer.setSize(w, hh);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  (function loop() {
    requestAnimationFrame(loop);
    if (!playing) renderer.render(scene, camera);
  })();

  function clearScene() {
    for (const id in meshes) {
      scene.remove(meshes[id]);
      meshes[id].geometry.dispose();
      meshes[id].material.dispose();
      delete meshes[id];
    }
  }
  function addMesh(obj) {
    const m = W.makePartMesh(obj);
    meshes[obj.id] = m;
    scene.add(m);
  }
  function rebuildScene() {
    clearScene();
    level.objects.filter(o => o.type === 'Part').forEach(addMesh);
    paintSelection();
  }
  function paintSelection() {
    for (const id in meshes) {
      const sel = id === selectedId;
      meshes[id].material.emissive.setHex(sel ? 0x444400 : 0x000000);
      meshes[id].userData.edges.material.color.setHex(sel ? 0xffee00 : 0x000000);
    }
  }
  function syncMesh(obj) {
    if (meshes[obj.id]) W.applyPart(meshes[obj.id], obj);
  }

  // aplica o céu do mapa e avisa na barra de status se as imagens não forem encontradas
  function setSky(showOk) {
    W.applySky(scene, level.sky, ok => {
      if (!ok) status('Sky images not found in img/sky/ - showing plain blue. Check the folder and file names.', true);
      else if (showOk) status('Sky: ' + level.sky);
    });
  }

  // ---------- Explorer (janela opcional) ----------
  function renderExplorer() {
    const tree = $('tree');
    tree.innerHTML = '';
    tree.appendChild(h('div', { className: 'row root', textContent: '\u25BC Workspace' }));
    level.objects.forEach(o => {
      const row = h('div', {
        className: 'row' + (o.id === selectedId ? ' sel' : ''),
        textContent: '\u00A0\u00A0\u2514\u2500 ' + (o.type === 'Script' ? '\u{1F4DC} ' : '\u{1F9F1} ') + o.name
      });
      row.onclick = () => select(o.id);
      if (o.type === 'Script') row.ondblclick = () => openScript(o.id);
      tree.appendChild(row);
    });
  }

  // ---------- Abas de propriedades (Model, Surface, Color, Controller, Hopper) ----------
  function line(label, ...els) {
    return h('div', { className: 'line' }, h('span', { textContent: label }), ...els);
  }
  function numInput(value, onChange, min) {
    const i = h('input', { type: 'number', step: '0.5', value: r2(value) });
    if (min !== undefined) i.min = min;
    i.onfocus = () => { editSnap = snapshot(); };
    i.oninput = () => {
      const v = parseFloat(i.value);
      if (!isFinite(v)) return;
      if (editSnap) { pushUndo(editSnap); editSnap = null; }
      onChange(v);
    };
    return i;
  }
  function option(group, value, label, desc, checked, onPick) {
    const r = h('input', { type: 'radio', name: group, checked });
    r.onchange = () => onPick(value);
    const l = h('label', { className: 'opt' }, r, document.createTextNode(' ' + label));
    if (desc) l.appendChild(h('small', { textContent: desc }));
    return l;
  }
  function setProp(o, key, val) {
    pushUndo();
    o[key] = val;
    syncMesh(o);
    markDirty();
    renderProps();
  }

  const TAB_TITLES = { model: 'Model', surface: 'Surface', color: 'Color', controller: 'Controller', hopper: 'Hopper' };

  function renderProps() {
    document.querySelectorAll('#proptabs .tab').forEach(t => t.classList.toggle('on', t.dataset.tab === activeTab));
    const panel = $('proppanel');
    if (!activeTab) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    panel.innerHTML = '';
    panel.appendChild(h('div', { className: 'ptitle', textContent: TAB_TITLES[activeTab] }));
    const o = selected();
    if (!o || o.type !== 'Part') {
      panel.appendChild(h('div', { className: 'none', textContent: 'Select a block first.' }));
      return;
    }
    const body = h('div', { className: 'pbody' });
    panel.appendChild(body);

    if (activeTab === 'model') {
      const name = h('input', { type: 'text', maxLength: 30, value: o.name });
      name.onfocus = () => { editSnap = snapshot(); };
      name.onchange = () => {
        if (editSnap) { pushUndo(editSnap); editSnap = null; }
        o.name = W.cleanName(name.value, 'Part');
        name.value = o.name;
        markDirty();
        renderExplorer();
      };
      body.appendChild(line('Name', name));
      ['x', 'y', 'z'].forEach(ax => body.appendChild(line(ax === 'x' ? 'Position' : '', document.createTextNode(ax.toUpperCase()),
        numInput(o.position[ax], v => { o.position[ax] = W.num(v, 0, -2000, 2000); syncMesh(o); markDirty(); }))));
      ['x', 'y', 'z'].forEach(ax => body.appendChild(line(ax === 'x' ? 'Size' : '', document.createTextNode(ax.toUpperCase()),
        numInput(o.size[ax], v => { o.size[ax] = W.num(v, 1, 0.2, 500); syncMesh(o); markDirty(); }, 0.2))));
      const rot = h('button', { textContent: 'Rotate 90\u00B0', type: 'button' });
      rot.onclick = () => rotatePart(o);
      body.appendChild(rot);
    } else if (activeTab === 'surface') {
      body.appendChild(h('div', { textContent: 'How the top of this block feels:' }));
      [['Smooth', 'Normal ground.'], ['Ice', 'Slippery: you slide when you stop.'], ['Sticky', 'Sticky: you walk slowly.']]
        .forEach(([v, d]) => body.appendChild(option('surface', v, v, d, o.surface === v, x => setProp(o, 'surface', x))));
    } else if (activeTab === 'color') {
      const sw = h('div', { className: 'swatches' });
      Object.keys(W.COLORS).forEach(c => {
        const b = h('button', { type: 'button', title: c, className: o.color === c ? 'on' : '' });
        b.style.background = hex(W.COLORS[c]);
        b.onclick = () => setProp(o, 'color', c);
        sw.appendChild(b);
      });
      body.appendChild(sw);
      body.appendChild(h('div', { textContent: 'Color: ' + o.color, style: 'margin-top:6px' }));
    } else if (activeTab === 'controller') {
      body.appendChild(h('div', { textContent: 'What happens when the player touches it:' }));
      [['None', 'Nothing special.'], ['Kill', 'Sends the player back to the start.'], ['Goal', 'Wins the game.'],
       ['Checkpoint', 'Sets a new start point.'], ['Coin', 'Gives +100 score and disappears (no collision).']]
        .forEach(([v, d]) => body.appendChild(option('controller', v, v, d, o.controller === v, x => setProp(o, 'controller', x))));
    } else if (activeTab === 'hopper') {
      body.appendChild(h('div', { textContent: 'Makes the player hop when landing on it:' }));
      [[0, 'None', 'Normal block.'], [1, 'Low', 'A small hop.'], [2, 'Medium', 'A big hop.'], [3, 'High', 'A huge hop!']]
        .forEach(([v, label, d]) => body.appendChild(option('hopper', v, label, d, o.hopper === v, x => setProp(o, 'hopper', x))));
    }
  }

  function renderAll() {
    renderExplorer();
    renderProps();
    const has = !!selected();
    $('t-dup').disabled = !has;
    $('t-del').disabled = !has;
  }
  function select(id) {
    selectedId = id;
    paintSelection();
    renderAll();
  }

  // ---------- criar / apagar / girar ----------
  function nextName(base) {
    let i = 1;
    while (level.objects.some(o => o.name === base + i)) i++;
    return base + i;
  }
  function canAdd() {
    if (level.objects.length >= W.LIMITS.objects) { status('Limit reached: ' + W.LIMITS.objects + ' objects per map.', true); return false; }
    return true;
  }
  function insertTemplate(t) {
    if (!canAdd()) return;
    pushUndo();
    const o = {
      id: W.uid('part'), type: 'Part', name: nextName(t.name),
      position: { x: snap(orbit.target.x), y: snap(t.size[1] / 2), z: snap(orbit.target.z) },
      size: { x: t.size[0], y: t.size[1], z: t.size[2] },
      color: t.color, surface: t.surface || 'Smooth', controller: t.controller || 'None', hopper: t.hopper || 0
    };
    level.objects.push(o);
    addMesh(o);
    markDirty();
    select(o.id);
    status('Added ' + o.name + '. Drag it where you want.');
  }
  function createScript() {
    if (!canAdd()) return;
    pushUndo();
    const o = {
      id: W.uid('script'), type: 'Script', name: nextName('Script'),
      source_code: '-- Example: touching "Part1" gives 50 points\n-- onTouch("Part1", function() addScore(50) end)\nprint("Hello DynaBlocks!")\n'
    };
    level.objects.push(o);
    markDirty();
    renderAll();
    openScript(o.id);
  }
  function duplicate() {
    const o = selected();
    if (!o || !canAdd()) return;
    pushUndo();
    const c = JSON.parse(JSON.stringify(o));
    c.id = W.uid(o.type.toLowerCase());
    c.name = nextName(o.type);
    if (c.type === 'Part') { c.position.x += 1; c.position.z += 1; addMesh(c); }
    level.objects.push(c);
    markDirty();
    select(c.id);
  }
  function remove() {
    const o = selected();
    if (!o) return;
    pushUndo();
    if (meshes[o.id]) { scene.remove(meshes[o.id]); delete meshes[o.id]; }
    level.objects.splice(level.objects.indexOf(o), 1);
    markDirty();
    select(null);
  }
  function rotatePart(o) {            // gira 90 graus em Y (troca X e Z, pois a física usa caixas alinhadas aos eixos)
    if (!o || o.type !== 'Part') return;
    pushUndo();
    const t = o.size.x; o.size.x = o.size.z; o.size.z = t;
    syncMesh(o);
    markDirty();
    renderProps();
  }

  // ---------- ferramentas e mouse ----------
  // cursor da área 3D conforme a ferramenta (os do Old Roblox)
  const TOOL_CURSOR = {
    select: '',
    resize: "url('img/cursors/resize-nwse.cur') 15 15, nwse-resize",
    rotate: "url('img/cursors/alt.cur') 15 12, alias"
  };
  const MOVE_CURSOR = "url('img/cursors/move.cur') 15 15, move";
  function setTool(t) {
    tool = t;
    renderer.domElement.style.cursor = TOOL_CURSOR[t] || '';
    $('t-select').classList.toggle('on', t === 'select');
    $('t-resize').classList.toggle('on', t === 'resize');
    $('t-rotate').classList.toggle('on', t === 'rotate');
    status(HINTS[t]);
  }
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function setRay(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function pick(ev) {
    setRay(ev);
    const hits = raycaster.intersectObjects(Object.values(meshes), false);
    return hits.length ? hits[0].object.userData.id : null;
  }

  let drag = null;
  renderer.domElement.addEventListener('mousedown', ev => {
    if (playing || ev.button !== 0 || ev.altKey) return;
    const id = pick(ev);
    select(id);
    if (!id) return;
    const o = objById(id);
    if (tool === 'rotate') { rotatePart(o); return; }
    drag = { id, sx: ev.clientX, sy: ev.clientY, pos: { ...o.position }, size: { ...o.size }, off: null, before: snapshot(), moved: false };
    if (tool === 'select') {
      renderer.domElement.style.cursor = MOVE_CURSOR;        // arrastando um bloco
      drag.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -o.position.y);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(drag.plane, hit)) drag.off = { x: o.position.x - hit.x, z: o.position.z - hit.z };
    }
  });
  window.addEventListener('mousemove', ev => {
    if (!drag) return;
    const o = objById(drag.id);
    if (!o) { drag = null; return; }
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) < 3 && !drag.moved) return;
    drag.moved = true;
    if (tool === 'select') {
      if (ev.shiftKey) {
        o.position.y = W.num(snap(drag.pos.y - dy * 0.05), 0, -2000, 2000);
      } else if (drag.off) {
        setRay(ev);
        const hit = new THREE.Vector3();
        drag.plane.constant = -o.position.y;
        if (raycaster.ray.intersectPlane(drag.plane, hit)) {
          o.position.x = W.num(snap(hit.x + drag.off.x), 0, -2000, 2000);
          o.position.z = W.num(snap(hit.z + drag.off.z), 0, -2000, 2000);
        }
      }
    } else if (tool === 'resize') {
      if (ev.shiftKey) {
        o.size.y = W.num(snap(drag.size.y - dy * 0.05), 1, 0.2, 500);
      } else {
        o.size.x = W.num(snap(drag.size.x + dx * 0.05), 1, 0.2, 500);
        o.size.z = W.num(snap(drag.size.z - dy * 0.05), 1, 0.2, 500);
      }
    }
    syncMesh(o);
    markDirty();
    renderProps();
  });
  window.addEventListener('mouseup', () => {
    if (drag && drag.moved) pushUndo(drag.before);
    drag = null;
    renderer.domElement.style.cursor = TOOL_CURSOR[tool] || '';
  });

  // ---------- menu de blocos (barra de baixo) ----------
  const TEMPLATES = {
    Blocks: [
      { name: 'Block', size: [4, 1, 2], color: 'Gray', shape: 'box' },
      { name: 'Cube', size: [2, 2, 2], color: 'Brown', shape: 'box' },
      { name: 'Plank', size: [8, 0.5, 2], color: 'Brown', shape: 'flat' },
      { name: 'Wall', size: [8, 4, 1], color: 'White', shape: 'wide' },
      { name: 'Pillar', size: [1, 6, 1], color: 'Gray', shape: 'tall' },
      { name: 'Platform', size: [10, 1, 10], color: 'Green', shape: 'flat' }
    ],
    Special: [
      { name: 'KillBrick', size: [4, 1, 2], color: 'Red', controller: 'Kill', shape: 'box' },
      { name: 'Goal', size: [4, 1, 4], color: 'Green', controller: 'Goal', shape: 'box' },
      { name: 'Checkpoint', size: [3, 0.5, 3], color: 'Cyan', controller: 'Checkpoint', shape: 'flat' },
      { name: 'Coin', size: [1, 1, 1], color: 'Yellow', controller: 'Coin', shape: 'round' }
    ],
    Pads: [
      { name: 'BouncePad', size: [4, 0.5, 4], color: 'Magenta', hopper: 2, shape: 'flat' },
      { name: 'SuperPad', size: [4, 0.5, 4], color: 'Orange', hopper: 3, shape: 'flat' },
      { name: 'IceBlock', size: [6, 0.5, 6], color: 'Cyan', surface: 'Ice', shape: 'flat' },
      { name: 'StickyBlock', size: [6, 0.5, 6], color: 'Brown', surface: 'Sticky', shape: 'flat' }
    ]
  };
  const CATS = Object.keys(TEMPLATES);

  function itemIcon(t) {
    const i = h('i', { className: t.shape });
    i.style.setProperty('--c', hex(W.COLORS[t.color]));
    return i;
  }
  function renderItems() {
    const box = $('c-items');
    box.innerHTML = '';
    TEMPLATES[$('c-cat').value].forEach(t => {
      const b = h('button', { className: 'item', type: 'button', title: t.name }, itemIcon(t));
      b.onclick = () => insertTemplate(t);
      box.appendChild(b);
    });
  }
  function initCategories() {
    const sel = $('c-cat');
    CATS.forEach(c => sel.appendChild(h('option', { value: c, textContent: c })));
    sel.onchange = renderItems;
    $('c-prev').onclick = () => { sel.selectedIndex = (sel.selectedIndex + CATS.length - 1) % CATS.length; renderItems(); };
    $('c-next').onclick = () => { sel.selectedIndex = (sel.selectedIndex + 1) % CATS.length; renderItems(); };
    $('c-all').onclick = e => { e.preventDefault(); showModels(); };
    renderItems();
  }
  function showModels() {
    const list = $('models-list');
    list.innerHTML = '';
    const grid = h('div', { className: 'models-grid' });
    CATS.forEach(c => {
      grid.appendChild(h('div', { className: 'cat', textContent: c }));
      TEMPLATES[c].forEach(t => {
        const b = h('button', { type: 'button' }, itemIcon(t), document.createTextNode(t.name));
        b.onclick = () => { $('models-modal').style.display = 'none'; insertTemplate(t); };
        grid.appendChild(b);
      });
    });
    list.appendChild(grid);
    $('models-modal').style.display = 'flex';
  }

  // ---------- editor de script ----------
  let scriptId = null;
  function openScript(id) {
    const o = objById(id);
    if (!o || o.type !== 'Script') return;
    $('menu-modal').style.display = 'none';
    scriptId = id;
    $('script-title').textContent = 'Script: ' + o.name;
    $('script-src').value = o.source_code;
    $('script-modal').style.display = 'flex';
    $('script-src').focus();
  }
  function closeScript() { $('script-modal').style.display = 'none'; scriptId = null; }
  $('script-src').addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.target, s = t.selectionStart;
      t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
      t.selectionStart = t.selectionEnd = s + 2;
    }
  });
  $('script-save').onclick = () => {
    const o = scriptId && objById(scriptId);
    if (!o) return;
    pushUndo();
    o.source_code = $('script-src').value.slice(0, W.LIMITS.source);
    markDirty();
    status('Script "' + o.name + '" updated. Remember to Save the map.');
    closeScript();
  };
  $('script-close').onclick = closeScript;

  // ---------- MENU ----------
  function renderMenuScripts() {
    const box = $('menu-scripts');
    box.innerHTML = '';
    const list = level.objects.filter(o => o.type === 'Script');
    if (!list.length) { box.textContent = 'No scripts yet.'; return; }
    list.forEach(s => {
      const edit = h('button', { type: 'button', textContent: 'Edit' });
      edit.onclick = () => openScript(s.id);
      const del = h('button', { type: 'button', textContent: 'Delete' });
      del.onclick = () => {
        if (!confirm('Delete script "' + s.name + '"?')) return;
        pushUndo();
        level.objects.splice(level.objects.indexOf(s), 1);
        if (selectedId === s.id) selectedId = null;
        markDirty();
        renderAll();
        renderMenuScripts();
      };
      box.appendChild(h('div', { className: 'mrow' }, document.createTextNode('\u{1F4DC} ' + s.name + ' '), edit, document.createTextNode(' '), del));
    });
  }
  function showMenu() {
    renderMenuScripts();
    $('menu-modal').style.display = 'flex';
  }

  // ---------- salvar / abrir (Supabase) ----------
  async function save() {
    if (window.DynaCursor) window.DynaCursor.busy();        // cursor "ocupado" enquanto salva
    try { return await saveInner(); } finally { if (window.DynaCursor) window.DynaCursor.idle(); }
  }
  async function saveInner() {
    if (MODEL_MODE) return saveModel();
    const name = W.cleanName($('map-name').value, '');
    if (name.length < 3) { status('Map name: at least 3 characters (open MENU to change it).', true); return false; }
    level.map_name = name;
    $('map-name').value = name;
    const payload = { name, data: level, published: $('published').checked, updated_at: new Date().toISOString() };
    status('Saving...');
    let res;
    if (levelId) res = await db.from('levels').update(payload).eq('id', levelId).select('id').maybeSingle();
    else res = await db.from('levels').insert(payload).select('id').single();
    if (res.error) { status(res.error.message, true); return false; }
    if (!res.data) { status('Could not save this map.', true); return false; }
    levelId = res.data.id;
    dirty = false;
    status('Saved "' + name + '" at ' + new Date().toLocaleTimeString() + '.');
    if (window.checkAchievements) window.checkAchievements();      // conquistas de criação (aviso amarelo)
    return true;
  }
  function loadInto(row) {
    level = W.cleanLevel(row.data);
    levelId = row.id;
    $('map-name').value = row.name || level.map_name;
    $('published').checked = !!row.published;
    $('map-sky').value = level.sky;
    setSky(false);
    selectedId = null;
    clearHistory();
    rebuildScene();
    renderAll();
    dirty = false;
    status('Opened "' + (row.name || level.map_name) + '".');
  }
  async function openById(id) {
    if (MODEL_MODE) return openModelById(id);
    const { data, error } = await db.from('levels').select('id, name, data, published').eq('id', id).maybeSingle();
    if (error || !data) { status(error ? error.message : 'Map not found (or it is not yours).', true); return; }
    loadInto(data);
  }
  async function showOpen() {
    if (MODEL_MODE) return showOpenModels();
    $('menu-modal').style.display = 'none';
    const modal = $('open-modal'), list = $('open-list');
    modal.style.display = 'flex';
    list.textContent = 'Loading...';
    const { data, error } = await db.from('levels').select('id, name, published, updated_at')
      .eq('owner_id', me).order('updated_at', { ascending: false });
    if (error) { list.textContent = error.message; return; }
    if (!data.length) { list.textContent = 'You have no saved maps yet.'; return; }
    const t = h('table');
    t.innerHTML = '<tr><th>Map</th><th>Status</th><th>Updated</th><th></th></tr>';
    data.forEach(r => {
      const open = h('button', { textContent: 'Open', type: 'button' });
      open.onclick = async () => { modal.style.display = 'none'; await openById(r.id); };
      const del = h('button', { textContent: 'Delete', type: 'button' });
      del.onclick = async () => {
        if (!confirm('Delete "' + r.name + '" forever?')) return;
        const { data: gone, error: e } = await db.from('levels').delete().eq('id', r.id).select();
        if (e || !gone.length) return alert(e ? e.message : 'Could not delete.');
        if (r.id === levelId) levelId = null;
        showOpen();
      };
      t.appendChild(h('tr', null,
        h('td', { textContent: r.name }), h('td', { textContent: r.published ? 'Published' : 'Private' }),
        h('td', { textContent: new Date(r.updated_at).toLocaleDateString() }),
        h('td', null, open, document.createTextNode(' '), del)));
    });
    list.innerHTML = '';
    list.appendChild(t);
  }
  function newMap() {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    $('menu-modal').style.display = 'none';
    level = MODEL_MODE ? emptyModel() : W.defaultLevel();
    levelId = null;
    modelId = null; modelStatus = null; modelOwner = null;
    if ($('model-desc')) $('model-desc').value = '';
    refreshModelButtons();
    $('map-name').value = level.map_name;
    $('published').checked = false;
    $('map-sky').value = level.sky;
    setSky(false);
    selectedId = null;
    clearHistory();
    rebuildScene();
    renderAll();
    dirty = false;
    status(MODEL_MODE ? 'New model.' : 'New map.');
  }

  // ---------- Build a Model: salvar / abrir modelos ----------
  // O modelo é guardado com a base no chão (y = 0) e centrado em x/z, para entrar sempre no lugar certo em qualquer jogo.
  function normalizedModelObjects() {
    const objs = JSON.parse(JSON.stringify(level.objects));
    const parts = objs.filter(o => o.type === 'Part');
    if (parts.length) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
      parts.forEach(p => {
        minX = Math.min(minX, p.position.x - p.size.x / 2); maxX = Math.max(maxX, p.position.x + p.size.x / 2);
        minZ = Math.min(minZ, p.position.z - p.size.z / 2); maxZ = Math.max(maxZ, p.position.z + p.size.z / 2);
        minY = Math.min(minY, p.position.y - p.size.y / 2);
      });
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      parts.forEach(p => {
        p.position.x = r2(p.position.x - cx); p.position.z = r2(p.position.z - cz); p.position.y = r2(p.position.y - minY);
      });
    }
    return objs;
  }
  // para jogar um modelo sozinho: coloca um chão e um ponto de partida longe dele
  function withTestGround() {
    const copy = JSON.parse(JSON.stringify(level));
    const base = { surface: 'Smooth', controller: 'None', hopper: 0, type: 'Part' };
    copy.objects.push(
      Object.assign({ id: W.uid('part'), name: 'TestGround', position: { x: 0, y: -0.5, z: 0 }, size: { x: 60, y: 1, z: 60 }, color: 'Green' }, base),
      Object.assign({ id: W.uid('part'), name: 'SpawnBlock', position: { x: 0, y: 0.5, z: 16 }, size: { x: 6, y: 1, z: 6 }, color: 'Gray' }, base));
    return copy;
  }
  function refreshModelButtons() {
    const b = $('m-approve');
    if (b) b.style.display = (MODEL_MODE && isAdmin && modelId && modelStatus === 'pending') ? 'inline-block' : 'none';
  }

  async function saveModel() {
    const name = W.cleanName($('map-name').value, '');
    if (name.length < 3) { status('Model name: at least 3 characters (open MENU to change it).', true); return false; }
    if (!level.objects.some(o => o.type === 'Part')) { status('Add at least one block to your model first.', true); return false; }
    if (level.objects.length > 100) { status('A model can have at most 100 objects.', true); return false; }
    $('map-name').value = name;
    const description = ($('model-desc').value || '').trim().slice(0, 200);
    const data = { objects: normalizedModelObjects() };
    status('Saving model...');

    // o dono só pode editar enquanto está pendente; depois de aprovado, salvar cria uma cópia nova para o admin revisar
    const canUpdate = modelId && (isAdmin || (modelOwner === me && modelStatus === 'pending'));
    let res;
    if (canUpdate) {
      res = await db.from('toolbox_models').update({ name, description, data }).eq('id', modelId).select('id, status, owner_id').maybeSingle();
    } else {
      const row = { name, description, data };
      if (isAdmin) row.status = 'approved';                   // modelo de admin entra direto na Toolbox
      res = await db.from('toolbox_models').insert(row).select('id, status, owner_id').single();
    }
    if (res.error) { status(res.error.message, true); return false; }
    if (!res.data) { status('Could not save this model.', true); return false; }
    const copied = modelId && !canUpdate;
    modelId = res.data.id; modelStatus = res.data.status; modelOwner = res.data.owner_id;
    dirty = false;
    refreshModelButtons();
    if (modelStatus === 'approved') status('Saved "' + name + '". It is in the Toolbox now!');
    else status((copied ? 'Your changes were sent as a NEW model. ' : 'Saved! ') + '"' + name + '" is waiting for an admin to approve it for the Toolbox.');
    return true;
  }
  async function openModelById(id) {
    const { data, error } = await db.from('toolbox_models').select('id, name, description, data, status, owner_id').eq('id', id).maybeSingle();
    if (error || !data) { status(error ? error.message : 'Model not found (or it is not yours).', true); return; }
    const clean = W.cleanLevel({ objects: (data.data && data.data.objects) || [] });
    level = { map_name: data.name, sky: level.sky, objects: clean.objects };
    modelId = data.id; modelStatus = data.status; modelOwner = data.owner_id;
    $('map-name').value = data.name;
    $('model-desc').value = data.description || '';
    selectedId = null;
    clearHistory();
    rebuildScene();
    renderAll();
    dirty = false;
    refreshModelButtons();
    status('Opened model "' + data.name + '" (' + (data.status === 'approved' ? 'in the Toolbox' : 'waiting for approval') + ').');
  }
  async function showOpenModels() {
    $('menu-modal').style.display = 'none';
    const modal = $('open-modal'), list = $('open-list');
    modal.style.display = 'flex';
    list.textContent = 'Loading...';
    const { data, error } = await db.from('toolbox_models').select('id, name, status, updated_at')
      .eq('owner_id', me).order('updated_at', { ascending: false });
    if (error) { list.textContent = error.message; return; }
    if (!data.length) { list.textContent = 'You have no saved models yet.'; return; }
    const t = h('table');
    t.innerHTML = '<tr><th>Model</th><th>Status</th><th>Updated</th><th></th></tr>';
    data.forEach(r => {
      const open = h('button', { textContent: 'Open', type: 'button' });
      open.onclick = async () => { modal.style.display = 'none'; await openModelById(r.id); };
      const del = h('button', { textContent: 'Delete', type: 'button' });
      del.onclick = async () => {
        if (!confirm('Delete "' + r.name + '" forever?')) return;
        const { data: gone, error: e } = await db.from('toolbox_models').delete().eq('id', r.id).select();
        if (e || !gone.length) return alert(e ? e.message : 'Could not delete.');
        if (r.id === modelId) { modelId = null; modelStatus = null; modelOwner = null; refreshModelButtons(); }
        showOpenModels();
      };
      t.appendChild(h('tr', null,
        h('td', { textContent: r.name }), h('td', { textContent: r.status === 'approved' ? 'In the Toolbox' : 'Waiting for approval' }),
        h('td', { textContent: new Date(r.updated_at).toLocaleDateString() }),
        h('td', null, open, document.createTextNode(' '), del)));
    });
    list.innerHTML = '';
    list.appendChild(t);
  }
  function setupModelUI() {                                  // o editor vira o "Build a Model"
    document.title = 'Build a Model - DynaBlocks';
    const nameRow = $('map-name').parentNode;
    nameRow.firstChild.textContent = 'Model name: ';
    $('published').parentNode.style.display = 'none';
    $('map-sky').parentNode.style.display = 'none';
    $('map-name').value = level.map_name;
    const desc = h('input', { type: 'text', id: 'model-desc', maxLength: 200 });
    desc.style.width = '320px';
    nameRow.parentNode.insertBefore(h('div', { className: 'mrow' }, document.createTextNode('Description: '), desc), nameRow.nextSibling);
    $('m-save').textContent = 'Save model';
    $('m-approve').onclick = async () => {
      const { data, error } = await db.from('toolbox_models').update({ status: 'approved' }).eq('id', modelId).select();
      if (error || !data.length) return status(error ? error.message : 'Not allowed.', true);
      modelStatus = 'approved';
      refreshModelButtons();
      $('menu-modal').style.display = 'none';
      status('Approved! "' + level.map_name + '" is in the Toolbox now.');
    };
  }

  // ---------- Toolbox: modelos prontos para colocar no jogo ----------
  let tbTab = 'approved';
  function showToolbox(tab) {
    $('menu-modal').style.display = 'none';
    if (tab) tbTab = tab;
    $('toolbox-modal').style.display = 'flex';
    renderToolbox();
  }
  async function renderToolbox() {
    const tabs = $('tb-tabs'), list = $('tb-list');
    tabs.innerHTML = '';
    const defs = [['approved', 'Toolbox'], ['mine', 'My models']];
    if (isAdmin) defs.push(['pending', 'Pending (admin)']);
    defs.forEach(([k, label]) => {
      const b = h('button', { type: 'button', textContent: label });
      if (k === tbTab) b.style.fontWeight = 'bold';
      b.onclick = () => { tbTab = k; renderToolbox(); };
      tabs.append(b, document.createTextNode(' '));
    });
    list.textContent = 'Loading...';
    let q = db.from('toolbox_models').select('id, name, description, owner_id, status, part_count, script_count, created_at')
      .order('created_at', { ascending: false }).limit(100);
    if (tbTab === 'approved') q = q.eq('status', 'approved');
    else if (tbTab === 'mine') q = q.eq('owner_id', me);
    else q = q.eq('status', 'pending');
    const { data, error } = await q;
    if (error) { list.textContent = error.message; return; }
    if (!data.length) {
      list.textContent = tbTab === 'approved' ? 'The Toolbox is empty. Build a model from the home page and send it!'
        : tbTab === 'mine' ? 'You have not saved any models yet.' : 'Nothing waiting for approval.';
      return;
    }
    const ids = [...new Set(data.map(r => r.owner_id))], names = {};
    const { data: profs } = await db.from('profiles').select('id, username').in('id', ids);
    (profs || []).forEach(p => { names[p.id] = p.username; });

    const t = h('table');
    t.innerHTML = '<tr><th>Model</th><th>By</th><th>Parts</th><th>Scripts</th><th></th></tr>';
    data.forEach(r => {
      const first = h('td', null, h('b', { textContent: r.name }));
      if (r.status !== 'approved') first.append(h('small', { textContent: '  (waiting for approval)' }));
      if (r.description) { first.append(h('br'), h('small', { textContent: r.description })); }
      const act = h('td');
      const ins = h('button', { type: 'button', textContent: 'Insert' });
      ins.onclick = () => insertModel(r);
      const open = h('a', { href: 'editor.html?mode=model&model=' + r.id, target: '_blank', rel: 'noopener', textContent: 'open' });
      act.append(ins, document.createTextNode(' '), open, document.createTextNode(' '));
      if (isAdmin && r.status === 'pending') {
        const ok = h('button', { type: 'button', textContent: 'Approve' });
        ok.onclick = async () => {
          const { data: d, error: er } = await db.from('toolbox_models').update({ status: 'approved' }).eq('id', r.id).select();
          if (er || !d.length) return alert(er ? er.message : 'Not allowed.');
          renderToolbox();
        };
        act.append(ok, document.createTextNode(' '));
      }
      if (isAdmin || r.owner_id === me) {
        const del = h('button', { type: 'button', textContent: 'Delete' });
        del.onclick = async () => {
          if (!confirm('Delete "' + r.name + '"?')) return;
          const { data: gone, error: er } = await db.from('toolbox_models').delete().eq('id', r.id).select();
          if (er || !gone.length) return alert(er ? er.message : 'Could not delete.');
          renderToolbox();
        };
        act.append(del);
      }
      t.appendChild(h('tr', null, first, h('td', { textContent: names[r.owner_id] || '?' }),
        h('td', { textContent: r.part_count }), h('td', { textContent: r.script_count }), act));
    });
    list.innerHTML = '';
    list.appendChild(t);
  }
  async function insertModel(r) {
    const { data, error } = await db.from('toolbox_models').select('data').eq('id', r.id).maybeSingle();
    if (error || !data) return alert(error ? error.message : 'Model not found.');
    const objs = W.cleanLevel({ objects: (data.data && data.data.objects) || [] }).objects;   // limpa tudo antes de usar
    if (!objs.length) return alert('This model is empty.');
    if (level.objects.length + objs.length > W.LIMITS.objects) return alert('No room: a map can have ' + W.LIMITS.objects + ' objects.');
    pushUndo();
    const ox = snap(orbit.target.x), oz = snap(orbit.target.z);   // o modelo aparece onde a câmera está olhando, no chão
    let firstPart = null;
    objs.forEach(o => {
      const c = JSON.parse(JSON.stringify(o));
      c.id = W.uid(o.type.toLowerCase());
      if (c.type === 'Part') {
        c.position.x = W.num(c.position.x + ox, 0, -2000, 2000);
        c.position.z = W.num(c.position.z + oz, 0, -2000, 2000);
        addMesh(c);
        if (!firstPart) firstPart = c;
      }
      level.objects.push(c);
    });
    markDirty();
    $('toolbox-modal').style.display = 'none';
    select(firstPart ? firstPart.id : null);
    status('Inserted "' + r.name + '" (' + objs.length + ' objects). Drag it where you want. Scripts keep their part names.');
  }

  // ---------- jogar / parar ----------
  async function play() {
    if (playing) return;
    if (!level.objects.some(o => o.type === 'Part')) { status('Add at least one block first.', true); return; }
    playing = true;
    document.body.classList.add('playing');
    $('t-stop').disabled = false;
    renderer.domElement.style.display = 'none';
    resize();
    const outfit = window.Avatar ? await window.Avatar.loadOutfit(db).catch(() => null) : null;
    if (!playing) return;                       // o usuário apertou STOP enquanto carregava
    try {
      game = window.Game.start({ level: W.cleanLevel(MODEL_MODE ? withTestGround() : JSON.parse(JSON.stringify(level))), container, outfit });
    } catch (e) {
      stop();
      status('Could not start the game: ' + (e && e.message ? e.message : e), true);
    }
  }
  function stop() {
    if (game) { game.stop(); game = null; }
    playing = false;
    document.body.classList.remove('playing');
    $('t-stop').disabled = true;
    renderer.domElement.style.display = 'block';
    resize();
    status(HINTS[tool]);
  }

  // ---------- ligações da interface ----------
  $('t-select').onclick = () => setTool('select');
  $('t-resize').onclick = () => setTool('resize');
  $('t-rotate').onclick = () => setTool('rotate');
  $('t-undo').onclick = undo;
  $('t-redo').onclick = redo;
  $('t-dup').onclick = duplicate;
  $('t-del').onclick = remove;
  $('t-menu').onclick = showMenu;
  $('t-stop').onclick = stop;
  $('b-play').onclick = play;

  document.querySelectorAll('#proptabs .tab').forEach(t => {
    t.onclick = () => { activeTab = activeTab === t.dataset.tab ? null : t.dataset.tab; renderProps(); };
  });

  $('m-toolbox').onclick = () => showToolbox('approved');
  $('tb-close').onclick = () => { $('toolbox-modal').style.display = 'none'; };
  $('m-new').onclick = newMap;
  $('m-open').onclick = showOpen;
  $('m-save').onclick = async () => { await save(); };
  $('m-newscript').onclick = () => { $('menu-modal').style.display = 'none'; createScript(); };
  $('m-explorer').onclick = () => {
    const w = $('explorer-win');
    w.style.display = w.style.display === 'flex' ? 'none' : 'flex';
    $('menu-modal').style.display = 'none';
  };
  $('explorer-x').onclick = e => { e.preventDefault(); $('explorer-win').style.display = 'none'; };
  $('menu-close').onclick = () => { $('menu-modal').style.display = 'none'; };
  $('models-close').onclick = () => { $('models-modal').style.display = 'none'; };
  $('open-close').onclick = () => { $('open-modal').style.display = 'none'; };
  Object.keys(W.SKIES).forEach(k => $('map-sky').appendChild(h('option', { value: k, textContent: k })));
  $('map-sky').value = level.sky;
  $('map-sky').onchange = () => {
    level.sky = $('map-sky').value;
    setSky(true);
    markDirty();
  };
  $('map-name').addEventListener('input', markDirty);
  $('published').addEventListener('change', markDirty);

  // CameraMenu: muda a câmera do editor ou a do jogo, conforme o que estiver ativo
  document.body.appendChild(W.makeCameraMenu({
    rotate: (dx, dy) => (playing && game ? game.rotateCamera(dx, dy) : orbit.rotate(dx, dy)),
    zoom: f => (playing && game ? game.zoomCamera(f) : orbit.zoom(f)),
    reset: () => (playing && game ? game.resetCamera() : orbit.reset())
  }));

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (playing) { if (e.key === 'Escape') stop(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
    if (e.key === 'r' || e.key === 'R') { rotatePart(selected()); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
  });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- início ----------
  async function init() {
    resize();
    const { data } = await db.auth.getSession();
    if (!data.session) { location.href = 'signin.html'; return; }
    me = data.session.user.id;
    const { data: pr } = await db.from('profiles').select('is_admin').eq('id', me).maybeSingle();
    isAdmin = !!(pr && pr.is_admin);
    if (MODEL_MODE) setupModelUI();
    initCategories();
    rebuildScene();
    renderAll();
    updateUndoButtons();
    setTool('select');
    setSky(false);
    const qs = new URLSearchParams(location.search);
    if (MODEL_MODE) {
      status('Build a Model: build something, then open MENU > Save model to send it to the Toolbox.');
      const mid = parseInt(qs.get('model'), 10);
      if (mid) await openModelById(mid);
      if (qs.get('toolbox')) showToolbox('approved');
    } else {
      const id = parseInt(qs.get('level'), 10);
      if (id) await openById(id);
    }
  }
  init();
})();