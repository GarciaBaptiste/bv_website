import * as THREE from "./build/three.module.js";
import { GLTFLoader } from "./loaders/GLTFLoader.js";

window.addEventListener("load", setup);
window.addEventListener("resize", onWindowResize, false);

let worldScene = null;
let renderer = null;
let camera = null;
let clock = null;
let mixer = null;
let gltf = null;
let content = null,
  contentPage = null,
  contentHeight = 0;
let animLength = null;
let previousScroll = 0;
let mesh = null;

let MODELS = [{ name: "test_camera_anim2.glb" }];

let numLoadedModels = 0;

function setup() {
  document.getElementById("content-page").addEventListener("scroll", scrolled);
  content = document.getElementById("content");
  contentPage = document.getElementById("content-page");
  getContentHeight();
  loadModels();
}

function loadModels() {
  for (let i = 0; i < MODELS.length; ++i) {
    const m = MODELS[i];
    loadGltfModel(m, function () {
      ++numLoadedModels;
      if (numLoadedModels === MODELS.length) {
        document.getElementById("loader").className = "hidden";
        window.setTimeout(
          () => (document.getElementById("loader").style.display = "none"),
          500
        );
        initRenderer();
        initScene();
      }
    });
  }
}

function loadGltfModel(model, onLoaded) {
  let loader = new GLTFLoader();
  const modelName = "models/" + model.name;
  loader.load(
    modelName,
    function (gltf_response) {
      gltf = gltf_response;
      let scene = gltf.scene;
      camera = gltf.cameras[0];
      camera.fov = 40;
      camera.far = 120;
      model.scene = scene;
      gltf.scene.traverse(function (object) {
        if (object.isMesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          object.matrixAutoUpdate = true;
        } else if (object.isLight) {
          object.castShadow = true;
          object.shadow.mapSize.width = 64;
          object.shadow.mapSize.height = 64;
          object.shadow.camera.near = 0.1;
          object.shadow.camera.far = 50;
          object.shadow.bias = -0.015;
          object.matrixAutoUpdate = true;
        }
      });
      onLoaded();
    },
    function (xhr) {
      document.getElementById("loader").innerText =
        "Loading model " + Math.round((xhr.loaded / xhr.total) * 100) + "%";
    }
  );
}

function initRenderer() {
  let container = document.getElementById("context");
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
}

function initScene() {
  window.addEventListener("mousemove", mouseMoved);
  animLength = Math.floor(gltf.animations[0].duration * 100) / 100;
  clock = new THREE.Clock();

  setSizeCamera();
  worldScene = new THREE.Scene();
  worldScene.background = new THREE.Color(0xffffff);
  worldScene.fog = new THREE.Fog(0xffffff, 5, 100);

  const hlight = new THREE.AmbientLight(0xffffff, 0.5);
  worldScene.add(hlight);

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
let delta = 0.02;

let lastLoop = new Date();

let fps = 1;

window.setInterval(function () {
  if (fps < 25) {
    testLowerSettings();
  } else if (fps > 58) {
    testHigherSettings();
  }
}, 3000);

function render() {
  const thisLoop = new Date();
  fps = 1000 / (thisLoop - lastLoop);
  lastLoop = thisLoop;
  // const roundedTime = Math.round(mixer.time * 10) / 10;
  if (mixer) {
    // if (goingForward) {
    //   mixer.timeScale = 1;
    //   if (roundedTime < keyFrames[keyFrameIndex]) {
    //     delta = 0.04;
    //   } else {
    //     delta = 0;
    //   }
    // } else {
    //   mixer.timeScale = -1;
    //   if (roundedTime > keyFrames[keyFrameIndex]) {
    //     delta = 0.04;
    //   } else {
    //     delta = 0;
    //   }
    // }
    var delta = clock.getDelta();
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

function getContentHeight() {
  contentHeight = content.offsetHeight - window.innerHeight;
}

function scrollRatio() {
  return contentPage.scrollTop / contentHeight;
}

let graphicSettingsIndex = 3;

const graphicSettings = [
  { shadowMap: false, mapSize: 16, fog: false, bias: -0.05 },
  { shadowMap: false, mapSize: 16, fog: true, bias: -0.05 },
  { shadowMap: true, mapSize: 16, fog: true, bias: -0.05 },
  { shadowMap: true, mapSize: 32, fog: true, bias: -0.05 },
  { shadowMap: true, mapSize: 64, fog: true, bias: -0.015 },
  { shadowMap: true, mapSize: 128, fog: true, bias: -0.01 },
  { shadowMap: true, mapSize: 256, fog: true, bias: -0.007 },
  { shadowMap: true, mapSize: 512, fog: true, bias: -0.005 },
  { shadowMap: true, mapSize: 1024, fog: true, bias: -0.003 },
];

function testLowerSettings() {
  if (graphicSettingsIndex > 0) {
    graphicSettingsIndex--;
    resetGraphicSettings();
  }
}

function testHigherSettings() {
  if (graphicSettingsIndex < graphicSettings.length - 1) {
    graphicSettingsIndex++;
    resetGraphicSettings();
  }
}

function resetGraphicSettings() {
  const elemsToTest = mesh.children;
  for (let i = 0; i < elemsToTest.length; i++) {
    if (elemsToTest[i].type === "PointLight") {
      elemsToTest[i].castShadow =
        graphicSettings[graphicSettingsIndex].shadowMap;
      elemsToTest[i].shadow.mapSize.width =
        graphicSettings[graphicSettingsIndex].mapSize;
      elemsToTest[i].shadow.mapSize.height =
        graphicSettings[graphicSettingsIndex].mapSize;
      elemsToTest[i].shadow.bias = graphicSettings[graphicSettingsIndex].bias;
      elemsToTest[i].shadow.map.dispose();
      elemsToTest[i].shadow.map = null;
    } else if (elemsToTest[i].type === "Mesh") {
      elemsToTest[i].castShadow =
        graphicSettings[graphicSettingsIndex].shadowMap;
      elemsToTest[i].receiveShadow =
        graphicSettings[graphicSettingsIndex].shadowMap;
    }
  }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function onWindowResize() {
  getContentHeight();
  scrolled();
  setSizeCamera();
}

let newTime = 0;

let keyFrameIndex = 0;
const keyFrames = [0, 4.8, 8.5, 15, 20, 26, 32, 40, 46];

function scrolled() {
  const roundedTime = Math.round(mixer.time * 10) / 10;
  if (previousScroll < this.scrollTop) {
    if (
      roundedTime < keyFrames[keyFrameIndex + 1] &&
      roundedTime >= keyFrames[keyFrameIndex]
    ) {
      keyFrameIndex++;
      goingForward = true;
    }
  } else if (previousScroll > this.scrollTop) {
    if (
      roundedTime <= keyFrames[keyFrameIndex] &&
      roundedTime > keyFrames[keyFrameIndex - 1]
    ) {
      keyFrameIndex--;
      goingForward = false;
    }
  }
  previousScroll = this.scrollTop;
}

function mouseMoved(evt) {
  camera.rotation.y += evt.movementX * 0.00002;
}
