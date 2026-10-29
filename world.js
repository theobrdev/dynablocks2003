// Código compartilhado entre o editor (editor.html) e o jogo (play.html).
// Precisa do Three.js carregado antes (variável global THREE).
(function (global) {
  'use strict';

  const COLORS = {
    Gray: 0x9a9a9a, Red: 0xcc2222, Blue: 0x2a5bd7, Green: 0x2e9e3e, Yellow: 0xe8d020,
    White: 0xf0f0f0, Black: 0x222222, Orange: 0xe07020, Purple: 0x8844bb, Brown: 0x7a4a22,
    Cyan: 0x20c8d8, Magenta: 0xcc2aa8
  };
  const SURFACES = ['Smooth', 'Ice', 'Sticky'];
  const CONTROLLERS = ['None', 'Kill', 'Goal', 'Checkpoint', 'Coin'];
  const LIMITS = { objects: 300, source: 20000 };

  const num = (v, d, lo, hi) => {
    v = Number(v);
    if (!isFinite(v)) v = d;
    return Math.min(hi, Math.max(lo, v));
  };
  const cleanName = (s, fallback) => {
    s = String(s == null ? '' : s).replace(/[^A-Za-z0-9_ -]/g, '').trim().slice(0, 30);
    return s || fallback;
  };
  let counter = 0;
  const uid = prefix => (prefix || 'obj') + '_' + Date.now().toString(36) + (counter++).toString(36) +
                        Math.random().toString(36).slice(2, 6);

  function defaultLevel() {
    return {
      map_name: 'Untitled Game',
      objects: [
        { id: 'part_base', type: 'Part', name: 'Baseplate', position: { x: 0, y: -0.5, z: 0 },
          size: { x: 60, y: 1, z: 60 }, color: 'Green', surface: 'Smooth', controller: 'None', hopper: 0 },
        { id: 'part_spawn', type: 'Part', name: 'SpawnBlock', position: { x: 0, y: 0.5, z: 0 },
          size: { x: 6, y: 1, z: 6 }, color: 'Gray', surface: 'Smooth', controller: 'None', hopper: 0 }
      ]
    };
  }

  // Limpa qualquer JSON vindo do banco ou do usuário antes de usar
  function cleanLevel(raw) {
    const out = { map_name: cleanName(raw && raw.map_name, 'Untitled Game'), objects: [] };
    const list = raw && Array.isArray(raw.objects) ? raw.objects : [];
    const seen = {};
    for (const o of list) {
      if (out.objects.length >= LIMITS.objects) break;
      if (!o || (o.type !== 'Part' && o.type !== 'Script')) continue;
      let id = String(o.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
      if (!id || seen[id]) id = uid(o.type.toLowerCase());
      seen[id] = true;
      if (o.type === 'Part') {
        const p = o.position || {}, s = o.size || {};
        out.objects.push({
          id, type: 'Part', name: cleanName(o.name, 'Part'),
          position: { x: num(p.x, 0, -2000, 2000), y: num(p.y, 0, -2000, 2000), z: num(p.z, 0, -2000, 2000) },
          size: { x: num(s.x, 2, 0.2, 500), y: num(s.y, 1, 0.2, 500), z: num(s.z, 2, 0.2, 500) },
          color: COLORS[o.color] !== undefined ? o.color : 'Gray',
          surface: SURFACES.includes(o.surface) ? o.surface : 'Smooth',
          controller: CONTROLLERS.includes(o.controller) ? o.controller : 'None',
          hopper: Math.round(num(o.hopper, 0, 0, 3))
        });
      } else {
        out.objects.push({
          id, type: 'Script', name: cleanName(o.name, 'Script'),
          source_code: String(o.source_code || '').slice(0, LIMITS.source)
        });
      }
    }
    return out;
  }

  const colorOf = name => (COLORS[name] !== undefined ? COLORS[name] : COLORS.Gray);

  function applyPart(mesh, obj) {
    mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
    mesh.scale.set(obj.size.x, obj.size.y, obj.size.z);
    mesh.material.color.setHex(colorOf(obj.color));
  }

  function makePartMesh(obj) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: colorOf(obj.color) });
    const mesh = new THREE.Mesh(geo, mat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000 }));
    mesh.add(edges);
    mesh.userData.edges = edges;
    mesh.userData.id = obj.id;
    applyPart(mesh, obj);
    return mesh;
  }

  // Câmera orbital: botão direito gira, botão do meio (ou Alt+esquerdo) move, roda do mouse dá zoom
  class OrbitCam {
    constructor(camera, dom) {
      this.camera = camera;
      this.dom = dom;
      this.target = new THREE.Vector3(0, 0, 0);
      this.theta = 0.7;
      this.phi = 1.0;
      this.radius = 32;
      this.mode = null;
      this.lx = 0; this.ly = 0;

      dom.addEventListener('contextmenu', e => e.preventDefault());
      dom.addEventListener('mousedown', e => {
        if (e.button === 2) this.mode = 'orbit';
        else if (e.button === 1 || (e.button === 0 && e.altKey)) this.mode = 'pan';
        else return;
        e.preventDefault();
        this.lx = e.clientX; this.ly = e.clientY;
      });
      window.addEventListener('mouseup', () => { this.mode = null; });
      window.addEventListener('mousemove', e => {
        if (!this.mode) return;
        const dx = e.clientX - this.lx, dy = e.clientY - this.ly;
        this.lx = e.clientX; this.ly = e.clientY;
        if (this.mode === 'orbit') {
          this.theta -= dx * 0.008;
          this.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.phi - dy * 0.008));
        } else {
          const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
          const k = this.radius * 0.0016;
          this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
        }
        this.update();
      });
      dom.addEventListener('wheel', e => {
        e.preventDefault();
        this.radius = Math.min(400, Math.max(3, this.radius * (e.deltaY > 0 ? 1.1 : 0.9)));
        this.update();
      }, { passive: false });
      this.update();
    }
    rotate(dx, dy) {
      this.theta -= dx * 0.008;
      this.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.phi - dy * 0.008));
      this.update();
    }
    zoom(f) {
      this.radius = Math.min(400, Math.max(3, this.radius * f));
      this.update();
    }
    reset() {
      this.target.set(0, 0, 0);
      this.theta = 0.7; this.phi = 1.0; this.radius = 32;
      this.update();
    }
    update() {
      const sp = Math.sin(this.phi);
      this.camera.position.set(
        this.target.x + this.radius * sp * Math.sin(this.theta),
        this.target.y + this.radius * Math.cos(this.phi),
        this.target.z + this.radius * sp * Math.cos(this.theta));
      this.camera.lookAt(this.target);
      this.camera.updateMatrix();
    }
  }

  // Painel "CameraMenu" (setas para girar, zoom e centralizar). h = { rotate(dx,dy), zoom(f), reset() }
  function makeCameraMenu(h) {
    const box = document.createElement('div');
    box.className = 'camera-menu';
    const title = document.createElement('div');
    title.className = 'cm-title';
    title.textContent = 'CameraMenu';
    const grid = document.createElement('div');
    grid.className = 'cm-grid';
    box.append(title, grid);
    const defs = [
      ['\u2295', 'Zoom in', () => h.zoom(0.9)],  ['\u25B2', 'Look from above', () => h.rotate(0, 6)],   ['\u2296', 'Zoom out', () => h.zoom(1.1)],
      ['\u25C0', 'Rotate left', () => h.rotate(6, 0)], ['\u25CE', 'Reset camera', () => h.reset()], ['\u25B6', 'Rotate right', () => h.rotate(-6, 0)],
      null, ['\u25BC', 'Look from below', () => h.rotate(0, -6)], null
    ];
    defs.forEach(d => {
      const b = document.createElement('button');
      if (!d) { b.className = 'cm-empty'; b.disabled = true; grid.appendChild(b); return; }
      b.textContent = d[0]; b.title = d[1];
      if (d[1] === 'Reset camera') b.onclick = d[2];
      else {
        let t = null;
        const stopIt = () => { clearInterval(t); t = null; };
        b.addEventListener('mousedown', e => { e.preventDefault(); d[2](); stopIt(); t = setInterval(d[2], 60); });
        b.addEventListener('mouseleave', stopIt);
        window.addEventListener('mouseup', stopIt);
      }
      grid.appendChild(b);
    });
    return box;
  }

  global.World = { COLORS, SURFACES, CONTROLLERS, LIMITS, makeCameraMenu, num, cleanName, uid, defaultLevel, cleanLevel, colorOf, applyPart, makePartMesh, OrbitCam };
})(window);
