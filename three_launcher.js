window.addEventListener("load", setup);
window.addEventListener("resize", onWindowResize, false);
window.addEventListener("mousemove", mouseMoved);

let worldScene = null;
let renderer = null;
let camera = null;
let clock = null;

let MODELS = [{ name: "room" }];

let numLoadedModels = 0;

let imagesContainer;

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
          object.castShadow = true;
          object.receiveShadow = true;
        } else if (object.isLight) {
          object.castShadow = true;
          object.shadow.mapSize.width = 2048;
          object.shadow.mapSize.height = 2048;
          object.shadow.camera.near = 0.1;
          object.shadow.camera.far = 50;
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
  camera.position.x = 16;
  camera.position.y = 5;
  camera.position.z = 16;
  camera.rotation.x = -0.0925;
  camera.rotation.y = 0.59;

  clock = new THREE.Clock();

  worldScene = new THREE.Scene();
  worldScene.background = new THREE.Color(0xffffff);
  worldScene.fog = new THREE.Fog(0xffffff, 10, 90);

  const hlight = new THREE.AmbientLight(0xffffff, 0.75);
  worldScene.add(hlight);

  let light = new THREE.PointLight(0xffffff, 1.5, 550, 25);
  light.position.set(17, 9, 50);
  worldScene.add(light);
  light.castShadow = true;
  light.shadow.mapSize.width = 2048;
  light.shadow.mapSize.height = 2048;
  light.shadow.camera.near = 10;
  light.shadow.camera.far = 100;
  light.shadow.bias = -0.005;
  light.shadow.radius = 10;
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function setupScene() {
  imagesContainer = document.getElementById("images-plan-selector");
  let images = document.getElementById("images-plan").children;
  console.log(images);
  for (var i = 0; i < images.length; i++) {
    let valueX = Math.random() * 100;
    let valueY = Math.random() * 100;
    images[i].style.left = "calc(" + valueX + "% - " + valueX / 5 + "vw)";
    images[i].style.top = "calc(" + valueY + "% - " + valueY / 5 + "vw)";
  }

  const mesh = MODELS[0].scene;
  worldScene.add(mesh);

  animate();
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function mouseMoved(evt) {
  let ratioX = evt.clientX / window.innerWidth;
  camera.position.x = (ratioX / 3) * 24 + 4;
  camera.position.z = (1 - ratioX / 3) * 16 + 8;
  camera.rotation.x = -((ratioX / 3.6) * 0.025 + 0.08);
  camera.rotation.y = (ratioX / 3.6) * 0.94 + 0.12;
  let ratioY = evt.clientY / window.innerHeight;
  camera.position.y = 7 - ratioY;

  imagesContainer.style.left = (1 - ratioX) * 100 + "vw";
  imagesContainer.style.top = (1 - ratioY) * 100 + "vh";
}
