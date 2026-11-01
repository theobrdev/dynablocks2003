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

    // veste as roupas: { tshirt, shirt, pants } com o endereço (URL) de cada imagem, ou null
    let token = 0;
    async function setOutfit(o) {
      o = o || {};
      const me = ++token;
      const [pants, shirt, tshirt] = await Promise.all([loadImg(o.pants), loadImg(o.shirt), loadImg(o.tshirt)]);
      if (me !== token) return;               // chegou uma troca mais nova: ignora esta
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
    }

    return { group, armL, armR, legL, legR, setOutfit };
  }

  // ---- ajudantes para buscar a roupa no Supabase ----
  // itens do site ficam em "img/..."; os enviados pelos jogadores ficam no Storage ("assets")
  function urlFor(db, path) {
    return /^img\//.test(path) ? path : db.storage.from('assets').getPublicUrl(path).data.publicUrl;
  }
  function outfitFromRows(db, rows) {
    const o = { tshirt: null, shirt: null, pants: null };
    (rows || []).forEach(r => { if (r && r.kind in o) o[r.kind] = urlFor(db, r.image_path); });
    return o;
  }
  // roupa de uma pessoa (sem userId = a pessoa logada)
  async function loadOutfit(db, userId) {
    const { data } = await db.rpc('get_outfit', userId ? { p_user: userId } : {});
    return outfitFromRows(db, data);
  }

  global.Avatar = { make, urlFor, outfitFromRows, loadOutfit, TW, TH };
})(window);
