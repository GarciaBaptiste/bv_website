// Post-traitement de l'image 3D : effet maquette (tilt-shift), grain
// photographique léger et vignettage.
//
// Pipeline par image :
//   1. la scène est rendue normalement dans le canvas (l'anticrénelage MSAA
//      du canvas est conservé) ;
//   2. l'image est copiée dans une texture ;
//   3. passe 1 : flou horizontal à rayon variable -> cible intermédiaire ;
//   4. passe 2 : flou vertical + mélange net/flou selon la hauteur dans
//      l'image (bande nette au centre), grain et vignettage -> canvas.
// Coût : une copie + deux passes plein écran de 9 lectures de texture.
//
// Expose window.initPostEffects(renderer) qui renvoie
// { render(scene, camera, dt), setSize(w, h) }.

// ---------- Réglages ----------
const TILT_FOCUS_Y = 0.48; // hauteur de la bande nette (0 = bas, 1 = haut de l'image)
const TILT_FOCUS_HALF = 0.12; // demi-hauteur de la bande parfaitement nette
const TILT_FALLOFF = 0.35; // distance sur laquelle le flou atteint son maximum
const TILT_MAX_BLUR = 0.0045; // rayon de flou max, en fraction de la hauteur d'image
const GRAIN_AMOUNT = 0.035; // intensité du grain
const VIGNETTE_AMOUNT = 0.22; // assombrissement max dans les coins

const POST_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Quantité de flou selon la hauteur : nulle dans la bande, maximale loin
const TILT_GLSL = `
  uniform float focusY;
  uniform float focusHalf;
  uniform float falloff;
  float tiltAmount(float y) {
    float d = abs(y - focusY) - focusHalf;
    return smoothstep(0.0, falloff, d);
  }
`;

// Flou gaussien 9 lectures, rayon variable, dans une direction donnée
const BLUR_GLSL = `
  vec3 blur9(sampler2D tex, vec2 uv, vec2 dir) {
    vec3 c = texture2D(tex, uv).rgb * 0.2270270270;
    c += texture2D(tex, uv + dir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tex, uv - dir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tex, uv + dir * 3.2307692308).rgb * 0.0702702703;
    c += texture2D(tex, uv - dir * 3.2307692308).rgb * 0.0702702703;
    return c;
  }
`;

const BLUR_H_FRAG = `
  uniform sampler2D tDiffuse;
  uniform vec2 texel;      // 1 / taille en pixels
  uniform float maxBlur;   // rayon max en fraction de la hauteur
  varying vec2 vUv;
  ${TILT_GLSL}
  ${BLUR_GLSL}
  void main() {
    float t = tiltAmount(vUv.y);
    // Rayon en pixels réparti sur les lectures du noyau (~3.2 pas max)
    float r = t * maxBlur / texel.y / 3.23;
    if (r < 0.05) {
      gl_FragColor = texture2D(tDiffuse, vUv);
      return;
    }
    gl_FragColor = vec4(blur9(tDiffuse, vUv, vec2(texel.x * r, 0.0)), 1.0);
  }
`;

const FINAL_FRAG = `
  uniform sampler2D tSharp;
  uniform sampler2D tBlurH;
  uniform vec2 texel;
  uniform float maxBlur;
  uniform float time;
  uniform float grainAmount;
  uniform float vignetteAmount;
  uniform vec2 aspect;
  varying vec2 vUv;
  ${TILT_GLSL}
  ${BLUR_GLSL}

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    float t = tiltAmount(vUv.y);
    float r = t * maxBlur / texel.y / 3.23;
    vec3 col;
    if (r < 0.05) {
      col = texture2D(tSharp, vUv).rgb;
    } else {
      col = blur9(tBlurH, vUv, vec2(0.0, texel.y * r));
    }

    // Vignettage doux (elliptique, suit le format de l'image)
    vec2 q = (vUv - 0.5) * aspect;
    float v = smoothstep(0.35, 1.05, length(q) * 1.25);
    col *= 1.0 - vignetteAmount * v;

    // Grain photographique : bruit par pixel qui change à chaque image,
    // plus visible dans les tons moyens que dans les blancs purs
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    float g = hash(gl_FragCoord.xy + fract(time * 13.37) * 1000.0) - 0.5;
    col += g * grainAmount * (0.55 + 0.45 * (1.0 - luma));

    gl_FragColor = vec4(col, 1.0);
  }
`;

window.initPostEffects = function (renderer) {
  const quadGeo = new THREE.PlaneBufferGeometry(2, 2);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const commonUniforms = () => ({
    texel: { value: new THREE.Vector2() },
    maxBlur: { value: TILT_MAX_BLUR },
    focusY: { value: TILT_FOCUS_Y },
    focusHalf: { value: TILT_FOCUS_HALF },
    falloff: { value: TILT_FALLOFF },
  });

  const blurHMat = new THREE.ShaderMaterial({
    vertexShader: POST_VERT,
    fragmentShader: BLUR_H_FRAG,
    uniforms: Object.assign(commonUniforms(), { tDiffuse: { value: null } }),
    depthTest: false,
    depthWrite: false,
  });
  const finalMat = new THREE.ShaderMaterial({
    vertexShader: POST_VERT,
    fragmentShader: FINAL_FRAG,
    uniforms: Object.assign(commonUniforms(), {
      tSharp: { value: null },
      tBlurH: { value: null },
      time: { value: 0 },
      grainAmount: { value: GRAIN_AMOUNT },
      vignetteAmount: { value: VIGNETTE_AMOUNT },
      aspect: { value: new THREE.Vector2(1, 1) },
    }),
    depthTest: false,
    depthWrite: false,
  });

  const blurHScene = new THREE.Scene();
  const blurHQuad = new THREE.Mesh(quadGeo, blurHMat);
  blurHQuad.frustumCulled = false;
  blurHScene.add(blurHQuad);
  const finalScene = new THREE.Scene();
  const finalQuad = new THREE.Mesh(quadGeo, finalMat);
  finalQuad.frustumCulled = false;
  finalScene.add(finalQuad);

  let frameTex = null; // copie de l'image rendue
  let rtBlurH = null;
  let width = 0;
  let height = 0;
  let time = 0;
  const origin = new THREE.Vector2(0, 0);

  function setSize() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x));
    const h = Math.max(1, Math.floor(size.y));
    if (w === width && h === height) return;
    width = w;
    height = h;
    if (frameTex) frameTex.dispose();
    // Données initiales : force un premier envoi qui fixe les filtres
    frameTex = new THREE.DataTexture(new Uint8Array(w * h * 3), w, h, THREE.RGBFormat);
    frameTex.minFilter = THREE.LinearFilter;
    frameTex.magFilter = THREE.LinearFilter;
    frameTex.generateMipmaps = false;
    frameTex.needsUpdate = true;
    if (rtBlurH) rtBlurH.dispose();
    rtBlurH = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    for (const m of [blurHMat, finalMat]) m.uniforms.texel.value.set(1 / w, 1 / h);
    finalMat.uniforms.aspect.value.set(w / Math.max(w, h), h / Math.max(w, h));
    blurHMat.uniforms.tDiffuse.value = frameTex;
    finalMat.uniforms.tSharp.value = frameTex;
    finalMat.uniforms.tBlurH.value = rtBlurH.texture;
  }

  return {
    setSize,
    render(scene, camera, dt) {
      setSize();
      time += dt || 0;
      // 1. rendu normal dans le canvas
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      // 2. copie dans une texture
      renderer.copyFramebufferToTexture(origin, frameTex);
      // 3. flou horizontal
      renderer.setRenderTarget(rtBlurH);
      renderer.render(blurHScene, quadCam);
      // 4. flou vertical + grain + vignettage vers le canvas
      renderer.setRenderTarget(null);
      finalMat.uniforms.time.value = time;
      renderer.render(finalScene, quadCam);
    },
  };
};
