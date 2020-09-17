window.addEventListener("load", setup);

import * as THREE from "./build/three.module.js";
import { GLTFLoader } from "./loaders/GLTFLoader.js";
import { DRACOLoader } from "./loaders/DRACOLoader.js";

var scene, camera, dirLight;
var renderer, mixer;

function setup() {
  var clock = new THREE.Clock();
  var container = document.getElementById("context");

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 0.4));

  dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 2, 8);
  scene.add(dirLight);

  var dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("js/libs/draco/gltf/");

  var loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  loader.load(
    "models/test_camera_anim2.glb",
    function (gltf) {
      document.getElementById("loader").className = "hidden";
      window.setTimeout(
        () => (document.getElementById("loader").style.display = "none"),
        500
      );
      var model = gltf.scene;
      model.position.set(1, 1, 0);
      model.scale.set(0.01, 0.01, 0.01);
      camera = gltf.cameras[0];
      console.log(camera);
      model.traverse(function (object) {
        if (object.isMesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          object.matrixAutoUpdate = false;
          object.updateMatrix();
        } else if (object.isLight) {
          object.castShadow = true;
          object.shadow.mapSize.width = 128;
          object.shadow.mapSize.height = 128;
          object.shadow.camera.near = 0.1;
          object.shadow.camera.far = 50;
          object.shadow.bias = -0.005;
          object.shadow.radius = 1;
          object.matrixAutoUpdate = false;
          object.updateMatrix();
        }
      });

      scene.add(model);

      mixer = new THREE.AnimationMixer(camera);
      mixer.clipAction(gltf.animations[0]).play();
      window.onresize = setSizeCamera();
      setSizeCamera();
      animate();
    },
    function (xhr) {
      document.getElementById("loader").innerText =
        "Loading model " + Math.round((xhr.loaded / xhr.total) * 100) + "%";
    },
    function (e) {
      console.error(e);
    }
  );

  function animate() {
    requestAnimationFrame(animate);

    var delta = clock.getDelta();
    mixer.update(delta);

    renderer.render(scene, camera);
  }

  function setSizeCamera() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
