window.addEventListener("load", setup);
window.addEventListener("resize", onWindowResize, false);
window.addEventListener("mousemove", mouseMoved);

let worldScene = null;
let renderer = null;
let camera = null;
let clock = null;

let MODELS = [{ name: "room" }];

let numLoadedModels = 0;

function setup() {
  initScene();
  initRenderer();
  loadModels();
}

function loadModels() {
  for (let i = 0; i < MODELS.length; ++i) {
    const m = MODELS[i];
    loadGltfModel(m, function () {
      ++numLoadedModels;
      if (numLoadedModels === MODELS.length) {
        document.getElementById("loader").style.display = "none";
        setupScene();
      }
    });
  }
}

function loadGltfModel(model, onLoaded) {
  let loader = new THREE.GLTFLoader();
  const modelName = "models/" + model.name + ".gltf";
  loader.load(
    modelName,
    function (gltf) {
      let scene = gltf.scene;
      model.scene = scene;

      gltf.scene.traverse(function (object) {
        if (object.isMesh) {
          console.log(object);
          object.castShadow = true;
          object.receiveShadow = true;
        } else if (object.isLight) {
          object.castShadow = true;
          object.shadow.mapSize.width = 1024;
          object.shadow.mapSize.height = 1024;
          object.shadow.camera.near = 0.1;
          object.shadow.camera.far = 500;
          object.shadow.bias = -0.005;
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

function animate() {
  requestAnimationFrame(animate);
  moveCamera();
  renderer.render(worldScene, camera);
}

function initRenderer() {
  let container = document.getElementById("context");
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
}

function initScene() {
  camera = new THREE.PerspectiveCamera(
    40,
    window.innerWidth / window.innerHeight,
    0.1,
    5000
  );
  camera.rotation.order = "YXZ";
  camera.position.x = -1.5;
  camera.position.y = 1.7;
  camera.position.z = 1.5;
  camera.rotation.y = 0.2;
  camera.rotation.x = 0.2;

  clock = new THREE.Clock();

  worldScene = new THREE.Scene();
  worldScene.background = new THREE.Color(0x000000);
  // worldScene.fog = new THREE.Fog(0x000000, 10, 30);

  const hlight = new THREE.AmbientLight(0xffffff, 0.05);
  worldScene.add(hlight);

  let light = new THREE.PointLight(0xffffff, 0.5, 50, 15);
  light.position.set(0, 3, 0);
  worldScene.add(light);
  light.castShadow = true;
  light.shadow.mapSize.width = 2048;
  light.shadow.mapSize.height = 2048;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 1000;
  light.shadow.bias = -0.005;
  light.shadow.radius = 1;
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function setupScene() {
  animate();
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function mouseMoved(evt) {}
