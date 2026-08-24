'use strict';

self.onmessage = function (event) {
  try {
    const input = event.data;
    const width = input.width;
    const height = input.height;
    const size = width * height;
    const elevation = new Float32Array(input.elevation);
    const valid = new Uint8Array(input.valid);
    const sourceWeights = input.sourceWeights ? new Float32Array(input.sourceWeights) : null;
    const water = new Float32Array(size);
    const cumulativeInfiltration = new Float32Array(size);
    const outgoing = new Float32Array(size);
    const delta = new Float32Array(size);
    const eastFlux = new Float32Array(size);
    const southFlux = new Float32Array(size);
    const boundaryFlux = new Float32Array(size);
    const totalSeconds = Math.max(1, input.totalMinutes * 60);
    const steps = Math.min(1440, Math.max(120, Math.ceil(totalSeconds / 10)));
    const dt = totalSeconds / steps;
    const snapshotCount = Math.min(61, steps + 1);
    const snapshotScale = .0005;
    const infiltrationSnapshotScale = .0005;
    const snapshots = [];
    const infiltrationSnapshots = [];
    const soil = input.soil;
    const conductivity = soil.conductivity / 1000 / 3600;
    const suctionMoisture = soil.suction * soil.moistureDeficit / 1000;
    const manning = Math.max(.015, input.manning || .05);
    const rainRate = input.mode === 'rain' ? input.rainIntensity / 1000 / 3600 : 0;
    const irrigationRate = input.mode === 'irrigation' ? input.totalFlow / 60000 / input.cellArea : 0;
    let appliedVolume = 0;
    let infiltratedVolume = 0;
    let outflowVolume = 0;
    let nextSnapshot = 0;
    let maxDepth = 0;
    let maxInfiltrationDepth = 0;

    function captureSnapshot() {
      const snapshot = new Uint16Array(size);
      const infiltrationSnapshot = new Uint16Array(size);
      for (let i = 0; i < size; i += 1) {
        if (!valid[i]) continue;
        snapshot[i] = Math.min(65535, Math.round(water[i] / snapshotScale));
        infiltrationSnapshot[i] = Math.min(65535, Math.round(cumulativeInfiltration[i] / infiltrationSnapshotScale));
        maxDepth = Math.max(maxDepth, water[i]);
        maxInfiltrationDepth = Math.max(maxInfiltrationDepth, cumulativeInfiltration[i]);
      }
      snapshots.push(snapshot);
      infiltrationSnapshots.push(infiltrationSnapshot);
    }

    function edgeFlux(first, second, distance) {
      if (!valid[first] || !valid[second]) return 0;
      const firstSurface = elevation[first] + water[first];
      const secondSurface = elevation[second] + water[second];
      const difference = firstSurface - secondSurface;
      if (Math.abs(difference) < 1e-7) return 0;
      const donor = difference > 0 ? first : second;
      const receiver = difference > 0 ? second : first;
      const effectiveDepth = Math.max(0, elevation[donor] + water[donor] - Math.max(elevation[donor], elevation[receiver]));
      if (effectiveDepth <= 1e-7) return 0;
      const slope = Math.min(1, Math.abs(difference) / distance);
      const discharge = Math.pow(effectiveDepth, 5 / 3) * Math.sqrt(slope) / manning;
      const depthTransfer = discharge * dt / distance;
      outgoing[donor] += depthTransfer;
      return difference > 0 ? depthTransfer : -depthTransfer;
    }

    captureSnapshot();
    for (let step = 1; step <= steps; step += 1) {
      for (let i = 0; i < size; i += 1) {
        if (!valid[i]) continue;
        let added = rainRate * dt;
        if (sourceWeights) added += irrigationRate * sourceWeights[i] * dt;
        water[i] += added;
        appliedVolume += added * input.cellArea;
        if (water[i] <= 0) continue;
        const front = Math.max(.00001, cumulativeInfiltration[i]);
        const capacity = conductivity * (1 + suctionMoisture / front);
        const infiltrated = Math.min(water[i], capacity * dt);
        water[i] -= infiltrated;
        cumulativeInfiltration[i] += infiltrated;
        infiltratedVolume += infiltrated * input.cellArea;
      }

      outgoing.fill(0); eastFlux.fill(0); southFlux.fill(0); boundaryFlux.fill(0); delta.fill(0);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (!valid[index]) continue;
          if (x + 1 < width) eastFlux[index] = edgeFlux(index, index + 1, input.cellWidth);
          if (y + 1 < height) southFlux[index] = edgeFlux(index, index + width, input.cellHeight);
          let openWidth = 0;
          if (x === 0 || !valid[index - 1]) openWidth += input.cellHeight;
          if (x === width - 1 || !valid[index + 1]) openWidth += input.cellHeight;
          if (y === 0 || !valid[index - width]) openWidth += input.cellWidth;
          if (y === height - 1 || !valid[index + width]) openWidth += input.cellWidth;
          if (openWidth && water[index] > 0) {
            const discharge = Math.pow(water[index], 5 / 3) * Math.sqrt(.01) / manning;
            boundaryFlux[index] = discharge * dt * openWidth / input.cellArea;
            outgoing[index] += boundaryFlux[index];
          }
        }
      }
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (!valid[index]) continue;
          if (x + 1 < width && eastFlux[index]) {
            const donor = eastFlux[index] > 0 ? index : index + 1;
            const transfer = Math.abs(eastFlux[index]) * Math.min(1, water[donor] * .45 / Math.max(1e-12, outgoing[donor]));
            delta[donor] -= transfer;
            delta[donor === index ? index + 1 : index] += transfer;
          }
          if (y + 1 < height && southFlux[index]) {
            const donor = southFlux[index] > 0 ? index : index + width;
            const transfer = Math.abs(southFlux[index]) * Math.min(1, water[donor] * .45 / Math.max(1e-12, outgoing[donor]));
            delta[donor] -= transfer;
            delta[donor === index ? index + width : index] += transfer;
          }
          if (boundaryFlux[index]) {
            const transfer = boundaryFlux[index] * Math.min(1, water[index] * .45 / Math.max(1e-12, outgoing[index]));
            delta[index] -= transfer;
            outflowVolume += transfer * input.cellArea;
          }
        }
      }
      for (let i = 0; i < size; i += 1) if (valid[i]) water[i] = Math.max(0, water[i] + delta[i]);

      const targetSnapshot = Math.round(step / steps * (snapshotCount - 1));
      if (targetSnapshot > nextSnapshot || step === steps) {
        captureSnapshot();
        nextSnapshot = targetSnapshot;
      }
    }

    let surfaceVolume = 0;
    for (let i = 0; i < size; i += 1) if (valid[i]) surfaceVolume += water[i] * input.cellArea;
    const result = {
      snapshots: snapshots.map(function (snapshot) { return snapshot.buffer; }),
      infiltrationSnapshots: infiltrationSnapshots.map(function (snapshot) { return snapshot.buffer; }),
      snapshotScale: snapshotScale,
      infiltrationSnapshotScale: infiltrationSnapshotScale,
      appliedLiters: appliedVolume * 1000,
      infiltratedLiters: infiltratedVolume * 1000,
      surfaceLiters: surfaceVolume * 1000,
      outflowLiters: outflowVolume * 1000,
      maxDepth: maxDepth,
      maxInfiltrationDepth: maxInfiltrationDepth,
      steps: steps
    };
    self.postMessage(result, result.snapshots.concat(result.infiltrationSnapshots));
  } catch (error) {
    self.postMessage({ error: error && error.message ? error.message : String(error) });
  }
};
