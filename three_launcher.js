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
let mobileDevice;

let MODELS = [{ name: "test_camera_anim2.glb" }];

let numLoadedModels = 0;

function setup() {
  mobileDevice = mobileAndTabletCheck();
  if (mobileDevice) {
    graphicSettingsIndex = 0;
  } else {
    graphicSettingsIndex = 4;
  }
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
      camera.far = 75;
      model.scene = scene;
      gltf.scene.traverse(function (object) {
        if (object.isMesh) {
          object.matrixAutoUpdate = true;
        } else if (object.isLight) {
          object.shadow.camera.near = 0.1;
          object.shadow.camera.far = 50;
          object.matrixAutoUpdate = true;
        }
        resetGraphicSettings(object);
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
  worldScene.fog = new THREE.Fog(0xffffff, 2, 70);

  const hlight = new THREE.AmbientLight(0xffffff, 0.5);
  worldScene.add(hlight);

  mesh = MODELS[0].scene;
  worldScene.add(mesh);

  mixer = new THREE.AnimationMixer(camera);
  mixer.clipAction(gltf.animations[0]).play();
  if (!mobileDevice) {
    window.setInterval(function () {
      if (fps < 25) {
        testLowerSettings(2);
      } else if (fps > 58) {
        testHigherSettings();
      }
    }, 3000);
  }
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  render();
}

let goingForward = true;
let delta = 0;

let lastLoop = new Date();

let fps = 1;

function countFps() {
  const thisLoop = new Date();
  fps = 1000 / (thisLoop - lastLoop);
  lastLoop = thisLoop;
}

function render() {
  if (!mobileDevice) {
    countFps();
  }
  contentPage.firstElementChild.firstElementChild.innerHTML =
    graphicSettingsIndex + " / " + Math.round(fps) + " / " + mobileDevice;
  const roundedTime = Math.round(mixer.time * 10) / 10;
  if (mixer) {
    if (goingForward) {
      mixer.timeScale = 1;
      if (roundedTime < keyFrames[keyFrameIndex]) {
        delta = 0.02;
      } else {
        delta = 0;
      }
    } else {
      mixer.timeScale = -1;
      if (roundedTime > keyFrames[keyFrameIndex]) {
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

function getContentHeight() {
  contentHeight = content.offsetHeight - window.innerHeight;
}

function scrollRatio() {
  return contentPage.scrollTop / contentHeight;
}

let graphicSettingsIndex;

const graphicSettings = [
  { shadowMap: false, mapSize: 16, bias: -0.05 },
  { shadowMap: true, mapSize: 16, bias: -0.05 },
  { shadowMap: true, mapSize: 32, bias: -0.05 },
  { shadowMap: true, mapSize: 64, bias: -0.015 },
  { shadowMap: true, mapSize: 128, bias: -0.01 },
  { shadowMap: true, mapSize: 256, bias: -0.007 },
  { shadowMap: true, mapSize: 512, bias: -0.005 },
  { shadowMap: true, mapSize: 1024, bias: -0.003 },
];

function testLowerSettings() {
  if (graphicSettingsIndex > 0) {
    graphicSettingsIndex--;
    for (let i = 0; i < mesh.children.length; i++) {
      resetGraphicSettings(mesh.children[i]);
    }
  }
}

function testHigherSettings() {
  if (graphicSettingsIndex < graphicSettings.length - 1) {
    graphicSettingsIndex++;
    for (let i = 0; i < mesh.children.length; i++) {
      resetGraphicSettings(mesh.children[i]);
    }
  }
}

function resetGraphicSettings(elemToTest) {
  if (elemToTest.type === "PointLight") {
    elemToTest.castShadow = graphicSettings[graphicSettingsIndex].shadowMap;
    elemToTest.shadow.mapSize.width =
      graphicSettings[graphicSettingsIndex].mapSize;
    elemToTest.shadow.mapSize.height =
      graphicSettings[graphicSettingsIndex].mapSize;
    elemToTest.shadow.bias = graphicSettings[graphicSettingsIndex].bias;
    if (elemToTest.shadow.map !== null) {
      elemToTest.shadow.map.dispose();
      elemToTest.shadow.map = null;
    }
  } else if (elemToTest.type === "Mesh") {
    elemToTest.castShadow = graphicSettings[graphicSettingsIndex].shadowMap;
    elemToTest.receiveShadow = graphicSettings[graphicSettingsIndex].shadowMap;
  }
}

function mobileAndTabletCheck() {
  let check = false;
  (function (a) {
    if (
      /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(
        a
      ) ||
      /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(
        a.substr(0, 4)
      )
    )
      check = true;
  })(navigator.userAgent || navigator.vendor || window.opera);
  return check;
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function onWindowResize() {
  getContentHeight();
  scrolled();
  setSizeCamera();
}

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
  camera.rotation.y -= evt.movementX * 0.00002;
}
