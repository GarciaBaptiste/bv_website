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
let previousScroll = 0;
let mesh = null;
let navigationBar;

let MODELS = [{ name: "scenelbv_final_04.glb" }];

let numLoadedModels = 0;

function setup() {
  document
    .getElementById("scroll-detector")
    .addEventListener("scroll", scrolled);
  contentPage = document.getElementById("content-page");
  navigationBar = document.getElementById("navigation-bar");
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
        initRenderer();
        initScene();
      }
    });
  }
}

function loadGltfModel(model, onLoaded) {
  let loader = new THREE.GLTFLoader();
  const modelName = "models/" + model.name;
  loader.load(
    modelName,
    function (gltf_response) {
      gltf = gltf_response;
      let scene = gltf.scene;
      camera = gltf.cameras[0];
      camera.fov = 40;
      camera.far = 30;
      camera.rotation.order = "XZY";
      model.scene = scene;
      gltf.scene.traverse(function (object) {
        if (object.isLight) {
          object.intensity = object.intensity / 2000;
        }
      });
      onLoaded();
    },
    function (xhr) {
      document.getElementById("loader").innerText =
        "Chargement " + Math.round((xhr.loaded / xhr.total) * 100) + "%";
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

let directionalLight;

function initScene() {
  window.addEventListener("mousemove", mouseMoved);
  animLength = Math.floor(gltf.animations[0].duration * 100) / 100;
  clock = new THREE.Clock();

  setSizeCamera();
  worldScene = new THREE.Scene();
  worldScene.background = new THREE.Color(0xffffff);
  worldScene.fog = new THREE.Fog(0xffffff, 2, 25);

  const hlight = new THREE.AmbientLight(0xffffff, 0.2);
  worldScene.add(hlight);

  // directionalLight = new THREE.DirectionalLight(0xffffff, 0.25);
  // directionalLight.position.set(100, 10, 150);
  // directionalLight.target.position.set(0, 0, 0);
  // directionalLight.castShadow = true;
  // const d = 100;
  // directionalLight.shadow.camera.left = -d;
  // directionalLight.shadow.camera.right = d;
  // directionalLight.shadow.camera.top = d;
  // directionalLight.shadow.camera.bottom = -d;
  // resetGraphicSettings(directionalLight);
  // worldScene.add(directionalLight);

  mesh = MODELS[0].scene;
  worldScene.add(mesh);

  mixer = new THREE.AnimationMixer(camera);
  mixer.clipAction(gltf.animations[0]).play();
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  render();
}

let goingForward = true;
let delta = 0;

let lastLoop = new Date();

let scaleAmount = 1;

function render() {
  const roundedTime = Math.round(mixer.time * 10) / 10;
  if (mixer) {
    if (goingForward) {
      mixer.timeScale = scaleAmount;
      if (roundedTime < keyFrames[currentKeyFrameIndex]) {
        delta = 0.02;
      } else {
        delta = 0;
      }
    } else {
      mixer.timeScale = -scaleAmount;
      if (roundedTime > keyFrames[currentKeyFrameIndex]) {
        delta = 0.02;
      } else {
        delta = 0;
      }
    }
    mixer.update(delta);
  }
  renderer.render(worldScene, camera);
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
  navigationBar.setAttribute(
    "currentChapter",
    chapterNames[chapterIndexes[currentKeyFrameIndex]]
  );
}

function changeChapter(newFrameIndex) {
  scaleAmount = 10;
  if (currentKeyFrameIndex < newFrameIndex) {
    goingForward = true;
    currentKeyFrameIndex = newFrameIndex;
    updateSlide();
  } else if (currentKeyFrameIndex > newFrameIndex) {
    goingForward = false;
    currentKeyFrameIndex = newFrameIndex;
    updateSlide();
  }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function onWindowResize() {
  scrolled();
  setSizeCamera();
}

let previousKeyFrameIndex = "";
let currentKeyFrameIndex = 0;
const keyFrames = [
  0,
  6,
  12,
  18,
  24,
  30,
  36,
  42,
  48,
  54,
  60,
  66,
  72,
  78,
  83,
  88,
];
const chapterIndexes = [null, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3];
const chapterNames = ["naissance", "developpement", "realisations", "contact"];

function scrolled(event) {
  scaleAmount = 1;
  const roundedTime = Math.round(mixer.time * 10) / 10;
  if (previousScroll < this.scrollTop) {
    if (
      roundedTime < keyFrames[currentKeyFrameIndex + 1] &&
      roundedTime >= keyFrames[currentKeyFrameIndex]
    ) {
      currentKeyFrameIndex++;
      goingForward = true;
    }
  } else if (previousScroll > this.scrollTop) {
    if (
      roundedTime <= keyFrames[currentKeyFrameIndex] &&
      roundedTime > keyFrames[currentKeyFrameIndex - 1]
    ) {
      currentKeyFrameIndex--;
      goingForward = false;
    }
  }
  this.scrollTop = window.innerHeight;
  previousScroll = this.scrollTop;
  updateSlide();
}

function mouseMoved(evt) {
  camera.rotation.y -= evt.movementX * 0.00002;
}
