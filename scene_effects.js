// Effets interactifs de la scène 3D (expérimental).
//
// Clic : la couche blanche se déchire comme du papier autour du point et
// dévoile du bois ; des bouts de papier déchiré s'envolent et se
// désagrègent dans l'air. Clic-glisser (souris) : la déchirure suit le tracé.
//
// Le bois est une texture qui se répète (tiling) projetée en coordonnées
// monde : les zones qui se chevauchent montrent la même texture continue.
// Le bord déchiré est calculé à partir d'un bruit en coordonnées monde,
// identique pour toutes les empreintes, et sans liseré : les empreintes qui
// se superposent forment naturellement un seul masque continu. Repasser sur
// une zone déjà dévoilée ne fait rien (addition uniquement).
//
// La taille des zones est exprimée en unités de la scène (taille "locale") :
// un tracé au loin a la même taille réelle qu'un tracé proche, il paraît
// simplement plus petit à l'écran.
//
// Expose window.initSceneEffects(scene, camera, root, renderer) qui renvoie
// { update(dt) } à appeler à chaque frame (dt en secondes).

// ---------- Réglages ----------
// Texture : "Teak Veneer" (Poly Haven, CC0), réduite en 2K depuis la version 4K
const WOOD_TEXTURE_URL = "img/wood_teak_veneer_2k.jpg"; // secours
// Version compressée pour le GPU (Basis ETC1S, mipmaps inclus) : ~4 Mo de
// mémoire graphique au lieu de ~22 Mo. Encodée avec basisu v1.12, la version
// qui correspond au transcodeur de three.js r115 (js/basis/).
const WOOD_TEXTURE_BASIS_URL = "img/wood_teak_veneer_2k.basis";
const WOOD_TILE_SIZE = 12.0; // taille d'une répétition de la texture, en unités de scène
const WOOD_SATURATION = 0.6; // 1 = couleurs d'origine, 0 = noir et blanc
const WOOD_CONTRAST = 0.7; // 1 = contraste d'origine de la texture, plus bas = veines plus douces

// Teinte du bois selon la section en cours (mêmes couleurs que les pastilles
// de navigation). Hors section (intro) : bois naturel.
// strength : opacité du filtre (0 = bois naturel, 1 = entièrement recoloré)
const SECTION_TINTS = {
  naissance: { color: 0x43eb99, strength: 0.3 },
  developpement: { color: 0x2873e4, strength: 0.42 },
  realisations: { color: 0xc981e2, strength: 0.3 },
  contact: { color: 0xffa800, strength: 0.13 },
};
const TINT_TRANSITION = 2.5; // s, durée du fondu entre deux couleurs

const RADIUS_MIN = 2.0; // rayon d'une tache au clic, en unités de scène (tiré au hasard)
const RADIUS_MAX = 4.4;
const DRAG_WIDTH = 0.55; // largeur du tracé, relative à la tache d'un clic
const DRAG_SPACING = 0.35; // espacement des empreintes le long du tracé (× rayon)

const MAX_STAMPS = 700; // au-delà, les plus anciennes se referment
const MAX_RAYS_PER_FRAME = 10; // lancers de rayon max par image pendant un tracé
const STROKE_STEP_PX = 6; // échantillonnage du tracé à l'écran
const STAMP_GROW_TIME = 0.55; // s, apparition d'une empreinte
const CLICK_GROW_TIME = 1.0; // s, apparition au simple clic

const MAX_PAPERS = 1200;
const PAPERS_PER_CLICK = 40;
const PAPERS_PER_DRAG_STAMP = 6;

// ---------- Shaders ----------
const NOISE_GLSL = `
  float hash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
                   mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                   mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * noise3(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v / 0.875;
  }
`;

// Toutes les empreintes d'un même objet sont fusionnées dans une seule
// géométrie : chaque sommet porte le centre/rayon (aStamp) et la progression
// (aProg) de son empreinte. Un seul appel de dessin par objet touché.
const WOOD_VERT = `
  attribute vec4 aStamp;
  attribute float aProg;
  varying vec3 vWorld;
  varying vec3 vWNormal;
  varying vec4 vStamp;
  varying float vProg;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vWNormal = normalize(mat3(modelMatrix) * normal);
    vStamp = aStamp;
    vProg = aProg;
    #include <begin_vertex>
    #include <project_vertex>
    #include <fog_vertex>
  }
`;

const WOOD_FRAG = `
  #define WOOD_SATURATION ${WOOD_SATURATION.toFixed(3)}
  #define WOOD_CONTRAST ${WOOD_CONTRAST.toFixed(3)}
  #define TEAR_AMP 0.46
  uniform sampler2D woodMap;
  uniform float tileSize;
  uniform vec3 tint;        // couleur de la section
  uniform float tintAmount; // 0 = bois naturel
  varying vec3 vWorld;
  varying vec3 vWNormal;
  varying vec4 vStamp;   // xyz = centre, w = rayon (unités de scène)
  varying float vProg;
  #include <common>
  #include <fog_pars_fragment>
  ${NOISE_GLSL}

  void main() {
    if (vProg <= 0.0) discard; // empreinte refermée
    // Distance au bord de l'empreinte (unités de scène, négatif à l'intérieur)
    float base = length(vWorld - vStamp.xyz) - vProg * vStamp.w * 0.85;
    float aa = max(fwidth(base), 1e-4) * 2.0;
    // Hors de portée de la déchirure : rien à dessiner, on sort tout de suite
    if (base > TEAR_AMP + aa) discard;
    float alpha = 1.0;
    // Le bruit de déchirure (coûteux) n'est calculé que sur la bande du bord
    if (base > -TEAR_AMP - aa) {
      // Grandes ondulations + dentelure fine, en coordonnées monde
      // (identiques pour toutes les empreintes => contour continu)
      float u = base
              + (fbm3(vWorld * 1.1) - 0.5) * 0.7
              + (noise3(vWorld * 7.0) - 0.5) * 0.14
              + (noise3(vWorld * 23.0) - 0.5) * 0.05;
      alpha = 1.0 - smoothstep(-aa, aa, u);
      if (alpha < 0.01) discard;
    }

    // Projection triplanaire de la texture qui se répète (on ne lit que les
    // projections qui comptent vraiment)
    vec3 w = pow(abs(normalize(vWNormal)), vec3(4.0));
    w /= (w.x + w.y + w.z);
    vec3 p = vWorld / tileSize;
    vec3 col = vec3(0.0);
    if (w.x > 0.01) col += texture2D(woodMap, p.yz).rgb * w.x;
    if (w.y > 0.01) col += texture2D(woodMap, p.xz).rgb * w.y;
    if (w.z > 0.01) col += texture2D(woodMap, p.xy).rgb * w.z;
    col *= 1.12;
    // Saturation réduite : bois plus doux, moins orangé
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, WOOD_SATURATION);
    // Contraste adouci : les veines se rapprochent du ton moyen du bois
    col = mix(vec3(0.62, 0.55, 0.48), col, WOOD_CONTRAST);
    // Filtre de couleur : on garde le dessin du bois (sa luminosité) et on
    // le recolore avec la teinte de la section
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 colored = tint * (0.4 + 0.85 * l);
    col = mix(col, colored, tintAmount);

    gl_FragColor = vec4(col, alpha);
    #ifdef USE_FOG
      float fogFactor = smoothstep(fogNear, fogFar, fogDepth);
      // Brouillard atténué (lisible au loin), mais fondu complet dans le blanc
      // juste avant la limite d'affichage de la caméra : pas de coupure nette
      float fadeOut = smoothstep(fogFar * 0.9, fogFar * 1.12, fogDepth);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, max(fogFactor * 0.45, fadeOut));
    #endif
  }
`;

// Bouts de papier : polygone déchiré, légèrement gondolé, qui se désagrège
const PAPER_VERT = `
  attribute float aSeed;
  attribute float aDecay;
  varying float vShade;
  varying float vDecay;
  varying vec2 vUv;
  varying float vSeed;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vDecay = aDecay;
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <project_vertex>
    #include <fog_vertex>
    vec3 n = normalize(transformedNormal);
    vShade = 0.72 + 0.28 * abs(dot(n, normalize(vec3(0.4, 0.45, 0.8))));
  }
`;

const PAPER_FRAG = `
  varying float vShade;
  varying float vDecay;
  varying vec2 vUv;
  varying float vSeed;
  #include <common>
  #include <fog_pars_fragment>
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    // Désagrégation : des trous apparaissent et grandissent jusqu'à
    // ne laisser que des miettes, puis plus rien
    vec2 q = vUv * 5.0 + vSeed * 17.0;
    float n = 0.65 * n2(q) + 0.35 * n2(q * 3.1);
    if (n < vDecay) discard;
    float edge = smoothstep(vDecay, vDecay + 0.06, n); // bord des trous un peu grisé
    vec3 paper = vec3(0.985, 0.98, 0.97) * (gl_FrontFacing ? 1.0 : 0.9);
    vec3 col = paper * vShade * mix(0.82, 1.0, edge);
    gl_FragColor = vec4(col, 1.0);
    #ifdef USE_FOG
      float fogFactor = smoothstep(fogNear, fogFar, fogDepth);
      // Brouillard atténué (lisible au loin), mais fondu complet dans le blanc
      // juste avant la limite d'affichage de la caméra : pas de coupure nette
      float fadeOut = smoothstep(fogFar * 0.9, fogFar * 1.12, fogDepth);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, max(fogFactor * 0.5, fadeOut));
    #endif
  }
`;

function makePaperGeometry(count) {
  // Fragment de papier au contour déchiré (rayon irrégulier + dentelure)
  const SEG = 22;
  const positions = [0, 0, 0];
  const uvs = [0.5, 0.5];
  const indices = [];
  const lobes = [];
  for (let k = 0; k < 4; k++) lobes.push({ f: 1 + k, ph: Math.random() * 6.28, a: 0.18 / (k + 1) });
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    let r = 0.42;
    for (const l of lobes) r += l.a * Math.sin(a * l.f + l.ph);
    r += (Math.random() - 0.5) * 0.09; // dentelure
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.75;
    positions.push(x, y, x * x * 0.35 - y * 0.1);
    uvs.push(0.5 + x, 0.5 + y);
    indices.push(0, 1 + i, 1 + ((i + 1) % SEG));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) seed[i] = Math.random();
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
  const decay = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  decay.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("aDecay", decay);
  return g;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

// Effet réservé aux appareils avec souris : sur téléphone / tablette, le
// glisser du doigt sert au scroll, on évite toute confusion avec le dessin.
// (Rien n'est chargé ni écouté dans ce cas.)
function hasMouse() {
  return window.matchMedia && window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches;
}

window.initSceneEffects = function (scene, camera, root, renderer) {
  if (!hasMouse()) return { update() {} };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  // La scène est exportée de Blender en Z-up : le "haut" visuel est +Z
  const UP = new THREE.Vector3(0, 0, 1);
  const stamps = [];
  let elapsed = 0;

  // Texture du bois : version Basis (compressée GPU), sinon JPEG en secours.
  // En attendant le chargement, une couleur unie de teck.
  let woodMap = new THREE.DataTexture(new Uint8Array([168, 128, 92]), 1, 1, THREE.RGBFormat);
  woodMap.needsUpdate = true;
  const useWood = (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    woodMap = tex;
    if (typeof woodMat !== "undefined") woodMat.uniforms.woodMap.value = tex;
  };
  const loadJpegWood = () => new THREE.TextureLoader().load(WOOD_TEXTURE_URL, useWood);
  if (THREE.BasisTextureLoader) {
    try {
      new THREE.BasisTextureLoader()
        .setTranscoderPath("js/basis/")
        .detectSupport(renderer)
        .load(WOOD_TEXTURE_BASIS_URL, useWood, undefined, loadJpegWood);
    } catch (e) {
      loadJpegWood();
    }
  } else {
    loadJpegWood();
  }

  // ---------- Bouts de papier (une seule InstancedMesh) ----------
  const paperMat = new THREE.ShaderMaterial({
    vertexShader: PAPER_VERT,
    fragmentShader: PAPER_FRAG,
    uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    side: THREE.DoubleSide,
    fog: true,
  });
  const paperGeo = makePaperGeometry(MAX_PAPERS);
  const decayAttr = paperGeo.attributes.aDecay;
  const paperMesh = new THREE.InstancedMesh(paperGeo, paperMat, MAX_PAPERS);
  paperMesh.frustumCulled = false;
  paperMesh.renderOrder = 2;
  paperMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(paperMesh);

  const papers = [];
  for (let i = 0; i < MAX_PAPERS; i++) {
    papers.push({
      alive: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      axis: new THREE.Vector3(),
      spin: 0,
      age: 0,
      life: 1,
      size: new THREE.Vector3(),
      phase: 0,
      scale: 1, // échelle de l'effet autour du clic
    });
  }
  let nextPaper = 0;
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_PAPERS; i++) paperMesh.setMatrixAt(i, zero);

  function spawnPaper(origin, normal, tangent, bitangent, R, rNorm) {
    const c = papers[nextPaper];
    nextPaper = (nextPaper + 1) % MAX_PAPERS;
    const ang = Math.random() * Math.PI * 2;
    const radial = new THREE.Vector3()
      .addScaledVector(tangent, Math.cos(ang))
      .addScaledVector(bitangent, Math.sin(ang));
    c.alive = true;
    c.age = 0;
    c.life = rand(2.8, 4.5);
    const s = R * rand(0.1, 0.22);
    c.size.set(s * rand(0.8, 1.3), s * rand(0.8, 1.3), s);
    c.scale = R;
    c.phase = Math.random() * 100;
    c.pos.copy(origin).addScaledVector(radial, rNorm * R * 0.8).addScaledVector(normal, R * 0.02);
    // Le papier se soulève de la surface puis est emporté vers le haut
    c.vel
      .copy(normal).multiplyScalar(R * rand(0.6, 1.4))
      .addScaledVector(radial, R * rand(0.3, 0.8))
      .addScaledVector(UP, R * rand(0.4, 0.9));
    // Orientation initiale : à plat sur la surface
    c.quat.setFromUnitVectors(Z, normal);
    c.quat.multiply(tmpQ.setFromAxisAngle(Z, Math.random() * Math.PI * 2));
    c.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    c.spin = rand(1.5, 4.5) * (Math.random() < 0.5 ? -1 : 1);
  }

  let papersDirty = false; // évite tout envoi au GPU quand aucun papier ne vole
  function updatePapers(dt) {
    let alive = 0;
    for (let i = 0; i < MAX_PAPERS; i++) {
      const c = papers[i];
      if (!c.alive) continue;
      c.age += dt;
      if (c.age >= c.life) {
        c.alive = false;
        paperMesh.setMatrixAt(i, zero);
        papersDirty = true;
        continue;
      }
      alive++;
      const R = c.scale;
      const t = elapsed + c.phase;
      // Jamais de chute : légère portance et vent changeant
      c.vel.z += R * 0.3 * dt;
      c.vel.x += Math.sin(t * 1.3) * R * 0.8 * dt;
      c.vel.y += Math.cos(t * 1.1) * R * 0.8 * dt;
      c.vel.z += Math.sin(t * 2.3) * R * 0.3 * dt;
      c.vel.multiplyScalar(Math.exp(-1.0 * dt)); // traînée
      c.pos.addScaledVector(c.vel, dt);
      // Flottement : décollement lent puis rotation douce
      const peel = Math.min(c.age / 0.4, 1);
      c.quat.multiply(tmpQ.setFromAxisAngle(c.axis, c.spin * peel * dt));
      // Désagrégation progressive à partir du premier tiers de vie
      const k = c.age / c.life;
      decayAttr.array[i] = THREE.MathUtils.smoothstep(k, 0.3, 1.0) * 1.05;
      const grow = Math.min(c.age / 0.15, 1);
      tmpS.copy(c.size).multiplyScalar(0.6 + 0.4 * grow);
      tmpM.compose(c.pos, c.quat, tmpS);
      paperMesh.setMatrixAt(i, tmpM);
    }
    if (alive > 0 || papersDirty) {
      paperMesh.instanceMatrix.needsUpdate = true;
      decayAttr.needsUpdate = true;
    }
    papersDirty = false;
    paperMesh.visible = alive > 0;
  }

  // ---------- Empreintes de révélation ----------
  // Portée maximale du bord d'une zone : rayon + amplitude de la déchirure
  const TEAR_AMP = 0.47;

  // Empreintes du même objet assez proches pour recouvrir la nouvelle zone
  function findOverlaps(point, R, mesh) {
    const out = [];
    const layer = layers.get(mesh);
    if (!layer) return out;
    for (const o of layer.stamps) {
      if (o.removing) continue;
      if (o.point.distanceTo(point) < 0.85 * (R + o.R) + TEAR_AMP) out.push(o);
    }
    return out;
  }

  // Réplique JS exacte du champ calculé dans le shader (union + déchirure),
  // pour savoir si un point est vraiment déjà dévoilé.
  const fract = (x) => x - Math.floor(x);
  function hash3(x, y, z) {
    x = fract(x * 0.1031); y = fract(y * 0.103); z = fract(z * 0.0973);
    const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
    x += d; y += d; z += d;
    return fract((x + y) * z);
  }
  function noise3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const q = (f) => f * f * f * (f * (f * 6 - 15) + 10);
    const fx = q(x - ix), fy = q(y - iy), fz = q(z - iz);
    const L = (a, b, t) => a + (b - a) * t;
    const h = (a, b, c) => hash3(ix + a, iy + b, iz + c);
    return L(
      L(L(h(0, 0, 0), h(1, 0, 0), fx), L(h(0, 1, 0), h(1, 1, 0), fx), fy),
      L(L(h(0, 0, 1), h(1, 0, 1), fx), L(h(0, 1, 1), h(1, 1, 1), fx), fy),
      fz
    );
  }
  function fbm3(x, y, z) {
    let v = 0, a = 0.5;
    for (let i = 0; i < 3; i++) {
      v += a * noise3(x, y, z);
      x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; z = z * 2.03 + 17.1;
      a *= 0.5;
    }
    return v / 0.875;
  }
  function tear(p) {
    return (fbm3(p.x * 1.1, p.y * 1.1, p.z * 1.1) - 0.5) * 0.7
      + (noise3(p.x * 7, p.y * 7, p.z * 7) - 0.5) * 0.14
      + (noise3(p.x * 23, p.y * 23, p.z * 23) - 0.5) * 0.05;
  }
  function fieldAt(p, candidates) {
    let u = 1e5;
    for (const o of candidates) u = Math.min(u, p.distanceTo(o.point) - o.R * 0.85); // zone finale
    return u + tear(p);
  }

  // La zone est-elle déjà dévoilée ? Centre + deux couronnes de points :
  // si tout est déjà à l'intérieur du masque, on n'ajoute rien.
  // Seules les empreintes posées sur le même objet comptent (le décalque
  // n'existe que sur l'objet touché).
  const probe = new THREE.Vector3();
  function isAlreadyRevealed(point, R, tangent, bitangent, candidates) {
    if (!candidates.length) return false;
    const inside = (p) => fieldAt(p, candidates) < -0.04;
    if (!inside(point)) return false;
    for (const ring of [0.45, 0.8]) {
      for (let k = 0; k < 8; k++) {
        const a = ((k + ring) / 8) * Math.PI * 2;
        probe.copy(point)
          .addScaledVector(tangent, Math.cos(a) * R * ring * 0.85)
          .addScaledVector(bitangent, Math.sin(a) * R * ring * 0.85);
        if (!inside(probe)) return false;
      }
    }
    return true;
  }

  // ---------- Calques fusionnés : un par objet touché ----------
  const woodMat = new THREE.ShaderMaterial({
    vertexShader: WOOD_VERT,
    fragmentShader: WOOD_FRAG,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        woodMap: { value: null },
        tileSize: { value: WOOD_TILE_SIZE },
        tint: { value: new THREE.Color(1, 1, 1) },
        tintAmount: { value: 0 },
      },
    ]),
    fog: true,
    transparent: true,
    depthWrite: false,
    // Dessiné des deux côtés : sur les objets en miroir (échelle négative,
    // ex. statue de droite, rideaux de droite, sol de l'expo) ou aux faces
    // inversées, le décalque est "vu de dos" et serait sinon invisible
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    extensions: { derivatives: true },
  });
  woodMat.uniforms.woodMap.value = woodMap; // (merge clonerait la texture)

  const ATTRS = ["position", "normal", "aStamp", "aProg"];
  const layers = new Map(); // objet 3D -> calque
  const growing = new Set(); // empreintes dont la progression change

  function allocLayer(layer, capacity) {
    const old = layer.geometry;
    const g = new THREE.BufferGeometry();
    const sizes = { position: 3, normal: 3, aStamp: 4, aProg: 1 };
    for (const name of ATTRS) {
      const attr = new THREE.BufferAttribute(new Float32Array(capacity * sizes[name]), sizes[name]);
      attr.setUsage(THREE.DynamicDrawUsage);
      if (old) attr.array.set(old.attributes[name].array.subarray(0, layer.count * sizes[name]));
      g.setAttribute(name, attr);
    }
    if (old) old.dispose();
    g.setDrawRange(0, layer.count);
    layer.geometry = g;
    layer.capacity = capacity;
    if (layer.mesh) layer.mesh.geometry = g;
  }

  function getLayer(mesh) {
    let layer = layers.get(mesh);
    if (layer) return layer;
    layer = { stamps: [], count: 0, dead: 0, capacity: 0, geometry: null, mesh: null, progDirty: false };
    allocLayer(layer, 4096);
    layer.mesh = new THREE.Mesh(layer.geometry, woodMat);
    layer.mesh.frustumCulled = false;
    layer.mesh.renderOrder = 1;
    scene.add(layer.mesh);
    layers.set(mesh, layer);
    return layer;
  }

  // Recompacte un calque quand trop d'empreintes refermées y traînent
  function compactLayer(layer) {
    const g = layer.geometry;
    let write = 0;
    for (const s of layer.stamps) {
      if (s.start !== write) {
        for (const name of ATTRS) {
          const at = g.attributes[name];
          const k = at.itemSize;
          at.array.copyWithin(write * k, s.start * k, (s.start + s.count) * k);
        }
        s.start = write;
      }
      write += s.count;
    }
    layer.count = write;
    layer.dead = 0;
    g.setDrawRange(0, write);
    for (const name of ATTRS) g.attributes[name].needsUpdate = true;
  }

  function writeProgress(s) {
    s.layer.geometry.attributes.aProg.array.fill(s.progress, s.start, s.start + s.count);
    s.layer.progDirty = true;
  }

  // Ajoute une empreinte si elle agrandit la zone dévoilée (addition
  // uniquement). Pas de limite de voisines : un clic sur du blanc visible
  // ajoute toujours une empreinte.
  function addStamp(hit, R, papersCount, growTime) {
    const mesh = hit.object;
    const point = hit.point.clone();
    const normal = hit.normal.clone();
    const toCam = camera.getWorldPosition(new THREE.Vector3()).sub(point);
    if (normal.dot(toCam) < 0) normal.negate();
    const tangent = new THREE.Vector3()
      .crossVectors(normal, Math.abs(normal.z) < 0.95 ? UP : new THREE.Vector3(1, 0, 0))
      .normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    // Addition uniquement : rien à faire si la zone est déjà dévoilée
    if (isAlreadyRevealed(point, R, tangent, bitangent, findOverlaps(point, R, mesh))) return false;

    const helper = new THREE.Object3D();
    helper.position.copy(point);
    helper.lookAt(point.clone().add(normal));
    let geometry;
    try {
      // La boîte doit contenir la zone + l'amplitude de la déchirure (~0.5 unité)
      // (profondeur égale : sur les surfaces courbes comme les sapins, la
      // zone n'est pas coupée)
      const side = 2 * (0.85 * R + 0.6);
      // Décalque calculé sur les seuls triangles proches (index spatial),
      // pas sur toute la zone fusionnée
      const local = nearbyTriangles(mesh, point, side * 0.87);
      if (!local) return false;
      geometry = new THREE.DecalGeometry(local, point, helper.rotation, new THREE.Vector3(side, side, side));
      local.geometry.dispose();
    } catch (e) {
      return false;
    }
    const pos = geometry.attributes.position;
    if (!pos || pos.count === 0) return false;

    // Copie du décalque dans le calque de l'objet
    const layer = getLayer(mesh);
    const n = pos.count;
    if (layer.count + n > layer.capacity) {
      let cap = layer.capacity;
      while (layer.count + n > cap) cap *= 2;
      allocLayer(layer, cap);
    }
    const g = layer.geometry;
    const start = layer.count;
    g.attributes.position.array.set(pos.array, start * 3);
    g.attributes.normal.array.set(geometry.attributes.normal.array, start * 3);
    const st = g.attributes.aStamp.array;
    for (let i = 0; i < n; i++) {
      const o = (start + i) * 4;
      st[o] = point.x; st[o + 1] = point.y; st[o + 2] = point.z; st[o + 3] = R;
    }
    g.attributes.aProg.array.fill(0, start, start + n);
    geometry.dispose();
    layer.count += n;
    g.setDrawRange(0, layer.count);
    for (const name of ATTRS) g.attributes[name].needsUpdate = true;

    const s = {
      layer, mesh, start, count: n, point, normal, tangent, bitangent, R, growTime, papersCount,
      age: 0, progress: 0, spawned: 0, removing: false, removeAge: 0,
    };
    layer.stamps.push(s);
    stamps.push(s);
    growing.add(s);

    // Trop d'empreintes : on referme les plus anciennes
    let active = 0;
    for (let i = stamps.length - 1; i >= 0; i--) {
      if (stamps[i].removing) continue;
      if (++active > MAX_STAMPS) {
        stamps[i].removing = true;
        growing.add(stamps[i]);
      }
    }
    return true;
  }

  function updateStamps(dt) {
    // Seules les empreintes qui s'ouvrent ou se referment sont mises à jour
    for (const s of growing) {
      s.age += dt;
      const t = Math.min(s.age / s.growTime, 1);
      s.progress = 1 - Math.pow(1 - t, 3);
      // Les papiers s'arrachent au front de déchirure
      const target = Math.floor(s.papersCount * s.progress * s.progress);
      while (s.spawned < target) {
        const rNorm = Math.sqrt(s.spawned / s.papersCount);
        spawnPaper(s.point, s.normal, s.tangent, s.bitangent, s.R, Math.max(rNorm, 0.05));
        s.spawned++;
      }
      if (s.removing) {
        s.removeAge += dt;
        s.progress *= Math.max(1 - s.removeAge / 0.8, 0);
        if (s.removeAge >= 0.8) {
          s.progress = 0;
          writeProgress(s);
          growing.delete(s);
          stamps.splice(stamps.indexOf(s), 1);
          const layer = s.layer;
          layer.stamps.splice(layer.stamps.indexOf(s), 1);
          layer.dead += s.count;
          if (layer.dead > 4096 && layer.dead > layer.count / 2) compactLayer(layer);
          continue;
        }
      } else if (t >= 1) {
        growing.delete(s);
      }
      writeProgress(s);
    }
    for (const layer of layers.values()) {
      if (layer.progDirty) {
        layer.geometry.attributes.aProg.needsUpdate = true;
        layer.progDirty = false;
      }
    }
  }

  // ---------- Index spatial (BVH) des objets de la scène ----------
  // Les objets sont fusionnés par zone (jusqu'à ~8000 triangles) : sans
  // index, chaque rayon et chaque décalque parcourraient tous les triangles
  // de la zone. Ici on découpe chaque objet en boîtes imbriquées de quelques
  // dizaines de triangles, construites une seule fois au premier besoin.
  const LEAF_TRIS = 32;
  const sceneMeshes = [];
  root.traverse((o) => { if (o.isMesh) sceneMeshes.push(o); });
  const bvhCache = new Map();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const _hit = new THREE.Vector3(), _box = new THREE.Box3();

  function buildBVH(mesh) {
    mesh.updateMatrixWorld();
    const g = mesh.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
    const n = idx ? idx.count / 3 : pos.count / 3;
    const P = new Float32Array(n * 9);   // sommets en coordonnées monde
    const N = new Float32Array(n * 9);   // normales des sommets en monde
    const C = new Float32Array(n * 3);   // centres des triangles
    const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const v = new THREE.Vector3();
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        v.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
        P[t * 9 + k * 3] = v.x; P[t * 9 + k * 3 + 1] = v.y; P[t * 9 + k * 3 + 2] = v.z;
        if (nor) v.fromBufferAttribute(nor, vi).applyMatrix3(nm).normalize(); else v.set(0, 0, 1);
        N[t * 9 + k * 3] = v.x; N[t * 9 + k * 3 + 1] = v.y; N[t * 9 + k * 3 + 2] = v.z;
      }
      for (let a = 0; a < 3; a++) C[t * 3 + a] = (P[t * 9 + a] + P[t * 9 + 3 + a] + P[t * 9 + 6 + a]) / 3;
    }
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    function node(start, count) {
      const box = new THREE.Box3();
      for (let i = start; i < start + count; i++) {
        const t = order[i];
        for (let k = 0; k < 3; k++) box.expandByPoint(v.set(P[t * 9 + k * 3], P[t * 9 + k * 3 + 1], P[t * 9 + k * 3 + 2]));
      }
      if (count <= LEAF_TRIS) return { box, start, count };
      // découpe au milieu sur l'axe le plus long (tri des centres)
      const size = box.getSize(new THREE.Vector3());
      const axis = size.x > size.y ? (size.x > size.z ? 0 : 2) : (size.y > size.z ? 1 : 2);
      const sub = Array.from(order.subarray(start, start + count)).sort((x, y) => C[x * 3 + axis] - C[y * 3 + axis]);
      order.set(sub, start);
      const half = count >> 1;
      return { box, left: node(start, half), right: node(start + half, count - half) };
    }
    const tree = { mesh, P, N, order, root: node(0, n) };
    bvhCache.set(mesh, tree);
    return tree;
  }
  const getBVH = (mesh) => bvhCache.get(mesh) || buildBVH(mesh);

  // Rayon -> triangle le plus proche (toutes faces, comme le rendu double face)
  function raycastBVH(ray, far) {
    let best = null, bestDist = far;
    for (const mesh of sceneMeshes) {
      if (!mesh.visible) continue;
      const geo = mesh.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const sphere = geo.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
      if (!ray.intersectsSphere(sphere)) continue;
      const tree = getBVH(mesh);
      const stack = [tree.root];
      while (stack.length) {
        const nd = stack.pop();
        const hb = ray.intersectBox(nd.box, _hit);
        if (!hb || ray.origin.distanceTo(hb) > bestDist) {
          if (!nd.box.containsPoint(ray.origin)) continue;
        }
        if (nd.left) { stack.push(nd.left, nd.right); continue; }
        for (let i = nd.start; i < nd.start + nd.count; i++) {
          const t = tree.order[i], P = tree.P;
          _a.set(P[t * 9], P[t * 9 + 1], P[t * 9 + 2]);
          _b.set(P[t * 9 + 3], P[t * 9 + 4], P[t * 9 + 5]);
          _c.set(P[t * 9 + 6], P[t * 9 + 7], P[t * 9 + 8]);
          if (!ray.intersectTriangle(_a, _b, _c, false, _hit)) continue;
          const d = ray.origin.distanceTo(_hit);
          if (d < bestDist && d > 1e-4) {
            bestDist = d;
            const normal = new THREE.Vector3().subVectors(_c, _b).cross(_a.clone().sub(_b)).normalize();
            best = { object: mesh, point: _hit.clone(), distance: d, normal };
          }
        }
      }
    }
    return best;
  }

  // Triangles d'un objet proches d'un point, regroupés dans un petit mesh
  // temporaire (coordonnées monde) pour calculer le décalque
  function nearbyTriangles(mesh, center, radius) {
    const tree = getBVH(mesh);
    _box.setFromCenterAndSize(center, new THREE.Vector3(radius * 2, radius * 2, radius * 2));
    const tris = [];
    const stack = [tree.root];
    while (stack.length) {
      const nd = stack.pop();
      if (!nd.box.intersectsBox(_box)) continue;
      if (nd.left) { stack.push(nd.left, nd.right); continue; }
      for (let i = nd.start; i < nd.start + nd.count; i++) tris.push(tree.order[i]);
    }
    if (!tris.length) return null;
    const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9);
    tris.forEach((t, j) => {
      pos.set(tree.P.subarray(t * 9, t * 9 + 9), j * 9);
      nor.set(tree.N.subarray(t * 9, t * 9 + 9), j * 9);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    const m = new THREE.Mesh(g);
    m.updateMatrixWorld();
    return m;
  }

  // Construction des index pendant les temps morts après le chargement,
  // un objet à la fois : le premier clic ne provoque pas de saccade
  (function prebuild(i) {
    if (i >= sceneMeshes.length) return;
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 50));
    idle(() => { getBVH(sceneMeshes[i]); prebuild(i + 1); });
  })(0);

  // ---------- Entrée utilisateur ----------
  function raycastAt(clientX, clientY) {
    ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    // au-delà de camera.far rien n'est affiché : on ne pose rien d'invisible
    return raycastBVH(raycaster.ray, camera.far);
  }

  // Taille aléatoire, en unités de scène (indépendante de la distance caméra)
  function randomRadius() {
    return rand(RADIUS_MIN, RADIUS_MAX);
  }

  // Ignore les clics sur l'interface (navigation, logo, liens, contact)
  const UI_SELECTOR = "a, button, #navigation-bar, .logo-container, .must-be-accessible, #credits";

  let stroke = null; // tracé en cours (souris)

  window.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest(UI_SELECTOR)) return;
    // Souris uniquement (ex. écran tactile d'un ordinateur portable : le
    // doigt fait défiler, il ne dessine pas)
    if (e.pointerType !== "mouse") return;
    // Le tracé démarre même dans le vide : il commencera à déchirer
    // dès que la souris passera sur un objet.
    // Pas de sélection de texte pendant qu'on dessine
    e.preventDefault();
    document.body.classList.add("is-drawing");
    const sel = window.getSelection && window.getSelection();
    if (sel) sel.removeAllRanges();
    const R = randomRadius();
    stroke = { R: R * DRAG_WIDTH, lastPoint: null, x: e.clientX, y: e.clientY, path: [], ended: false };
    const hit = raycastAt(e.clientX, e.clientY);
    if (hit) {
      stroke.lastPoint = hit.point.clone();
      addStamp(hit, R, PAPERS_PER_CLICK, CLICK_GROW_TIME);
    }
  });

  window.addEventListener("pointermove", (e) => {
    if (stroke && !stroke.ended && e.pointerType === "mouse") stroke.path.push({ x: e.clientX, y: e.clientY });
  });

  // Au relâchement, on termine quand même le chemin déjà parcouru
  function endStroke() {
    if (stroke) stroke.ended = true;
    document.body.classList.remove("is-drawing");
  }
  document.addEventListener("selectstart", (e) => {
    if (document.body.classList.contains("is-drawing")) e.preventDefault();
  });
  window.addEventListener("pointerup", endStroke);
  window.addEventListener("pointercancel", endStroke);
  window.addEventListener("blur", endStroke);

  // Suit le tracé en rééchantillonnant le chemin de la souris tous les
  // STROKE_STEP_PX pixels, avec un nombre limité de lancers de rayon par
  // image : si la souris va très vite, le tracé rattrape son retard sur
  // les images suivantes au lieu de ralentir l'affichage.
  function processStroke() {
    if (!stroke) return;
    let budget = MAX_RAYS_PER_FRAME;
    while (budget > 0 && stroke.path.length) {
      const target = stroke.path[0];
      const dx = target.x - stroke.x;
      const dy = target.y - stroke.y;
      const len = Math.hypot(dx, dy);
      if (len <= STROKE_STEP_PX) {
        stroke.x = target.x;
        stroke.y = target.y;
        stroke.path.shift();
        if (len < 0.5) continue;
      } else {
        stroke.x += (dx / len) * STROKE_STEP_PX;
        stroke.y += (dy / len) * STROKE_STEP_PX;
      }
      budget--;
      const hit = raycastAt(stroke.x, stroke.y);
      if (!hit) continue;
      if (!stroke.lastPoint || hit.point.distanceTo(stroke.lastPoint) >= stroke.R * DRAG_SPACING) {
        // Légère variation de largeur le long du tracé, pour un trait organique
        // (ignoré si la zone est déjà dévoilée)
        addStamp(hit, stroke.R * rand(0.85, 1.15), PAPERS_PER_DRAG_STAMP, STAMP_GROW_TIME);
        stroke.lastPoint = hit.point.clone();
      }
    }
    if (stroke.ended && !stroke.path.length) stroke = null;
  }

  // ---------- Teinte de section ----------
  // Lit la section courante sur la barre de navigation (attribut posé par
  // three_launcher.js) et fond la couleur du bois vers celle de la section.
  const navBar = document.getElementById("navigation-bar");
  const tintTarget = new THREE.Color(1, 1, 1);
  let tintAmountTarget = 0;
  const tintFrom = new THREE.Color(1, 1, 1);
  let tintAmountFrom = 0;
  let tintChapter; // section dont la couleur est visée
  let tintT = TINT_TRANSITION; // temps écoulé depuis le dernier changement
  // Fondu régulier sur TINT_TRANSITION secondes : lent au départ et à
  // l'arrivée (pas de grand saut dans les premières secondes)
  function updateTint(dt) {
    const u = woodMat.uniforms;
    const chapter = navBar ? navBar.getAttribute("currentChapter") : null;
    if (chapter !== tintChapter) {
      const first = tintChapter === undefined;
      tintChapter = chapter;
      // On repart de la couleur actuellement affichée (même en plein fondu)
      tintFrom.copy(u.tint.value);
      tintAmountFrom = u.tintAmount.value;
      const section = SECTION_TINTS[chapter];
      if (section) {
        tintTarget.setHex(section.color);
        tintAmountTarget = section.strength;
      } else {
        tintTarget.copy(u.tint.value); // intro : retour au bois naturel
        tintAmountTarget = 0;
      }
      tintT = first ? TINT_TRANSITION : 0;
    }
    tintT = Math.min(tintT + dt, TINT_TRANSITION);
    const x = tintT / TINT_TRANSITION;
    const p = x * x * (3 - 2 * x);
    u.tint.value.copy(tintFrom).lerp(tintTarget, p);
    u.tintAmount.value = tintAmountFrom + (tintAmountTarget - tintAmountFrom) * p;
  }

  return {
    update(dt) {
      elapsed += dt;
      updateTint(dt);
      processStroke();
      updateStamps(dt);
      updatePapers(dt);
    },
  };
};
