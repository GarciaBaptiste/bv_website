window.addEventListener("load", setup);
window.addEventListener("resize", onWindowResize, false);

let worldScene = null;
let renderer = null;
let mesh = null;
let camera = null;
let clock = null;
let mixer = null;
let gltf = null;

let MODELS = [{ name: "test_camera_anim" }];

let numLoadedModels = 0;

function setup() {
  document.getElementById("content-page").addEventListener("scroll", scrolled);
  loadModels();
}

function loadModels() {
  for (let i = 0; i < MODELS.length; ++i) {
    const m = MODELS[i];
    loadGltfModel(m, function () {
      ++numLoadedModels;
      if (numLoadedModels === MODELS.length) {
        document.getElementById("loader").style.display = "none";
        initRenderer();
        initScene();
      }
    });
  }
}

function loadGltfModel(model, onLoaded) {
  let loader = new THREE.GLTFLoader();
  const modelName = "models/" + model.name + ".gltf";
  loader.load(
    modelName,
    function (gltf_response) {
      gltf = gltf_response;
      let scene = gltf.scene;
      camera = gltf.cameras[0];
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
  clock = new THREE.Clock();

  worldScene = new THREE.Scene();
  worldScene.background = new THREE.Color(0xffffff);
  worldScene.fog = new THREE.Fog(0xffffff, 0, 80);

  const hlight = new THREE.AmbientLight(0xffffff, 0.75);
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

function render() {
  var delta = clock.getDelta();

  if (mixer) {
    mixer.update(delta);
  }

  renderer.render(worldScene, camera);
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function scrolled(evt) {
  console.log(evt.target.scrollTop);
}
