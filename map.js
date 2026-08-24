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

  const elevationCanvas = document.createElement('canvas');
  let elevationMetadata = null;
  let elevationPixels = null;
  let hillshadePixels = null;
  let elevationActive = null;
  let elevationLoadToken = 0;
  let elevationRenderTimer = null;
  const elevationRanges = {
    dtm: { min: 280.370, max: 284.936 },
    dsm: { min: 281.165, max: 297.314 }
  };
  const elevationStyle = { color: 'viridis', shading: 'normal' };
  const elevationControls = document.getElementById('elevation-controls');
  const elevationStatus = document.getElementById('elevation-status');
  const histogramCanvas = document.getElementById('elevation-histogram');

  const elevationSource = new ol.source.ImageCanvas({
    projection: 'EPSG:3857',
    ratio: 1,
    canvasFunction: function (extent, resolution, pixelRatio, size) {
      const canvas = document.createElement('canvas');
      canvas.width = size[0];
      canvas.height = size[1];
      if (!elevationCanvas.width) return canvas;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      const x = (surveyExtent[0] - extent[0]) / resolution * pixelRatio;
      const y = (extent[3] - surveyExtent[3]) / resolution * pixelRatio;
      const width = (surveyExtent[2] - surveyExtent[0]) / resolution * pixelRatio;
      const height = (surveyExtent[3] - surveyExtent[1]) / resolution * pixelRatio;
      context.drawImage(elevationCanvas, x, y, width, height);
      return canvas;
    }
  });
  const elevationLayer = new ol.layer.Image({ visible: false, opacity: 1, extent: surveyExtent, source: elevationSource });

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
    'plant-health': xyz('plant-health', false, 0.85),
    dtm: elevationLayer,
    dsm: elevationLayer
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
    layers: [layers.satellite, layers.osm, layers.orthophoto, layers['plant-health'], elevationLayer, layers.contours, layers.cameras, importedLayer, sketchLayer, locationLayer],
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

  const palettes = {
    viridis: [[0, 68, 1, 84], [.25, 59, 82, 139], [.5, 33, 145, 140], [.75, 94, 201, 98], [1, 253, 231, 37]],
    jet: [[0, 0, 0, 128], [.2, 0, 80, 255], [.4, 0, 220, 220], [.6, 220, 255, 30], [.8, 255, 100, 0], [1, 128, 0, 0]],
    terrain: [[0, 52, 107, 130], [.25, 78, 153, 115], [.5, 176, 176, 106], [.75, 166, 126, 86], [1, 255, 255, 255]],
    earth: [[0, 35, 72, 60], [.3, 90, 128, 78], [.58, 163, 146, 91], [.8, 129, 95, 68], [1, 238, 228, 198]],
    pastel: [[0, 122, 171, 216], [.25, 165, 218, 202], [.5, 255, 238, 157], [.75, 244, 174, 126], [1, 207, 121, 161]]
  };

  function colorLut(name) {
    const stops = palettes[name] || palettes.viridis;
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i += 1) {
      const t = i / 255;
      let right = 1;
      while (right < stops.length - 1 && t > stops[right][0]) right += 1;
      const left = stops[right - 1];
      const next = stops[right];
      const mix = (t - left[0]) / (next[0] - left[0]);
      for (let channel = 0; channel < 3; channel += 1) lut[i * 3 + channel] = Math.round(left[channel + 1] + (next[channel + 1] - left[channel + 1]) * mix);
    }
    return lut;
  }

  function rgbToHs(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (!delta) return [0, 0];
    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return [((hue / 6) + 1) % 1, delta / max];
  }

  function shadedLut(lut) {
    const table = new Uint8Array(256 * 256 * 3);
    for (let color = 0; color < 256; color += 1) {
      const hs = rgbToHs(lut[color * 3], lut[color * 3 + 1], lut[color * 3 + 2]);
      const h6 = hs[0] * 6;
      const sector = Math.floor(h6) % 6;
      const f = h6 - Math.floor(h6);
      for (let value = 0; value < 256; value += 1) {
        const p = value * (1 - hs[1]);
        const q = value * (1 - hs[1] * f);
        const t = value * (1 - hs[1] * (1 - f));
        const rgb = sector === 0 ? [value, t, p] : sector === 1 ? [q, value, p] : sector === 2 ? [p, value, t] : sector === 3 ? [p, q, value] : sector === 4 ? [t, p, value] : [value, p, q];
        const index = (color * 256 + value) * 3;
        table[index] = rgb[0]; table[index + 1] = rgb[1]; table[index + 2] = rgb[2];
      }
    }
    return table;
  }

  function decodePixels(image) {
    return new Promise(function (resolve) {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        if (image.close) image.close();
        resolve({ width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data });
    });
  }

  function loadPixels(url, attempt) {
    attempt = attempt || 0;
    const separator = url.indexOf('?') === -1 ? '?' : '&';
    const requestUrl = attempt ? url + separator + 'retry=' + attempt : url;
    return fetch(requestUrl, { cache: attempt ? 'reload' : 'default' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.blob();
    }).then(function (blob) {
      if (window.createImageBitmap) return createImageBitmap(blob).then(decodePixels);
      return new Promise(function (resolve, reject) {
        const image = new Image();
        const objectUrl = URL.createObjectURL(blob);
        image.onload = function () { URL.revokeObjectURL(objectUrl); decodePixels(image).then(resolve); };
        image.onerror = function () { URL.revokeObjectURL(objectUrl); reject(new Error('Image decode failed')); };
        image.src = objectUrl;
      });
    }).catch(function (error) {
      if (attempt >= 2) throw error;
      elevationStatus.textContent = 'Connection interrupted; retrying elevation data…';
      return new Promise(function (resolve) { window.setTimeout(resolve, 800 * (attempt + 1)); }).then(function () { return loadPixels(url, attempt + 1); });
    });
  }

  function renderElevation() {
    if (!elevationPixels || !elevationActive || !elevationMetadata) return;
    window.clearTimeout(elevationRenderTimer);
    elevationStatus.textContent = 'Rendering full-resolution ' + elevationActive.toUpperCase() + '…';
    elevationRenderTimer = window.setTimeout(function () {
      const meta = elevationMetadata[elevationActive];
      const range = elevationRanges[elevationActive];
      const input = elevationPixels.pixels;
      const shade = hillshadePixels && elevationStyle.shading !== 'none' ? hillshadePixels.pixels : null;
      const lut = colorLut(elevationStyle.color);
      const shadeTable = shade ? shadedLut(lut) : null;
      elevationCanvas.width = elevationPixels.width;
      elevationCanvas.height = elevationPixels.height;
      const context = elevationCanvas.getContext('2d');
      const output = context.createImageData(elevationCanvas.width, elevationCanvas.height);
      const span = Math.max(.001, range.max - range.min);
      for (let p = 0; p < input.length; p += 4) {
        if (!input[p + 3]) continue;
        const value = meta.offset + (input[p] * 256 + input[p + 1]) * meta.scale;
        const color = Math.max(0, Math.min(255, Math.round((value - range.min) / span * 255)));
        let source = color * 3;
        if (shadeTable) source = (color * 256 + shade[p]) * 3;
        const table = shadeTable || lut;
        output.data[p] = table[source];
        output.data[p + 1] = table[source + 1];
        output.data[p + 2] = table[source + 2];
        output.data[p + 3] = 238;
      }
      context.putImageData(output, 0, 0);
      elevationSource.changed();
      elevationStatus.textContent = meta.width.toLocaleString() + ' × ' + meta.height.toLocaleString() + ' · full-resolution elevation';
    }, 30);
  }

  function updateRangeUi() {
    if (!elevationActive || !elevationMetadata) return;
    const meta = elevationMetadata[elevationActive];
    const range = elevationRanges[elevationActive];
    document.getElementById('elevation-min').value = range.min.toFixed(3);
    document.getElementById('elevation-max').value = range.max.toFixed(3);
    document.getElementById('elevation-global-min').textContent = Math.floor(meta.min) + ' m';
    document.getElementById('elevation-global-max').textContent = Math.ceil(meta.max) + ' m';
    drawHistogram();
  }

  function drawHistogram() {
    if (!elevationActive || !elevationMetadata) return;
    const meta = elevationMetadata[elevationActive];
    const range = elevationRanges[elevationActive];
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(220, histogramCanvas.clientWidth || 272);
    const height = 104;
    histogramCanvas.width = Math.round(width * ratio);
    histogramCanvas.height = Math.round(height * ratio);
    const context = histogramCanvas.getContext('2d');
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const lut = colorLut(elevationStyle.color);
    const maxCount = Math.max.apply(null, meta.histogram);
    for (let i = 0; i < meta.histogram.length; i += 1) {
      const barHeight = Math.log1p(meta.histogram[i]) / Math.log1p(maxCount) * 83;
      context.fillStyle = 'rgb(' + lut[i * 3] + ',' + lut[i * 3 + 1] + ',' + lut[i * 3 + 2] + ')';
      context.fillRect(i / meta.histogram.length * width, 91 - barHeight, Math.ceil(width / meta.histogram.length) + 1, barHeight);
    }
    ['min', 'max'].forEach(function (key) {
      const x = (range[key] - meta.min) / (meta.max - meta.min) * width;
      context.fillStyle = '#87959b';
      context.fillRect(Math.max(0, Math.min(width - 4, x - 2)), 0, 4, 96);
    });
  }

  function loadElevation(name) {
    const token = ++elevationLoadToken;
    elevationActive = name;
    elevationLayer.setVisible(true);
    elevationControls.hidden = false;
    document.getElementById('elevation-title').textContent = name === 'dtm' ? 'Terrain Model' : 'Surface Model';
    elevationStatus.textContent = 'Loading full-resolution elevation…';
    fetch('./assets/map/elevation.json').then(function (response) { return response.json(); }).then(function (metadata) {
      elevationMetadata = metadata;
      updateRangeUi();
      return loadPixels('./assets/map/' + name + '-elevation.png');
    }).then(function (pixels) {
      if (token !== elevationLoadToken) return;
      elevationPixels = pixels;
      hillshadePixels = null;
      renderElevation();
      if (elevationStyle.shading === 'none') return null;
      elevationStatus.textContent = 'Adding ' + elevationStyle.shading + ' relief…';
      return loadPixels('./assets/map/' + name + '-hillshade-' + elevationStyle.shading + '.png').then(function (shade) {
        if (token !== elevationLoadToken) return;
        hillshadePixels = shade;
        renderElevation();
      }).catch(function () {
        if (token === elevationLoadToken) elevationStatus.textContent = 'Color elevation ready · relief unavailable';
      });
    }).catch(function () {
      if (token === elevationLoadToken) elevationStatus.textContent = 'Elevation layer could not be loaded.';
    });
  }

  function reloadHillshade() {
    if (!elevationActive || !elevationPixels) return;
    const token = ++elevationLoadToken;
    if (elevationStyle.shading === 'none') {
      hillshadePixels = null;
      renderElevation();
      return;
    }
    elevationStatus.textContent = 'Loading ' + elevationStyle.shading + ' relief…';
    loadPixels('./assets/map/' + elevationActive + '-hillshade-' + elevationStyle.shading + '.png').then(function (pixels) {
      if (token !== elevationLoadToken) return;
      hillshadePixels = pixels;
      renderElevation();
    });
  }

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
    document.querySelectorAll('[data-map-quick]').forEach(function (button) {
      const name = button.dataset.mapQuick;
      const visible = name === 'dtm' || name === 'dsm' ? elevationLayer.getVisible() && elevationActive === name : layers[name].getVisible();
      button.classList.toggle('active', visible);
    });
  }
  document.querySelectorAll('[data-map-layer]').forEach(function (checkbox) {
    checkbox.addEventListener('change', function () {
      const name = checkbox.dataset.mapLayer;
      if (name === 'dtm' || name === 'dsm') {
        document.querySelector('[data-map-layer="' + (name === 'dtm' ? 'dsm' : 'dtm') + '"]').checked = false;
        if (checkbox.checked) loadElevation(name);
        else {
          elevationLayer.setVisible(false);
          elevationControls.hidden = true;
        }
      } else layers[name].setVisible(checkbox.checked);
      refreshQuickButtons();
    });
  });
  document.querySelectorAll('[data-map-quick]').forEach(function (button) {
    button.addEventListener('click', function () {
      ['orthophoto', 'plant-health', 'dsm', 'dtm'].forEach(function (name) {
        const visible = name === button.dataset.mapQuick;
        if (name !== 'dtm' && name !== 'dsm') layers[name].setVisible(visible);
        const checkbox = document.querySelector('[data-map-layer="' + name + '"]');
        if (checkbox) checkbox.checked = visible;
      });
      if (button.dataset.mapQuick === 'dtm' || button.dataset.mapQuick === 'dsm') loadElevation(button.dataset.mapQuick);
      else {
        elevationLayer.setVisible(false);
        elevationControls.hidden = true;
      }
      refreshQuickButtons();
    });
  });
  refreshQuickButtons();
  document.querySelectorAll('[data-map-tool]').forEach(function (button) {
    button.addEventListener('click', function () { startDrawing(button.dataset.mapTool, button); });
  });
  document.getElementById('map-opacity').addEventListener('input', function (event) {
    ['orthophoto', 'plant-health'].forEach(function (name) { layers[name].setOpacity(Number(event.target.value)); });
    elevationLayer.setOpacity(Number(event.target.value));
  });

  ['min', 'max'].forEach(function (key) {
    document.getElementById('elevation-' + key).addEventListener('change', function (event) {
      if (!elevationActive || !elevationMetadata) return;
      const meta = elevationMetadata[elevationActive];
      const other = key === 'min' ? 'max' : 'min';
      let value = Number(event.target.value);
      value = Math.max(meta.min, Math.min(meta.max, value));
      if (key === 'min') value = Math.min(value, elevationRanges[elevationActive][other] - .001);
      else value = Math.max(value, elevationRanges[elevationActive][other] + .001);
      elevationRanges[elevationActive][key] = value;
      updateRangeUi();
      renderElevation();
    });
  });
  document.getElementById('elevation-color').addEventListener('change', function (event) {
    elevationStyle.color = event.target.value;
    drawHistogram();
    renderElevation();
  });
  document.getElementById('elevation-shading').addEventListener('change', function (event) {
    elevationStyle.shading = event.target.value;
    reloadHillshade();
  });
  let histogramHandle = null;
  function histogramValue(event) {
    const meta = elevationMetadata[elevationActive];
    const bounds = histogramCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    return meta.min + x / bounds.width * (meta.max - meta.min);
  }
  histogramCanvas.addEventListener('pointerdown', function (event) {
    if (!elevationActive || !elevationMetadata) return;
    const value = histogramValue(event);
    const range = elevationRanges[elevationActive];
    histogramHandle = Math.abs(value - range.min) <= Math.abs(value - range.max) ? 'min' : 'max';
    histogramCanvas.setPointerCapture(event.pointerId);
    if (histogramHandle === 'min') range.min = Math.min(value, range.max - .001);
    else range.max = Math.max(value, range.min + .001);
    updateRangeUi();
  });
  histogramCanvas.addEventListener('pointermove', function (event) {
    if (!histogramHandle || !elevationActive) return;
    const range = elevationRanges[elevationActive];
    let value = histogramValue(event);
    if (histogramHandle === 'min') value = Math.min(value, range.max - .001);
    else value = Math.max(value, range.min + .001);
    range[histogramHandle] = value;
    updateRangeUi();
  });
  function finishHistogramDrag() {
    if (!histogramHandle) return;
    histogramHandle = null;
    renderElevation();
  }
  histogramCanvas.addEventListener('pointerup', finishHistogramDrag);
  histogramCanvas.addEventListener('pointercancel', finishHistogramDrag);
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
    if (window.setSurvey3dActive) window.setSurvey3dActive(false);
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
    if (window.setSurvey3dActive) window.setSurvey3dActive(true);
    history.replaceState(null, '', location.pathname);
  }

  document.getElementById('mode-2d').addEventListener('click', showMap);
  document.getElementById('mode-3d').addEventListener('click', show3d);
  if (new URLSearchParams(location.search).get('view') === '2d') showMap();
})();
