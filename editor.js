// Level Editor do DynaBlocks. Usa: THREE, db (Supabase) e World (world.js).
(function () {
  'use strict';
  const W = window.World;
  const $ = id => document.getElementById(id);

  // ---------- estado ("a memória do editor") ----------
  let level = W.defaultLevel();      // { map_name, objects: [...] }
  let levelId = null;                // id no Supabase (null = ainda não salvo)
  let me = null;
  let selectedId = null;
  let mode = 'select';               // select | move | resize
  let dirty = false;
  const meshes = {};                 // id -> THREE.Mesh

  const objById = id => level.objects.find(o => o.id === id);
  const SNAP = 0.5;
  const snap = v => Math.round(v / SNAP) * SNAP;
  const r2 = v => Math.round(v * 100) / 100;

  function status(text, isErr) {
    const s = $('status');
    s.textContent = text;
    s.className = isErr ? 'err' : '';
  }
  const HINTS = {
    select: 'Select: click a part. Right-drag = rotate camera, wheel = zoom, middle-drag (or Alt+drag) = pan.',
    move: 'Move: drag a part on the ground. Hold Shift and drag up/down to change its height.',
    resize: 'Resize: drag left/right = X size, up/down = Z size. Hold Shift and drag up/down = height.'
  };
  function markDirty() { dirty = true; }

  // ---------- Three.js ----------
  const container = $('viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9cc4ee);
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
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  (function loop() { requestAnimationFrame(loop); renderer.render(scene, camera); })();

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

  // ---------- Explorer ----------
  function renderExplorer() {
    const tree = $('tree');
    tree.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'row root';
    root.textContent = '\u25BC Workspace';
    tree.appendChild(root);
    level.objects.forEach(o => {
      const row = document.createElement('div');
      row.className = 'row' + (o.id === selectedId ? ' sel' : '');
      row.textContent = '\u00A0\u00A0\u2514\u2500 ' + (o.type === 'Script' ? '\u{1F4DC} ' : '\u{1F9F1} ') + o.name;
      row.onclick = () => select(o.id);
      if (o.type === 'Script') row.ondblclick = () => openScript(o.id);
      tree.appendChild(row);
    });
  }

  // ---------- Properties ----------
  function line(label, ...els) {
    const d = document.createElement('div');
    d.className = 'line';
    const s = document.createElement('span');
    s.textContent = label;
    d.appendChild(s);
    els.forEach(e => d.appendChild(e));
    return d;
  }
  function numInput(value, onChange, min) {
    const i = document.createElement('input');
    i.type = 'number';
    i.step = '0.5';
    if (min !== undefined) i.min = min;
    i.value = r2(value);
    i.oninput = () => {
      const v = parseFloat(i.value);
      if (!isFinite(v)) return;
      onChange(v);
    };
    return i;
  }

  function renderProps() {
    const box = $('propbody');
    box.innerHTML = '';
    const o = selectedId && objById(selectedId);
    if (!o) {
      const p = document.createElement('div');
      p.className = 'none';
      p.textContent = 'Nothing selected.';
      box.appendChild(p);
      return;
    }
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 30;
    name.value = o.name;
    name.onchange = () => {
      o.name = W.cleanName(name.value, o.type);
      name.value = o.name;
      markDirty();
      renderExplorer();
    };
    box.appendChild(line('Name', name));

    if (o.type === 'Part') {
      ['x', 'y', 'z'].forEach(ax => {
        box.appendChild(line(ax === 'x' ? 'Position' : '', document.createTextNode(ax.toUpperCase()),
          numInput(o.position[ax], v => {
            o.position[ax] = W.num(v, 0, -2000, 2000); syncMesh(o); markDirty();
          })));
      });
      ['x', 'y', 'z'].forEach(ax => {
        box.appendChild(line(ax === 'x' ? 'Size' : '', document.createTextNode(ax.toUpperCase()),
          numInput(o.size[ax], v => {
            o.size[ax] = W.num(v, 1, 0.2, 500); syncMesh(o); markDirty();
          }, 0.2)));
      });
      const sel = document.createElement('select');
      Object.keys(W.COLORS).forEach(c => {
        const op = document.createElement('option');
        op.value = c; op.textContent = c;
        if (c === o.color) op.selected = true;
        sel.appendChild(op);
      });
      sel.onchange = () => { o.color = sel.value; syncMesh(o); markDirty(); };
      box.appendChild(line('Color', sel));
    } else {
      const b = document.createElement('button');
      b.textContent = 'Edit script...';
      b.onclick = () => openScript(o.id);
      box.appendChild(line('Source', b));
    }
  }

  function select(id) {
    selectedId = id;
    paintSelection();
    renderExplorer();
    renderProps();
  }

  // ---------- criar / apagar ----------
  function nextName(base) {
    let i = 1;
    while (level.objects.some(o => o.name === base + i)) i++;
    return base + i;
  }
  function canAdd() {
    if (level.objects.length >= W.LIMITS.objects) { status('Limit reached: ' + W.LIMITS.objects + ' objects per map.', true); return false; }
    return true;
  }
  function createPart() {
    if (!canAdd()) return;
    const o = {
      id: W.uid('part'), type: 'Part', name: nextName('Part'),
      position: { x: snap(orbit.target.x), y: 1.5, z: snap(orbit.target.z) },
      size: { x: 4, y: 1, z: 2 }, color: 'Gray'
    };
    level.objects.push(o);
    addMesh(o);
    markDirty();
    select(o.id);
  }
  function createScript() {
    if (!canAdd()) return;
    const o = {
      id: W.uid('script'), type: 'Script', name: nextName('Script'),
      source_code: '-- Example: touching "Part1" kills the player\n-- onTouch("Part1", function() kill() end)\nprint("Hello DynaBlocks!")\n'
    };
    level.objects.push(o);
    markDirty();
    select(o.id);
    openScript(o.id);
  }
  function duplicate() {
    const o = selectedId && objById(selectedId);
    if (!o || !canAdd()) return;
    const c = JSON.parse(JSON.stringify(o));
    c.id = W.uid(o.type.toLowerCase());
    c.name = nextName(o.type);
    if (c.type === 'Part') { c.position.x += 1; c.position.z += 1; addMesh(c); }
    level.objects.push(c);
    markDirty();
    select(c.id);
  }
  function remove() {
    if (!selectedId) return;
    const i = level.objects.findIndex(o => o.id === selectedId);
    if (i < 0) return;
    if (meshes[selectedId]) {
      scene.remove(meshes[selectedId]);
      delete meshes[selectedId];
    }
    level.objects.splice(i, 1);
    markDirty();
    select(null);
  }

  // ---------- modos e mouse ----------
  function setMode(m) {
    mode = m;
    ['select', 'move', 'resize'].forEach(k => $('m-' + k).classList.toggle('on', k === m));
    status(HINTS[m]);
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
    if (ev.button !== 0 || ev.altKey) return;
    const id = pick(ev);
    select(id);
    if (!id || mode === 'select') return;
    const o = objById(id);
    drag = {
      id, sx: ev.clientX, sy: ev.clientY,
      pos: { ...o.position }, size: { ...o.size }, off: null
    };
    if (mode === 'move') {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -o.position.y);
      drag.plane = plane;
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, hit)) {
        drag.off = { x: o.position.x - hit.x, z: o.position.z - hit.z };
      }
    }
  });
  window.addEventListener('mousemove', ev => {
    if (!drag) return;
    const o = objById(drag.id);
    if (!o) { drag = null; return; }
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (mode === 'move') {
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
    } else if (mode === 'resize') {
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
  window.addEventListener('mouseup', () => { drag = null; });

  // ---------- editor de script ----------
  let scriptId = null;
  function openScript(id) {
    const o = objById(id);
    if (!o || o.type !== 'Script') return;
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
    o.source_code = $('script-src').value.slice(0, W.LIMITS.source);
    markDirty();
    status('Script "' + o.name + '" updated. Remember to Save the map.');
    closeScript();
  };
  $('script-close').onclick = closeScript;

  // ---------- salvar / abrir (Supabase) ----------
  async function save() {
    const name = W.cleanName($('map-name').value, '');
    if (name.length < 3) { status('Map name: at least 3 characters.', true); return false; }
    level.map_name = name;
    $('map-name').value = name;
    const payload = {
      name, data: level, published: $('published').checked, updated_at: new Date().toISOString()
    };
    status('Saving...');
    let res;
    if (levelId) res = await db.from('levels').update(payload).eq('id', levelId).select('id').maybeSingle();
    else res = await db.from('levels').insert(payload).select('id').single();
    if (res.error) { status(res.error.message, true); return false; }
    if (!res.data) { status('Could not save this map.', true); return false; }
    levelId = res.data.id;
    dirty = false;
    status('Saved "' + name + '" at ' + new Date().toLocaleTimeString() + '.');
    return true;
  }

  function loadInto(row) {
    level = W.cleanLevel(row.data);
    levelId = row.id;
    $('map-name').value = row.name || level.map_name;
    $('published').checked = !!row.published;
    selectedId = null;
    rebuildScene();
    renderExplorer();
    renderProps();
    dirty = false;
    status('Opened "' + (row.name || level.map_name) + '".');
  }
  async function openById(id) {
    const { data, error } = await db.from('levels').select('id, name, data, published').eq('id', id).maybeSingle();
    if (error || !data) { status(error ? error.message : 'Map not found (or it is not yours).', true); return; }
    loadInto(data);
  }

  async function showOpen() {
    const modal = $('open-modal'), list = $('open-list');
    modal.style.display = 'flex';
    list.textContent = 'Loading...';
    const { data, error } = await db.from('levels').select('id, name, published, updated_at')
      .eq('owner_id', me).order('updated_at', { ascending: false });
    if (error) { list.textContent = error.message; return; }
    if (!data.length) { list.textContent = 'You have no saved maps yet.'; return; }
    const t = document.createElement('table');
    t.innerHTML = '<tr><th>Map</th><th>Status</th><th>Updated</th><th></th></tr>';
    data.forEach(r => {
      const tr = document.createElement('tr');
      const c1 = document.createElement('td'); c1.textContent = r.name;
      const c2 = document.createElement('td'); c2.textContent = r.published ? 'Published' : 'Private';
      const c3 = document.createElement('td'); c3.textContent = new Date(r.updated_at).toLocaleDateString();
      const c4 = document.createElement('td');
      const open = document.createElement('button'); open.textContent = 'Open';
      open.onclick = async () => { modal.style.display = 'none'; await openById(r.id); };
      const del = document.createElement('button'); del.textContent = 'Delete';
      del.onclick = async () => {
        if (!confirm('Delete "' + r.name + '" forever?')) return;
        const { data: gone, error: e } = await db.from('levels').delete().eq('id', r.id).select();
        if (e || !gone.length) return alert(e ? e.message : 'Could not delete.');
        if (r.id === levelId) levelId = null;
        showOpen();
      };
      c4.append(open, document.createTextNode(' '), del);
      tr.append(c1, c2, c3, c4);
      t.appendChild(tr);
    });
    list.innerHTML = '';
    list.appendChild(t);
  }

  function newMap() {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    level = W.defaultLevel();
    levelId = null;
    $('map-name').value = level.map_name;
    $('published').checked = false;
    selectedId = null;
    rebuildScene();
    renderExplorer();
    renderProps();
    dirty = false;
    status('New map.');
  }

  // ---------- ligações da interface ----------
  $('m-select').onclick = () => setMode('select');
  $('m-move').onclick = () => setMode('move');
  $('m-resize').onclick = () => setMode('resize');
  $('b-part').onclick = createPart;
  $('b-script').onclick = createScript;
  $('b-dup').onclick = duplicate;
  $('b-del').onclick = remove;
  $('b-new').onclick = newMap;
  $('b-open').onclick = showOpen;
  $('b-save').onclick = save;
  $('open-close').onclick = () => { $('open-modal').style.display = 'none'; };
  $('b-play').onclick = async () => {
    if (await save() && levelId) window.open('play.html?level=' + levelId, '_blank');
  };
  $('map-name').addEventListener('input', markDirty);
  $('published').addEventListener('change', markDirty);

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
  });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- início ----------
  async function init() {
    resize();
    const { data } = await db.auth.getSession();
    if (!data.session) { location.href = 'signin.html'; return; }
    me = data.session.user.id;
    rebuildScene();
    renderExplorer();
    renderProps();
    setMode('select');
    const id = parseInt(new URLSearchParams(location.search).get('level'), 10);
    if (id) await openById(id);
  }
  init();
})();
