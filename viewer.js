import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b100d);
scene.fog = new THREE.FogExp2(0x0b100d, 0.0015);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 10000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xeaf4e5, 0x394238, 2.5));
const sunlight = new THREE.DirectionalLight(0xfff5dc, 2.2);
sunlight.position.set(-80, 120, 100);
scene.add(sunlight);

let model;
let initialCamera = null;
const loading = document.querySelector('#loading');
const loadingLabel = document.querySelector('#loading-label');
const progress = document.querySelector('#progress');

function frameModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  object.position.sub(center);

  const diameter = Math.max(size.x, size.y, size.z);
  camera.near = Math.max(diameter / 10000, 0.01);
  camera.far = diameter * 25;
  camera.position.set(diameter * 0.95, diameter * 0.8, diameter * 1.05);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = diameter * 0.08;
  controls.maxDistance = diameter * 6;
  controls.update();
  initialCamera = camera.position.clone();
  scene.fog.density = 0.7 / (diameter * 5);
}

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/');
const modelLoader = new GLTFLoader();
modelLoader.setDRACOLoader(dracoLoader);

modelLoader.load(
  './assets/akcakoyun-terrain.glb',
  (gltf) => {
    model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = true;
      }
    });
    scene.add(model);
    frameModel(model);
    loading.classList.add('hidden');
  },
  (event) => {
    if (!event.total) return;
    const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
    progress.style.width = `${percent}%`;
    loadingLabel.textContent = `Loading model · ${percent}%`;
  },
  (error) => {
    console.error(error);
    loadingLabel.textContent = 'The model could not be loaded';
    progress.style.background = '#e36b6b';
  },
);

document.querySelector('#reset').addEventListener('click', () => {
  if (!initialCamera) return;
  camera.position.copy(initialCamera);
  controls.target.set(0, 0, 0);
  controls.update();
});

document.querySelector('#rotate').addEventListener('click', (event) => {
  controls.autoRotate = !controls.autoRotate;
  controls.autoRotateSpeed = 0.7;
  event.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate));
});

document.querySelector('#wireframe').addEventListener('click', (event) => {
  if (!model) return;
  const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  model.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => { material.wireframe = enabled; });
  });
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
});

document.querySelector('#fullscreen').addEventListener('click', async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  else await document.exitFullscreen();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
