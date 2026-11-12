window.addEventListener("load", setup);
window.addEventListener("resize", onWindowResize, false);

let worldScene = null;
let renderer = null;
let camera = null;
let clock = null;
let mixer = null;
let gltf = null;
let contentPage = null;
let animLength = null;
let mesh = null;
let navigationBar;

let MODELS = [{ name: "scene_finale12.glb" }]; // scène nettoyée, fusionnée et compressée (voir models/README_scene.md)

let numLoadedModels = 0;

// Éclairage (mesuré : x2 sur les ponctuelles + ambiance 0.6 -> 0.5 donne
// +25 à 50 % de contraste local sans zones brûlées ; x3 seul blanchit l'image)
const POINT_LIGHT_BOOST = 2;
const AMBIENT_INTENSITY = 0.5;

function setup() {
  scrollDetector = document.getElementById("scroll-detector");
  scrollDetector.addEventListener("scroll", scrolled, { passive: true });
  window.addEventListener("wheel", wheeled, { passive: true });
  window.addEventListener("keydown", keyPressed);
  document.addEventListener("visibilitychange", onVisibilityRestored);
  window.addEventListener("focus", onVisibilityRestored);
  window.addEventListener("pageshow", onVisibilityRestored);
  resetScrollDetector();
  contentPage = document.getElementById("content-page");
  navigationBar = document.getElementById("navigation-bar");
  buildScreenDots();
  document.addEventListener("pointerdown", closeMenuOnOutsideClick, true);
  updateSlide();
  loadModels();
}

function loadModels() {
  for (let i = 0; i < MODELS.length; ++i) {
    const m = MODELS[i];
    loadGltfModel(m, function () {
      ++numLoadedModels;
      if (numLoadedModels === MODELS.length) {
        document.getElementById("index-slide").setAttribute("state", "loaded");
        document
          .getElementsByClassName("logo-container")[0]
          .setAttribute("state", "loaded");
        initRenderer();
        initScene();
      }
    });
  }
}

function loadGltfModel(model, onLoaded) {
  let loader = new THREE.GLTFLoader();
  // Géométrie compressée en Draco : décodeur WebAssembly dans js/draco/
  const draco = new THREE.DRACOLoader();
  draco.setDecoderPath("js/draco/");
  draco.setDecoderConfig({ type: "wasm" });
  loader.setDRACOLoader(draco);
  const modelName = "models/" + model.name;
  loader.load(
    modelName,
    function (gltf_response) {
      gltf = gltf_response;
      let scene = gltf.scene;
      camera = gltf.cameras[0];
      camera.far = 43.75; // distance d'affichage (+25 % : 35 -> 43.75)
      camera.rotation.order = "XZY";
      model.scene = scene;
      gltf.scene.traverse(function (object) {
        if (object.isLight) {
          object.intensity = object.intensity / 2000;
          // Petites lumières ponctuelles renforcées (x2), compensées par une
          // ambiance plus basse : plus de modelé sans blanchir l'image
          if (object.isPointLight) object.intensity *= POINT_LIGHT_BOOST;
        }
      });
      onLoaded();
    },
    function (xhr) {
      document.getElementById("loader-foreground").style.width =
        Math.round((xhr.loaded / xhr.total) * 100) + "%";
    },
    function (error) {
      console.log(error);
    }
  );
}

function initRenderer() {
  let container = document.getElementById("context");
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);
}

function initScene() {
  window.addEventListener("mousemove", mouseMoved);
  animLength = Math.floor(gltf.animations[0].duration * 100) / 100;
  clock = new THREE.Clock();

  setSizeCamera();
  worldScene = new THREE.Scene();
  worldScene.background = new THREE.Color(0xffffff);
  // Brouillard allongé dans la même proportion (30 -> 37.5) : sinon le blanc
  // complet arrive avant la limite d'affichage et rien de plus n'est visible
  worldScene.fog = new THREE.Fog(0xffffff, 0, 37.5);

  const hlight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
  worldScene.add(hlight);

  mesh = MODELS[0].scene;
  worldScene.add(mesh);

  mixer = new THREE.AnimationMixer(camera);
  mixer.clipAction(gltf.animations[0]).play();
  if (window.initSceneEffects) {
    window.sceneEffects = window.initSceneEffects(worldScene, camera, mesh, renderer);
  }
  // Post-traitement : effet maquette (tilt-shift), grain, vignettage
  if (window.initPostEffects) {
    window.postEffects = window.initPostEffects(renderer);
  }
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  render();
}

let goingForward = true;

// Vitesse de lecture de l'animation caméra, en secondes d'animation par seconde réelle.
// (l'ancien pas fixe de 0.02 par frame donnait 1.2 à 60 fps ; légèrement accéléré)
const BASE_PLAYBACK_SPEED = 1.7;
// Plafond du pas de temps : évite un saut énorme au retour sur l'onglet
const MAX_FRAME_DT = 0.1;

let scaleAmount = 0.7;

function render() {
  const dt = Math.min(clock.getDelta(), MAX_FRAME_DT);
  if (mixer) {
    const target = keyFrames[currentKeyFrameIndex];
    const remaining = target - mixer.time;
    // Distance d'animation à parcourir cette frame, indépendante du framerate
    let step = BASE_PLAYBACK_SPEED * scaleAmount * dt;
    if (Math.abs(remaining) <= step) step = Math.abs(remaining); // on s'arrête pile sur la keyframe
    goingForward = remaining >= 0;
    mixer.timeScale = goingForward ? 1 : -1;
    mixer.update(step);
  }
  if (window.sceneEffects) window.sceneEffects.update(dt);
  if (window.postEffects) window.postEffects.render(worldScene, camera, dt);
  else renderer.render(worldScene, camera);
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function setSizeCamera() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function updateSlide() {
  for (let i = 0; i < currentKeyFrameIndex; i++) {
    contentPage.children[i].setAttribute("state", "passed");
  }
  for (let j = currentKeyFrameIndex + 1; j < keyFrames.length; j++) {
    contentPage.children[j].setAttribute("state", "to-come");
  }
  contentPage.children[currentKeyFrameIndex].setAttribute("state", "current");
  previousKeyFrameIndex = currentKeyFrameIndex;
  if (currentKeyFrameIndex > 0) {
    navigationBar.setAttribute(
      "currentChapter",
      chapterNames[chapterIndexes[currentKeyFrameIndex]]
    );
  } else {
    navigationBar.setAttribute("currentChapter", "none");
  }
  for (const dot of screenDots) {
    dot.classList.toggle("is-current", Number(dot.dataset.screen) === currentKeyFrameIndex);
  }
}

// Navigation desktop : un cercle par écran à côté de chaque chapitre
// (plein = écran affiché, contour = autres écrans). Clic = aller à l'écran.
let screenDots = [];
function buildScreenDots() {
  const links = navigationBar.querySelectorAll("a");
  chapterNames.forEach((name, c) => {
    const link = Array.from(links).find((a) => a.classList.contains(name));
    if (!link) return;
    // Toutes les pastilles à gauche du titre, à la place de la pastille d'origine
    const before = document.createElement("span");
    before.className = "screen-dots screen-dots-before " + name;
    chapterIndexes.forEach((chapter, i) => {
      if (chapter !== c || i === 0) return; // l'écran 0 est l'intro
      const dot = document.createElement("span");
      dot.className = "screen-dot";
      dot.dataset.screen = i;
      dot.title = "Écran " + i;
      dot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation(); // ne pas déclencher le lien du chapitre
        changeChapter(i);
      });
      before.appendChild(dot);
      screenDots.push(dot);
    });
    const title = link.querySelector("h4");
    link.insertBefore(before, title);
  });
}

function changeChapter(newFrameIndex) {
  if (currentKeyFrameIndex === newFrameIndex) return;
  scaleAmount = 20;
  currentKeyFrameIndex = newFrameIndex;
  updateSlide();
}

// Menu burger (écrans étroits) : le moindre clic ou toucher en dehors de la
// barre de navigation referme le menu
function closeMenuOnOutsideClick(e) {
  const menuOpen = !navigationBar.classList.contains("navigation-bar-visible");
  if (!menuOpen || !window.matchMedia("(max-width: 700px)").matches) return;
  if (e.target.closest && e.target.closest("#navigation-bar")) return;
  toggleMenu();
}

function toggleMenu() {
  var closeBurger = document.querySelector(".close-burger");
  var openBurger = document.querySelector(".open-burger");
  navigationBar.classList.toggle("navigation-bar-visible");
  closeBurger.classList.toggle("burger-icon-visible");
  openBurger.classList.toggle("burger-icon-visible");
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function onWindowResize() {
  resetScrollDetector();
  if (camera && renderer) setSizeCamera();
}

let previousKeyFrameIndex = "";
let currentKeyFrameIndex = 0;
const keyFrames = [
  0.1,
  4.5,
  8.5,
  12.4,
  17,
  22,
  26.5,
  31.9,
  37.1,
  41.9,
  46.7,
  52.1,
  56.7,
  61.9,
  65.3,
  68.5,
];
const chapterIndexes = [0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3];
const chapterNames = ["naissance", "developpement", "realisations", "contact"];

// La caméra est-elle arrivée sur la keyframe courante ?
function cameraArrived() {
  return mixer && Math.abs(mixer.time - keyFrames[currentKeyFrameIndex]) < 0.001;
}

function step(direction) {
  if (!mixer || !cameraArrived()) return;
  const next = currentKeyFrameIndex + direction;
  if (next < 0 || next >= keyFrames.length) return;
  scaleAmount = 0.7;
  currentKeyFrameIndex = next;
  updateSlide();
}

let scrollDetector = null;

function resetScrollDetector() {
  if (!scrollDetector) return;
  ignoreNextScroll = true;
  scrollDetector.scrollTop = window.innerHeight;
}

let ignoreNextScroll = false;

function scrolled() {
  // Le détecteur est toujours recentré sur window.innerHeight : on compare
  // la position courante à ce centre pour connaître le sens du scroll.
  const center = window.innerHeight;
  const pos = scrollDetector.scrollTop;
  if (ignoreNextScroll && Math.abs(pos - center) < 1) {
    ignoreNextScroll = false;
    return;
  }
  ignoreNextScroll = false;
  if (pos > center + 0.5) step(1);
  else if (pos < center - 0.5) step(-1);
  resetScrollDetector();
}

// Filet de sécurité : si le détecteur ne reçoit plus d'événements scroll
// (ex. retour sur l'onglet, scroll déjà en butée), la molette fait quand même avancer.
function wheeled(evt) {
  if (evt.ctrlKey) return; // zoom navigateur
  if (Math.abs(evt.deltaY) < 1) return;
  step(evt.deltaY > 0 ? 1 : -1);
}

function keyPressed(evt) {
  if (["ArrowDown", "PageDown", " "].includes(evt.key)) step(1);
  else if (["ArrowUp", "PageUp"].includes(evt.key)) step(-1);
}

function onVisibilityRestored() {
  if (document.visibilityState !== "visible") return;
  if (clock) clock.getDelta(); // ignore le temps passé hors de l'onglet
  resetScrollDetector();
}

function mouseMoved(evt) {
  camera.rotation.y -= evt.movementX * 0.00002;
}
