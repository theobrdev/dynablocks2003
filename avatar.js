// Personagem do DynaBlocks com roupas 2D (Classic T-Shirt, Classic Shirt, Classic Pants).
// Usado pelo jogo (game.js) e pela página do catálogo. Precisa do Three.js (THREE).
//
// As roupas são imagens 2D no "template clássico" de 585 x 559 pixels: cada parte do corpo
// lê a sua região da imagem (torso, braços, pernas). O Classic T-Shirt é uma figura 2D
// colocada na frente do torso.
(function (global) {
  'use strict';

  const TW = 585, TH = 559;
  const SKIN = 0xf2c81a;
  const hex = n => '#' + n.toString(16).padStart(6, '0');

  // regiões do template: [x, y, largura, altura]
  const TORSO = {
    top: [231, 8, 128, 64], bottom: [231, 204, 128, 64],
    right: [165, 74, 64, 128], front: [231, 74, 128, 128], left: [361, 74, 64, 128], back: [427, 74, 128, 128]
  };
  const limbRegions = (x0, topX) => ({
    right: [x0, 355, 64, 128], front: [x0 + 66, 355, 64, 128], left: [x0 + 132, 355, 64, 128], back: [x0 + 198, 355, 64, 128],
    top: [topX, 289, 64, 64], bottom: [topX, 485, 64, 64]
  });
  const RIGHT_LIMB = limbRegions(308, 308);    // braço / perna direita do personagem
  const LEFT_LIMB = limbRegions(19, 217);      // braço / perna esquerda
  const TSHIRT_AREA = [231 + 10, 74 + 10, 108, 108];   // onde a figura do T-Shirt é desenhada (frente do torso)

  // ordem das faces do BoxGeometry do Three.js: +x, -x, +y, -y, +z, -z
  // o personagem olha para +z: a sua esquerda é +x e a direita é -x
  const FACES = ['left', 'right', 'top', 'bottom', 'front', 'back'];

  function setUVs(geo, regs) {
    const uv = geo.attributes.uv;
    FACES.forEach((name, f) => {
      const r = regs[name];
      const u0 = r[0] / TW, u1 = (r[0] + r[2]) / TW;
      const v1 = 1 - r[1] / TH, v0 = 1 - (r[1] + r[3]) / TH;
      const i = f * 4;
      uv.setXY(i, u0, v1); uv.setXY(i + 1, u1, v1); uv.setXY(i + 2, u0, v0); uv.setXY(i + 3, u1, v0);
    });
    uv.needsUpdate = true;
  }

  function loadImg(url) {
    return new Promise(resolve => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }


  // ================== Chapéus (modelos 3D em .obj + textura 2D) ==================
  // O leitor de .obj é nosso (só lê números): um arquivo enviado por um jogador nunca roda código.
  const OBJ_LIMITS = { vertices: 40000, triangles: 40000 };
  const HAT_FIT_WIDTH = 0.74;     // chapéu "por cima": largura final, contando a aba (a cabeça tem 0,56)
  const HAT_COVER_WIDTH = 0.70;   // chapéu "cobre a cabeça" (ex.: cabeça de abóbora): largura final

  // texto .obj -> { pos, uv, nor } (triângulos soltos). Aceita faces com 3 ou mais pontos e índices negativos.
  function parseOBJ(text) {
    const P = [], T = [], N = [];             // listas do arquivo
    const pos = [], uv = [], nor = [];        // saída (um valor por canto de triângulo)
    let tris = 0, hasNormals = true;
    const lines = String(text).split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].trim();
      if (!line || line[0] === '#') continue;
      const p = line.split(/\s+/);
      const tag = p[0];
      if (tag === 'v') {
        P.push([+p[1], +p[2], +p[3]]);
        if (P.length > OBJ_LIMITS.vertices) throw new Error('The 3D model has too many points.');
      } else if (tag === 'vt') {
        T.push([+p[1], +p[2]]);
      } else if (tag === 'vn') {
        N.push([+p[1], +p[2], +p[3]]);
      } else if (tag === 'f' && p.length >= 4) {
        const corners = [];
        for (let i = 1; i < p.length; i++) {
          const s = p[i].split('/');
          const ix = (str, len) => { if (!str) return -1; const n = parseInt(str, 10); return n < 0 ? len + n : n - 1; };
          const vi = ix(s[0], P.length), ti = ix(s[1], T.length), ni = ix(s[2], N.length);
          if (!(vi >= 0 && vi < P.length)) { corners.length = 0; break; }
          corners.push([vi, ti >= 0 && ti < T.length ? ti : -1, ni >= 0 && ni < N.length ? ni : -1]);
        }
        for (let i = 1; i + 1 < corners.length; i++) {          // leque de triângulos
          for (const c of [corners[0], corners[i], corners[i + 1]]) {
            const v = P[c[0]];
            pos.push(v[0], v[1], v[2]);
            const t = c[1] >= 0 ? T[c[1]] : [0, 0];
            uv.push(t[0], t[1]);
            if (c[2] >= 0) { const n = N[c[2]]; nor.push(n[0], n[1], n[2]); } else hasNormals = false;
          }
          if (++tris > OBJ_LIMITS.triangles) throw new Error('The 3D model has too many triangles.');
        }
      }
    }
    if (!tris) throw new Error('No 3D shape found in this .obj file.');
    for (const x of pos) if (!isFinite(x)) throw new Error('The .obj file has invalid numbers.');
    return { pos: new Float32Array(pos), uv: new Float32Array(uv), nor: hasNormals ? new Float32Array(nor) : null, triangles: tris };
  }

  function toGeometry(m) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    if (m.nor) g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    else g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }

  const geoCache = new Map(), texCache = new Map();
  function loadGeo(url) {
    if (!geoCache.has(url)) {
      geoCache.set(url, fetch(url)
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(t => toGeometry(parseOBJ(t)))
        .catch(e => { geoCache.delete(url); throw e; }));
    }
    return geoCache.get(url);
  }
  function loadTex(url) {
    if (!url) return Promise.resolve(null);
    if (!texCache.has(url)) {
      texCache.set(url, loadImg(url).then(img => {
        if (!img) { texCache.delete(url); return null; }
        const t = new THREE.Texture(img);
        t.magFilter = THREE.NearestFilter;       // texturas pequenas ficam nítidas, sem borrar
        t.minFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.needsUpdate = true;
        return t;
      }));
    }
    return texCache.get(url);
  }

  // monta o chapéu: base apoiada em y = 0, centrado, na escala do nosso personagem, virado para a frente dele
  // mode "top"  = o chapéu fica POR CIMA da cabeça (a base apoiada no meio da cabeça): boné, capacete, cartola...
  // mode "cover" = o chapéu COBRE a cabeça (centrado nela): cabeça de abóbora, máscaras...
  // Nos dois casos ele é redimensionado para o tamanho da cabeça.
  // mode "auto" (ou sem modo) = o site decide pelo formato: modelo "redondo/alto" (altura quase igual à largura,
  // como uma abóbora) cobre a cabeça; modelo "achatado" (capacete, boné, com aba) fica por cima.
  function hatObject(geo, tex, mode) {
    const b = geo.boundingBox;
    const dx = b.max.x - b.min.x, dz = b.max.z - b.min.z, dy = b.max.y - b.min.y;
    const widest = Math.max(dx, dz);
    const cover = mode === 'cover' || (mode !== 'top' && widest > 1e-6 && dy / widest >= 0.8);
    const k = widest > 1e-6 ? (cover ? HAT_COVER_WIDTH : HAT_FIT_WIDTH) / widest : 1;
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      map: tex || null, color: tex ? 0xffffff : 0x9a9a9a, side: THREE.DoubleSide }));
    // centraliza em x/z; na vertical, "cover" centraliza o modelo e "top" apoia a base em y = 0
    mesh.position.set(-(b.min.x + b.max.x) / 2, cover ? -(b.min.y + b.max.y) / 2 : -b.min.y, -(b.min.z + b.max.z) / 2);
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.scale.setScalar(k);
    holder.rotation.y = Math.PI;                 // a frente do Roblox é -Z; a do nosso personagem é +Z
    holder.position.y = cover ? 0 : 0.03;        // relativo ao centro da cabeça
    holder.userData.cover = cover;
    return holder;
  }

  // imagem (data URL) do chapéu para as miniaturas do catálogo
  let thumbRenderer = null;
  async function thumbHat(model, texture, mode) {
    const [geo, tex] = await Promise.all([loadGeo(model), loadTex(texture)]);
    if (!thumbRenderer) {
      thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      thumbRenderer.setSize(128, 128);
      thumbRenderer.setClearColor(0x000000, 0);
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x778899, 1));
    const sun = new THREE.DirectionalLight(0xffffff, 0.5);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const hat = hatObject(geo, tex, mode);
    scene.add(hat);
    const ty = hat.userData.cover ? 0 : 0.2;     // altura que a câmera olha
    const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 20);
    cam.position.set(1.0, ty + 0.55, 1.6);
    cam.lookAt(0, ty, 0);
    thumbRenderer.render(scene, cam);
    return thumbRenderer.domElement.toDataURL('image/png');
  }

  // monta o personagem. shirtColor = cor do torso quando NÃO há camisa (a cor do avatar do perfil)
  function make(shirtColor) {
    const pantsColor = new THREE.Color(shirtColor).multiplyScalar(0.8).getHex();
    const base = { torso: shirtColor, arms: SKIN, legs: pantsColor };
    const cv = {}, tex = {};
    Object.keys(base).forEach(k => {
      const c = document.createElement('canvas');
      c.width = TW; c.height = TH;
      cv[k] = c;
      tex[k] = new THREE.CanvasTexture(c);
      tex[k].minFilter = THREE.LinearFilter;
      tex[k].generateMipmaps = false;
    });

    function paint(key, layers) {            // fundo de cor + camadas de imagem por cima
      const g = cv[key].getContext('2d');
      g.clearRect(0, 0, TW, TH);
      g.fillStyle = hex(base[key]);
      g.fillRect(0, 0, TW, TH);
      layers.forEach(fn => fn(g));
      tex[key].needsUpdate = true;
    }
    paint('torso', []); paint('arms', []); paint('legs', []);

    function box(w, h, d, key, regs) {
      const geo = new THREE.BoxGeometry(w, h, d);
      setUVs(geo, regs);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex[key] }));
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000 })));
      return m;
    }
    function limb(w, h, d, key, x, y) {       // peça que balança a partir de uma "junta" (ombro/quadril)
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      const m = box(w, h, d, key, x < 0 ? RIGHT_LIMB : LEFT_LIMB);
      m.position.y = -h / 2;
      g.add(m);
      return g;
    }

    const group = new THREE.Group();
    const torso = box(0.7, 0.75, 0.4, 'torso', TORSO);
    torso.position.set(0, 0.075, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), new THREE.MeshPhongMaterial({ color: SKIN, shininess: 70 }));
    head.position.set(0, 0.725, 0);
    const armL = limb(0.28, 0.75, 0.4, 'arms', -0.49, 0.45);
    const armR = limb(0.28, 0.75, 0.4, 'arms', 0.49, 0.45);
    const legL = limb(0.35, 0.7, 0.4, 'legs', -0.175, -0.3);
    const legR = limb(0.35, 0.7, 0.4, 'legs', 0.175, -0.3);
    group.add(torso, head, armL, armR, legL, legR);
    const hatMount = new THREE.Group();          // o chapéu fica preso à cabeça
    hatMount.position.set(0, 0.725, 0);     // no centro da cabeça
    group.add(hatMount);

    // veste as roupas: { tshirt, shirt, pants } com o endereço (URL) de cada imagem, ou null
    let token = 0;
    async function setOutfit(o) {
      o = o || {};
      const me = ++token;
      const hatInfo = o.hat && o.hat.model ? o.hat : null;
      let hatObj = null, hatFailed = false;
      const [pants, shirt, tshirt] = await Promise.all([
        loadImg(o.pants), loadImg(o.shirt), loadImg(o.tshirt),
        hatInfo ? Promise.all([loadGeo(hatInfo.model), loadTex(hatInfo.texture)])
          .then(([g, t]) => { hatObj = hatObject(g, t, hatInfo.mode); }).catch(() => { hatFailed = true; }) : null
      ]);
      if (me !== token) return [];            // chegou uma troca mais nova: ignora esta
      const failed = [];                       // endereços pedidos que não carregaram
      if (o.pants && !pants) failed.push(o.pants);
      if (o.shirt && !shirt) failed.push(o.shirt);
      if (o.tshirt && !tshirt) failed.push(o.tshirt);
      if (hatFailed) failed.push(hatInfo.model);
      paint('torso', [
        g => { if (pants) g.drawImage(pants, 0, 0, TW, TH); },
        g => { if (shirt) g.drawImage(shirt, 0, 0, TW, TH); },
        g => {
          if (!tshirt) return;                // figura 2D centralizada na frente do torso, sem distorcer
          const [ax, ay, aw, ah] = TSHIRT_AREA;
          const s = Math.min(aw / tshirt.width, ah / tshirt.height);
          const w = tshirt.width * s, h = tshirt.height * s;
          g.drawImage(tshirt, ax + (aw - w) / 2, ay + (ah - h) / 2, w, h);
        }
      ]);
      paint('arms', [g => { if (shirt) g.drawImage(shirt, 0, 0, TW, TH); }]);
      paint('legs', [g => { if (pants) g.drawImage(pants, 0, 0, TW, TH); }]);
      while (hatMount.children.length) hatMount.remove(hatMount.children[0]);
      if (hatObj) hatMount.add(hatObj);
      return failed;
    }

    return { group, armL, armR, legL, legR, setOutfit };
  }

  // ---- ajudantes para buscar a roupa no Supabase ----
  // arquivos do site ficam em "img/..." e "models/..."; os enviados pelos jogadores ficam no Storage
  // (roupas 2D na pasta "assets", chapéus na pasta "hats")
  function urlFor(db, path, kind) {
    if (/^(img|models)\//.test(path)) return path;
    return db.storage.from(kind === 'hat' ? 'hats' : 'assets').getPublicUrl(path).data.publicUrl;
  }
  function outfitFromRows(db, rows) {
    const o = { tshirt: null, shirt: null, pants: null, hat: null };
    (rows || []).forEach(r => {
      if (!r) return;
      if (r.kind === 'hat') {
        if (r.model_path) o.hat = { model: urlFor(db, r.model_path, 'hat'), texture: urlFor(db, r.image_path, 'hat'), mode: r.hat_mode === 'cover' || r.hat_mode === 'top' ? r.hat_mode : 'auto' };
      } else if (r.kind in o) {
        o[r.kind] = urlFor(db, r.image_path, r.kind);
      }
    });
    return o;
  }
  // roupa de uma pessoa (sem userId = a pessoa logada)
  async function loadOutfit(db, userId) {
    const { data } = await db.rpc('get_outfit', userId ? { p_user: userId } : {});
    return outfitFromRows(db, data);
  }

  global.Avatar = { make, urlFor, outfitFromRows, loadOutfit, parseOBJ, thumbHat, TW, TH };
})(window);
