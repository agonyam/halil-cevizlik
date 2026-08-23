(function () {
  'use strict';

  const surveyExtent4326 = [27.1369278057887, 39.798648554838, 27.138907571646, 39.8003184784371];
  const surveyExtent = ol.proj.transformExtent(surveyExtent4326, 'EPSG:4326', 'EPSG:3857');
  const utm35 = '+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs';
  const mapViewElement = document.getElementById('map-view');
  const coordinateReadout = document.getElementById('map-coordinates');

  function xyz(name, visible, opacity) {
    return new ol.layer.Tile({
      visible: visible,
      opacity: opacity,
      extent: surveyExtent,
      source: new ol.source.XYZ({
        url: './assets/map/' + name + '/{z}/{x}/{y}.png',
        minZoom: 15,
        maxZoom: 22,
        wrapX: false
      })
    });
  }

  const layers = {
    satellite: new ol.layer.Tile({
      visible: true,
      source: new ol.source.XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: 'Tiles © Esri',
        crossOrigin: 'anonymous',
        maxZoom: 18
      })
    }),
    osm: new ol.layer.Tile({ visible: false, source: new ol.source.OSM() }),
    orthophoto: xyz('orthophoto', true, 1),
    hillshade: xyz('hillshade', false, 0.7),
    'plant-health': xyz('plant-health', false, 0.85),
    dtm: xyz('dtm', false, 0.8),
    dsm: xyz('dsm', false, 0.8)
  };

  const sketchSource = new ol.source.Vector();
  const locationSource = new ol.source.Vector();
  const camerasSource = new ol.source.Vector();
  const contoursSource = new ol.source.Vector();
  const importedSource = new ol.source.Vector();
  const sketchLayer = new ol.layer.Vector({
    source: sketchSource,
    style: new ol.style.Style({
      fill: new ol.style.Fill({ color: 'rgba(65, 191, 231, .22)' }),
      stroke: new ol.style.Stroke({ color: '#20b9e8', width: 3 }),
      image: new ol.style.Circle({ radius: 5, fill: new ol.style.Fill({ color: '#20b9e8' }), stroke: new ol.style.Stroke({ color: '#fff', width: 1 }) })
    })
  });
  const locationLayer = new ol.layer.Vector({
    source: locationSource,
    style: new ol.style.Style({
      image: new ol.style.Circle({ radius: 8, fill: new ol.style.Fill({ color: '#168fff' }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 }) })
    })
  });
  layers.cameras = new ol.layer.Vector({
    visible: false,
    source: camerasSource,
    style: new ol.style.Style({ image: new ol.style.Circle({ radius: 3, fill: new ol.style.Fill({ color: '#ffd331' }), stroke: new ol.style.Stroke({ color: '#1b2528', width: 1 }) }) })
  });
  layers.contours = new ol.layer.Vector({
    visible: false,
    source: contoursSource,
    style: function (feature) {
      return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: '#21292b', width: Math.round(feature.get('elevation')) % 5 === 0 ? 2 : 1 }),
        text: new ol.style.Text({ text: String(Math.round(feature.get('elevation'))) + ' m', font: '10px Arial', fill: new ol.style.Fill({ color: '#111' }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 }) })
      });
    }
  });
  const importedLayer = new ol.layer.Vector({
    source: importedSource,
    style: new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(255, 100, 25, .2)' }), stroke: new ol.style.Stroke({ color: '#ff6419', width: 3 }), image: new ol.style.Circle({ radius: 5, fill: new ol.style.Fill({ color: '#ff6419' }) }) })
  });

  const map = new ol.Map({
    target: 'map',
    layers: [layers.satellite, layers.osm, layers.orthophoto, layers.hillshade, layers['plant-health'], layers.dtm, layers.dsm, layers.contours, layers.cameras, importedLayer, sketchLayer, locationLayer],
    controls: ol.control.defaults().extend([new ol.control.ScaleLine()]),
    view: new ol.View({ center: ol.extent.getCenter(surveyExtent), zoom: 19, minZoom: 14, maxZoom: 23 })
  });
  map.getView().fit(surveyExtent, map.getSize(), { padding: [55, 335, 55, 55], maxZoom: 21 });

  fetch('./assets/shots.geojson').then(function (response) { return response.json(); }).then(function (geojson) {
    camerasSource.addFeatures(new ol.format.GeoJSON().readFeatures(geojson, { featureProjection: 'EPSG:3857' }));
  });
  fetch('./assets/map/contours-wgs84.geojson').then(function (response) { return response.json(); }).then(function (geojson) {
    contoursSource.addFeatures(new ol.format.GeoJSON().readFeatures(geojson, { featureProjection: 'EPSG:3857' }));
  });

  let draw = null;
  const resultOverlays = [];

  function toUtm(coordinate) {
    return proj4('EPSG:4326', utm35, ol.proj.transform(coordinate, 'EPSG:3857', 'EPSG:4326'));
  }

  function formatDistance(coordinates) {
    let distance = 0;
    for (let i = 1; i < coordinates.length; i += 1) {
      const a = toUtm(coordinates[i - 1]);
      const b = toUtm(coordinates[i]);
      distance += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return distance >= 1000 ? (distance / 1000).toFixed(2) + ' km' : distance.toFixed(2) + ' m';
  }

  function formatArea(coordinates) {
    const ring = coordinates[0].map(toUtm);
    let area = 0;
    for (let i = 0; i < ring.length - 1; i += 1) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    area = Math.abs(area / 2);
    return area >= 10000 ? (area / 10000).toFixed(3) + ' ha' : area.toFixed(2) + ' m²';
  }

  function addLabel(position, text, className) {
    const element = document.createElement('div');
    element.className = className || 'map-measure-label';
    element.textContent = text;
    const overlay = new ol.Overlay({ element: element, position: position, positioning: 'bottom-center', offset: [0, -9], stopEvent: false });
    map.addOverlay(overlay);
    resultOverlays.push(overlay);
  }

  function stopDrawing() {
    if (draw) map.removeInteraction(draw);
    draw = null;
    document.querySelectorAll('[data-map-tool]').forEach(function (button) { button.classList.remove('active'); });
  }

  function startDrawing(tool, button) {
    stopDrawing();
    if (tool === 'clear') {
      sketchSource.clear();
      resultOverlays.splice(0).forEach(function (overlay) { map.removeOverlay(overlay); });
      return;
    }
    const type = tool === 'distance' ? 'LineString' : tool === 'area' ? 'Polygon' : 'Point';
    button.classList.add('active');
    draw = new ol.interaction.Draw({ source: sketchSource, type: type });
    map.addInteraction(draw);
    draw.on('drawend', function (event) {
      const geometry = event.feature.getGeometry();
      if (tool === 'distance') addLabel(geometry.getLastCoordinate(), formatDistance(geometry.getCoordinates()));
      if (tool === 'area') addLabel(geometry.getInteriorPoint().getCoordinates(), formatArea(geometry.getCoordinates()));
      if (tool === 'marker') {
        const label = window.prompt('Annotation label', 'Point of interest');
        if (label) addLabel(geometry.getCoordinates(), label, 'map-marker-label');
      }
    });
  }

  function refreshQuickButtons() {
    document.querySelectorAll('[data-map-quick]').forEach(function (button) { button.classList.toggle('active', layers[button.dataset.mapQuick].getVisible()); });
  }
  document.querySelectorAll('[data-map-layer]').forEach(function (checkbox) {
    checkbox.addEventListener('change', function () {
      layers[checkbox.dataset.mapLayer].setVisible(checkbox.checked);
      refreshQuickButtons();
    });
  });
  document.querySelectorAll('[data-map-quick]').forEach(function (button) {
    button.addEventListener('click', function () {
      ['orthophoto', 'plant-health', 'dsm', 'dtm'].forEach(function (name) {
        const visible = name === button.dataset.mapQuick;
        layers[name].setVisible(visible);
        const checkbox = document.querySelector('[data-map-layer="' + name + '"]');
        if (checkbox) checkbox.checked = visible;
      });
      refreshQuickButtons();
    });
  });
  refreshQuickButtons();
  document.querySelectorAll('[data-map-tool]').forEach(function (button) {
    button.addEventListener('click', function () { startDrawing(button.dataset.mapTool, button); });
  });
  document.getElementById('map-opacity').addEventListener('input', function (event) {
    ['orthophoto', 'plant-health', 'dtm', 'dsm', 'hillshade'].forEach(function (name) { layers[name].setOpacity(Number(event.target.value)); });
  });
  document.getElementById('map-fit').addEventListener('click', function () {
    map.getView().fit(surveyExtent, map.getSize(), { padding: [55, 335, 55, 55], maxZoom: 21 });
  });
  document.getElementById('map-fullscreen').addEventListener('click', function () {
    if (!document.fullscreenElement) mapViewElement.requestFullscreen();
    else document.exitFullscreen();
  });
  document.getElementById('map-location').addEventListener('click', function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (position) {
      const coordinate = ol.proj.fromLonLat([position.coords.longitude, position.coords.latitude]);
      locationSource.clear();
      locationSource.addFeature(new ol.Feature(new ol.geom.Point(coordinate)));
      map.getView().setCenter(coordinate);
      map.getView().setZoom(20);
    });
  });
  map.on('pointermove', function (event) {
    const lonLat = ol.proj.toLonLat(event.coordinate);
    const utm = toUtm(event.coordinate);
    coordinateReadout.textContent = lonLat[1].toFixed(6) + ', ' + lonLat[0].toFixed(6) + ' · E ' + utm[0].toFixed(1) + ' N ' + utm[1].toFixed(1);
  });
  document.getElementById('map-geojson').addEventListener('change', function (event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        importedSource.clear();
        importedSource.addFeatures(new ol.format.GeoJSON().readFeatures(JSON.parse(reader.result), { featureProjection: 'EPSG:3857' }));
        map.getView().fit(importedSource.getExtent(), map.getSize(), { padding: [55, 335, 55, 55] });
      } catch (error) {
        window.alert('This GeoJSON file could not be read.');
      }
    };
    reader.readAsText(file);
  });
  document.getElementById('map-share').addEventListener('click', function () {
    const url = location.origin + location.pathname + '?view=2d';
    if (navigator.share) navigator.share({ title: document.title, url: url }).catch(function () {});
    else navigator.clipboard.writeText(url);
  });

  function showMap() {
    document.querySelector('.model-view').classList.add('map-active');
    mapViewElement.hidden = false;
    history.replaceState(null, '', location.pathname + '?view=2d');
    setTimeout(function () {
      map.updateSize();
      map.getView().fit(surveyExtent, map.getSize(), { padding: [55, 335, 55, 55], maxZoom: 21 });
    }, 0);
  }
  function show3d() {
    stopDrawing();
    mapViewElement.hidden = true;
    document.querySelector('.model-view').classList.remove('map-active');
    history.replaceState(null, '', location.pathname);
  }

  document.getElementById('mode-2d').addEventListener('click', showMap);
  document.getElementById('mode-3d').addEventListener('click', show3d);
  if (new URLSearchParams(location.search).get('view') === '2d') showMap();
})();
