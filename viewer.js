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
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xeaf4e5, 0x394238, 2.5));
const sunlight = new THREE.DirectionalLight(0xfff5dc, 2.2);
sunlight.position.set(-80, 120, 100);
scene.add(sunlight);

let model;
let modelCenter = new THREE.Vector3();
let modelBounds;
let locationMarker;
let initialCamera = null;
const loading = document.querySelector('#loading');
const loadingLabel = document.querySelector('#loading-label');
const progress = document.querySelector('#progress');

function frameModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  modelCenter.copy(center);
  object.position.sub(center);
  modelBounds = new THREE.Box3().setFromObject(object);

  const diameter = Math.max(size.x, size.y, size.z);
  camera.near = Math.max(diameter / 10000, 0.01);
  camera.far = diameter * 25;
  camera.position.set(diameter * 0.78, diameter * -0.9, diameter * 0.65);
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

const locationStatus = document.querySelector('#location-status');
const locateButton = document.querySelector('#locate');

function latLonToUtm35(latitude, longitude) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
  const lonOrigin = THREE.MathUtils.degToRad(27);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const t = tanLat * tanLat;
  const c = ep2 * cosLat * cosLat;
  const aa = cosLat * (lon - lonOrigin);
  const m = a * (
    (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * lat
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * lat)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * lat)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * lat)
  );
  const easting = k0 * n * (
    aa + (1 - t + c) * aa ** 3 / 6
    + (5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * aa ** 5 / 120
  ) + 500000;
  const northing = k0 * (
    m + n * tanLat * (
      aa ** 2 / 2
      + (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24
      + (61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * aa ** 6 / 720
    )
  );
  return { easting, northing };
}

function setLocationStatus(message) {
  locationStatus.hidden = false;
  locationStatus.textContent = message;
}

function addLocationMarker(position, accuracy) {
  if (locationMarker) scene.remove(locationMarker);
  locationMarker = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(1, accuracy - 0.35), Math.max(1.35, accuracy + 0.35), 64),
    new THREE.MeshBasicMaterial({ color: 0x6fd7ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
  );
  ring.position.z = 0.12;

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 7, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  stem.rotation.x = Math.PI / 2;
  stem.position.z = 3.6;

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0x6fd7ff }),
  );
  dot.position.z = 7.5;

  locationMarker.add(ring, stem, dot);
  locationMarker.position.copy(position);
  scene.add(locationMarker);
}

function showDevicePosition(position) {
  if (!model || !modelBounds) {
    setLocationStatus('The terrain is still loading. Try again when the model appears.');
    return;
  }

  const { easting, northing } = latLonToUtm35(position.coords.latitude, position.coords.longitude);
  const x = easting - 511796 - modelCenter.x;
  const y = northing - 4405516 - modelCenter.y;
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, y, modelBounds.max.z + 100), new THREE.Vector3(0, 0, -1));
  const hit = raycaster.intersectObject(model, true)[0];

  if (!hit) {
    const nearestX = THREE.MathUtils.clamp(x, modelBounds.min.x, modelBounds.max.x);
    const nearestY = THREE.MathUtils.clamp(y, modelBounds.min.y, modelBounds.max.y);
    const distance = Math.hypot(x - nearestX, y - nearestY);
    setLocationStatus(`You are outside the reconstructed area, approximately ${Math.round(distance)} m from its extent. GPS accuracy ±${Math.round(position.coords.accuracy)} m.`);
    return;
  }

  addLocationMarker(hit.point, Math.min(Math.max(position.coords.accuracy, 1.5), 20));
  controls.target.copy(hit.point);
  camera.position.set(hit.point.x + 35, hit.point.y - 45, hit.point.z + 40);
  controls.update();
  setLocationStatus(`Your approximate location is marked in blue. Phone GPS accuracy ±${Math.round(position.coords.accuracy)} m; model horizontal uncertainty is about 0.87 m.`);
}

locateButton.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setLocationStatus('Location is not supported by this browser.');
    return;
  }
  setLocationStatus('Waiting for your phone’s GPS…');
  navigator.geolocation.getCurrentPosition(
    showDevicePosition,
    (error) => {
      const messages = {
        1: 'Location permission was not granted. You can enable it in the browser’s site settings.',
        2: 'Your phone could not determine its current location.',
        3: 'The location request timed out. Move outdoors and try again.',
      };
      setLocationStatus(messages[error.code] || 'Your location could not be determined.');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
  );
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
