(function () {
  'use strict';

  const loading = document.getElementById('loading');
  const loadingText = document.getElementById('loading-text');
  const toast = document.getElementById('toast');
  let pointcloud = null;
  let texturedModel = null;
  let modelLoading = false;
  let cameraTemplate = null;
  const cameraObjects = [];

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(function () { toast.classList.remove('visible'); }, 4500);
  }

  window.viewer = new Potree.Viewer(document.getElementById('potree_render_area'));
  viewer.setEDLEnabled(true);
  viewer.setFOV(60);
  viewer.setPointBudget(window.innerWidth <= 600 ? 2000000 : 10000000);
  viewer.setBackground('gradient');
  viewer.loadSettingsFromURL();
  viewer.scene.scene.add(new THREE.AmbientLight(0x404040, 2));
  const directional = new THREE.DirectionalLight(0xcccccc, 0.75);
  directional.position.set(0, 0, 1000000);
  viewer.scene.scene.add(directional);

  function setupSidebar() {
    viewer.setLanguage('en');
    $('#menu_tools').next().show();
    if (window.innerWidth > 600) viewer.toggleSidebar();

    $('#textured_model_button').html(
      '<label class="webodm-menu-row"><input id="toggle-textured-model" type="checkbox"> Show textured model</label>' +
      '<div id="model-progress" class="webodm-progress"></div>'
    );
    $('#cameras_button').html(
      '<label class="webodm-menu-row"><input id="toggle-cameras" type="checkbox"> Show cameras</label>' +
      '<label class="webodm-menu-row">Scale <input id="camera-scale" type="range" min="1" max="12" step="0.5" value="4"></label>'
    );

    document.getElementById('toggle-textured-model').addEventListener('change', toggleTexturedModel);
    document.getElementById('toggle-cameras').addEventListener('change', toggleCameras);
    document.getElementById('camera-scale').addEventListener('input', function (event) {
      cameraObjects.forEach(function (camera) { camera.scale.setScalar(Number(event.target.value)); });
    });
  }

  viewer.loadGUI(setupSidebar);

  Potree.loadPointCloud('./assets/entwine_pointcloud/ept.json', 'Point Cloud', function (event) {
    if (event.type === 'loading_failed') {
      loadingText.textContent = 'The point cloud could not be loaded.';
      return;
    }
    pointcloud = event.pointcloud;
    pointcloud.material.size = 1;
    viewer.scene.addPointCloud(pointcloud);
    viewer.fitToScreen();
    viewer.setLengthUnitAndDisplayUnit('m', 'm');
    loading.classList.add('hidden');
  });

  function setPointCloudVisible(visible) {
    viewer.setEDLEnabled(true);
    viewer.setEDLOpacity(visible ? 1 : 0);
    if (window.innerWidth <= 600 && pointcloud) pointcloud.visible = visible;
  }

  function loadTexturedModel(callback) {
    if (texturedModel) return callback(texturedModel);
    if (modelLoading) return;
    modelLoading = true;
    const progress = document.getElementById('model-progress');
    progress.textContent = 'Loading…';
    const loader = new THREE.GLTFLoader();
    const draco = new THREE.DRACOLoader();
    draco.setDecoderPath('./vendor/draco/');
    loader.setDRACOLoader(draco);
    loader.load('./assets/textured_model.glb', function (gltf) {
      texturedModel = gltf.scene;
      const center = texturedModel.CESIUM_RTC && texturedModel.CESIUM_RTC.center;
      if (center) {
        texturedModel.translateX(center[0]);
        texturedModel.translateY(center[1]);
      }
      viewer.scene.scene.add(texturedModel);
      modelLoading = false;
      progress.textContent = '';
      callback(texturedModel);
    }, function (event) {
      if (event.total) progress.textContent = 'Loading ' + Math.round(event.loaded / event.total * 100) + '%';
    }, function (error) {
      console.error('Textured model load failed', error);
      modelLoading = false;
      progress.textContent = 'Could not load model';
      document.getElementById('toggle-textured-model').checked = false;
    });
  }

  function toggleTexturedModel(event) {
    if (event.target.checked) {
      loadTexturedModel(function (object) {
        object.visible = true;
        setPointCloudVisible(false);
      });
    } else if (texturedModel) {
      texturedModel.visible = false;
      setPointCloudVisible(true);
    }
  }

  function cameraMatrix(translation, rotation, scale) {
    const axis = new THREE.Vector3(-rotation[0], -rotation[1], -rotation[2]);
    const angle = axis.length();
    axis.normalize();
    const matrix = new THREE.Matrix4().makeRotationAxis(axis, angle);
    matrix.setPosition(new THREE.Vector3(translation[0], translation[1], translation[2]));
    matrix.scale(new THREE.Vector3(scale, scale, scale));
    return matrix.transpose();
  }

  function loadCameras(callback) {
    if (cameraObjects.length) return callback();
    Promise.all([
      fetch('./assets/shots.geojson').then(function (response) { return response.json(); }),
      new Promise(function (resolve, reject) {
        new THREE.GLTFLoader().load('./vendor/camera.glb', function (gltf) { resolve(gltf.scene); }, undefined, reject);
      })
    ]).then(function (results) {
      const geojson = results[0];
      cameraTemplate = results[1];
      const scale = Number(document.getElementById('camera-scale').value);
      cameraTemplate.traverse(function (object) {
        if (object.material) {
          object.material = object.material.clone();
          object.material.transparent = true;
          object.material.opacity = 0.7;
        }
      });
      geojson.features.forEach(function (feature) {
        const camera = cameraTemplate.clone(true);
        camera.matrixAutoUpdate = false;
        camera.matrix.set.apply(camera.matrix, cameraMatrix(feature.properties.translation, feature.properties.rotation, scale).elements);
        camera.userData.filename = feature.properties.filename;
        viewer.scene.scene.add(camera);
        cameraObjects.push(camera);
      });
      callback();
    }).catch(function () {
      document.getElementById('toggle-cameras').checked = false;
      notify('Camera positions could not be loaded.');
    });
  }

  function toggleCameras(event) {
    if (event.target.checked) {
      loadCameras(function () { cameraObjects.forEach(function (camera) { camera.visible = true; }); });
    } else {
      cameraObjects.forEach(function (camera) { camera.visible = false; });
    }
  }

  document.getElementById('unit-selector').addEventListener('change', function (event) {
    if (event.target.value === 'metric') viewer.setLengthUnitAndDisplayUnit('m', 'm');
    else if (event.target.value === 'imperial') viewer.setLengthUnitAndDisplayUnit('m', 'ft');
    else viewer.setLengthUnitAndDisplayUnit('m', 'ft (US)');
  });

  document.getElementById('snapshot').addEventListener('click', function () {
    viewer.renderer.render(viewer.scene.scene, viewer.scene.getActiveCamera());
    const link = document.createElement('a');
    link.download = 'akcakoyun-3d.png';
    link.href = viewer.renderer.domElement.toDataURL('image/png');
    link.click();
  });

  document.getElementById('share').addEventListener('click', function () {
    const shareData = { title: document.title, url: location.href };
    if (navigator.share) navigator.share(shareData).catch(function () {});
    else navigator.clipboard.writeText(location.href).then(function () { notify('Viewer link copied.'); });
  });

  document.getElementById('show-location').addEventListener('click', function () {
    if (!navigator.geolocation) return notify('Location is not supported by this browser.');
    notify('Waiting for GPS…');
    navigator.geolocation.getCurrentPosition(function (position) {
      const lon = position.coords.longitude;
      const lat = position.coords.latitude;
      const utm = proj4('EPSG:4326', '+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs', [lon, lat]);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(1.2, 18, 18), new THREE.MeshBasicMaterial({ color: 0x31b9ff }));
      marker.position.set(utm[0], utm[1], 310);
      viewer.scene.scene.add(marker);
      viewer.scene.view.position.set(utm[0] + 35, utm[1] - 35, 345);
      viewer.scene.view.lookAt(new THREE.Vector3(utm[0], utm[1], 285));
      notify('Approximate phone location shown in blue · accuracy ±' + Math.round(position.coords.accuracy) + ' m.');
    }, function () { notify('Location permission was not granted or GPS was unavailable.'); }, { enableHighAccuracy: true, timeout: 15000 });
  });
})();
