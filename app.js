const imageInput = document.getElementById("imageInput");
const imageInfo = document.getElementById("imageInfo");
const knownLengthInput = document.getElementById("knownLength");
const knownUnitInput = document.getElementById("knownUnit");
const startCalibrationBtn = document.getElementById("startCalibration");
const startMeasureBtn = document.getElementById("startMeasure");
const clearPointsBtn = document.getElementById("clearPoints");
const finishAreaBtn = document.getElementById("finishArea");
const twoPointModeInput = document.getElementById("twoPointMode");
const areaModeInput = document.getElementById("areaMode");
const calibrationStatus = document.getElementById("calibrationStatus");
const measureStatus = document.getElementById("measureStatus");
const modeBadge = document.getElementById("modeBadge");
const zoomControls = document.getElementById("zoomControls");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomPercent = document.getElementById("zoomPercent");
const mobileScrollWrap = document.getElementById("mobileScrollWrap");
const mobileScrollRange = document.getElementById("mobileScrollRange");
const hintBar = document.getElementById("hintBar");
const resultsList = document.getElementById("resultsList");
const clearResultsBtn = document.getElementById("clearResults");

const canvas = document.getElementById("measureCanvas");
const ctx = canvas.getContext("2d");

const state = {
  image: null,
  imageRect: null,
  mode: "idle",
  calibrationPoints: [],
  measurePoints: [],
  savedAreas: [],
  selectedSavedAreaIndex: null,
  draggingCalibrationIndex: null,
  draggingMeasureIndex: null,
  draggingPointerId: null,
  pointerCanvas: null,
  scaleRealPerPixel: null,
  unit: "cm",
  sequence: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  maxPanY: 0,
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;

function setMode(mode) {
  state.mode = mode;
  modeBadge.textContent = mode[0].toUpperCase() + mode.slice(1);
}

function setHint(text) {
  hintBar.textContent = text;
}

function setupCanvasSize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function updateImageDependentUi() {
  const hasImage = Boolean(state.image);
  const showMobileScroll = hasImage && state.zoom > 1 && state.maxPanY > 0;
  zoomControls.hidden = !hasImage;
  mobileScrollWrap.hidden = !showMobileScroll;
}

function syncMobileScrollUi() {
  const canScroll = state.zoom > 1 && state.maxPanY > 0;
  mobileScrollWrap.hidden = !state.image || !canScroll;
  mobileScrollRange.disabled = !canScroll;

  if (!canScroll) {
    mobileScrollRange.min = "0";
    mobileScrollRange.max = "0";
    mobileScrollRange.value = "0";
    return;
  }

  mobileScrollRange.min = String(-state.maxPanY);
  mobileScrollRange.max = String(state.maxPanY);
  mobileScrollRange.value = String(state.panY);
}

function syncZoomPercentUi() {
  zoomPercent.textContent = `${Math.round(state.zoom * 100)}%`;
}

function updateImageRect() {
  if (!state.image) {
    state.imageRect = null;
    return;
  }

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const iw = state.image.width;
  const ih = state.image.height;

  const scale = Math.min(cw / iw, ch / ih);
  const drawW = iw * scale * state.zoom;
  const drawH = ih * scale * state.zoom;

  if (state.zoom <= 1) {
    state.panX = 0;
    state.panY = 0;
  }

  const maxPanX = Math.max(0, (drawW - cw) / 2);
  const maxPanY = Math.max(0, (drawH - ch) / 2);
  state.maxPanY = maxPanY;
  state.panX = Math.min(maxPanX, Math.max(-maxPanX, state.panX));
  state.panY = Math.min(maxPanY, Math.max(-maxPanY, state.panY));

  const x = (cw - drawW) / 2 + state.panX;
  const y = (ch - drawH) / 2 + state.panY;
  state.imageRect = { x, y, w: drawW, h: drawH };
}

function canvasPointToImagePoint(canvasX, canvasY) {
  if (!state.imageRect || !state.image) {
    return null;
  }
  const { x, y, w, h } = state.imageRect;
  if (canvasX < x || canvasY < y || canvasX > x + w || canvasY > y + h) {
    return null;
  }

  const nx = (canvasX - x) / w;
  const ny = (canvasY - y) / h;
  return {
    x: nx * state.image.width,
    y: ny * state.image.height,
  };
}

function canvasPointToImagePointClamped(canvasX, canvasY) {
  if (!state.imageRect || !state.image) {
    return null;
  }

  const { x, y, w, h } = state.imageRect;
  const clampedX = Math.min(x + w, Math.max(x, canvasX));
  const clampedY = Math.min(y + h, Math.max(y, canvasY));
  const nx = (clampedX - x) / w;
  const ny = (clampedY - y) / h;
  return {
    x: nx * state.image.width,
    y: ny * state.image.height,
  };
}

function imagePointToCanvasPoint(pt) {
  const { x, y, w, h } = state.imageRect;
  return {
    x: x + (pt.x / state.image.width) * w,
    y: y + (pt.y / state.image.height) * h,
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function lineAngleDegrees(a, b) {
  const radians = Math.atan2(b.y - a.y, b.x - a.x);
  let degrees = (radians * 180) / Math.PI;
  if (degrees < 0) {
    degrees += 360;
  }
  return degrees;
}

function formatLineAngle(a, b) {
  return `${lineAngleDegrees(a, b).toFixed(1)} deg`;
}

function isAxisAlignedAngle(a, b) {
  const angle = lineAngleDegrees(a, b);
  return Number.isInteger(angle) && angle % 90 === 0;
}

function angleAwareLabelColor(a, b, defaultColor) {
  return isAxisAlignedAngle(a, b) ? "#9bff9f" : defaultColor;
}

function hasValidKnownLength() {
  const knownLength = Number(knownLengthInput.value);
  return Number.isFinite(knownLength) && knownLength > 0;
}

function hasValidUnit() {
  const unit = knownUnitInput.value.trim();
  return Boolean(unit);
}

function formatRealDistance(px) {
  if (!state.scaleRealPerPixel) {
    return "n/a";
  }
  const real = px * state.scaleRealPerPixel;
  return `${real.toFixed(2)} ${state.unit}`;
}

function formatRealArea(pxArea) {
  if (!state.scaleRealPerPixel) {
    return "n/a";
  }
  const realArea = pxArea * state.scaleRealPerPixel * state.scaleRealPerPixel;
  return `${realArea.toFixed(2)} ${state.unit}^2`;
}

function isTwoPointModeEnabled() {
  return Boolean(twoPointModeInput?.checked);
}

function isAreaModeEnabled() {
  return Boolean(areaModeInput?.checked);
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return 0;
  }

  let twiceSignedArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    twiceSignedArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(twiceSignedArea) / 2;
}

function polygonLabelPoint(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { x: 0, y: 0 };
  }

  const total = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function clonePoints(points) {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function getSelectedSavedArea() {
  const { selectedSavedAreaIndex, savedAreas } = state;
  if (selectedSavedAreaIndex === null) {
    return null;
  }

  if (selectedSavedAreaIndex < 0 || selectedSavedAreaIndex >= savedAreas.length) {
    return null;
  }

  return savedAreas[selectedSavedAreaIndex];
}

function updateFinishAreaButtonState() {
  const canUseAreaButton = Boolean(state.scaleRealPerPixel) && isAreaModeEnabled();
  finishAreaBtn.hidden = !canUseAreaButton;
  finishAreaBtn.disabled = !(canUseAreaButton && state.mode === "measure" && state.measurePoints.length >= 3);
}

function drawPoint(point, fill) {
  const c = imagePointToCanvasPoint(point);
  ctx.beginPath();
  ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

function drawLine(a, b, color = "#33d2b3") {
  const ca = imagePointToCanvasPoint(a);
  const cb = imagePointToCanvasPoint(b);
  ctx.beginPath();
  ctx.moveTo(ca.x, ca.y);
  ctx.lineTo(cb.x, cb.y);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawPolygonFill(points, fill = "rgba(34, 216, 255, 0.22)") {
  if (!Array.isArray(points) || points.length < 3) {
    return;
  }

  const first = imagePointToCanvasPoint(points[0]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  for (let i = 1; i < points.length; i += 1) {
    const p = imagePointToCanvasPoint(points[i]);
    ctx.lineTo(p.x, p.y);
  }

  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawLabel(mid, text, color = "#ffffff") {
  const p = imagePointToCanvasPoint(mid);
  ctx.font = "13px 'IBM Plex Mono', monospace";
  const width = ctx.measureText(text).width;
  const padX = 8;
  const padY = 5;
  const boxX = p.x - width / 2 - padX;
  const boxY = p.y - 14;
  ctx.fillStyle = "rgba(9, 23, 20, 0.82)";
  ctx.fillRect(boxX, boxY, width + padX * 2, 20);
  ctx.fillStyle = color;
  ctx.fillText(text, boxX + padX, boxY + 14);
}

function drawBlockingOverlay(text) {
  if (!state.imageRect) {
    return;
  }

  const { x, y, w, h } = state.imageRect;
  ctx.fillStyle = "rgba(8, 11, 20, 0.48)";
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 18px 'Space Grotesk', sans-serif";
  const textWidth = ctx.measureText(text).width;
  const centerX = x + w / 2 - textWidth / 2;
  const centerY = y + h / 2;
  ctx.fillText(text, centerX, centerY);
}

function findNearestMeasurePointIndex(canvasPoint, radius = 12) {
  if (!state.imageRect || state.measurePoints.length === 0) {
    return -1;
  }

  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < state.measurePoints.length; i += 1) {
    const pointCanvas = imagePointToCanvasPoint(state.measurePoints[i]);
    const d = Math.hypot(pointCanvas.x - canvasPoint.x, pointCanvas.y - canvasPoint.y);
    if (d <= radius && d < nearestDistance) {
      nearestDistance = d;
      nearestIndex = i;
    }
  }

  return nearestIndex;
}

function findNearestCalibrationPointIndex(canvasPoint, radius = 12) {
  if (!state.imageRect || state.calibrationPoints.length === 0) {
    return -1;
  }

  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < state.calibrationPoints.length; i += 1) {
    const pointCanvas = imagePointToCanvasPoint(state.calibrationPoints[i]);
    const d = Math.hypot(pointCanvas.x - canvasPoint.x, pointCanvas.y - canvasPoint.y);
    if (d <= radius && d < nearestDistance) {
      nearestDistance = d;
      nearestIndex = i;
    }
  }

  return nearestIndex;
}

function refreshMeasureResults() {
  resultsList.innerHTML = "";
  let segmentIndex = 0;

  if (isAreaModeEnabled()) {
    for (let i = 0; i < state.savedAreas.length; i += 1) {
      const savedArea = state.savedAreas[i];
      const li = document.createElement("li");
      li.textContent = `#${i + 1}: Area ${formatRealArea(polygonArea(savedArea.points))}`;
      li.dataset.savedAreaIndex = String(i);
      li.classList.add("result-item", "area-result");
      if (state.selectedSavedAreaIndex === i) {
        li.classList.add("active");
      }
      resultsList.prepend(li);
      segmentIndex += 1;
    }

    if (state.measurePoints.length >= 3) {
      const li = document.createElement("li");
      li.textContent = `Draft: Area ${formatRealArea(polygonArea(state.measurePoints))}`;
      li.classList.add("result-item", "draft-result");
      resultsList.prepend(li);
    }
  } else if (isTwoPointModeEnabled()) {
    for (let i = 1; i < state.measurePoints.length; i += 2) {
      const a = state.measurePoints[i - 1];
      const b = state.measurePoints[i];
      const px = distance(a, b);
      segmentIndex += 1;
      const li = document.createElement("li");
      li.textContent = `#${segmentIndex}: ${formatRealDistance(px)}`;
      resultsList.prepend(li);
    }
  } else {
    for (let i = 1; i < state.measurePoints.length; i += 1) {
      const a = state.measurePoints[i - 1];
      const b = state.measurePoints[i];
      const px = distance(a, b);
      segmentIndex += 1;
      const li = document.createElement("li");
      li.textContent = `#${segmentIndex}: ${formatRealDistance(px)}`;
      resultsList.prepend(li);
    }
  }

  state.sequence = segmentIndex;
  updateFinishAreaButtonState();
}

function recalculateCalibrationFromPoints() {
  if (state.calibrationPoints.length < 2) {
    return;
  }

  const knownLength = Number(knownLengthInput.value);
  if (!Number.isFinite(knownLength) || knownLength <= 0) {
    calibrationStatus.textContent = "Enter a valid known length first.";
    return;
  }

  const a = state.calibrationPoints[0];
  const b = state.calibrationPoints[1];
  const px = distance(a, b);
  if (px <= 0) {
    calibrationStatus.textContent = "Calibration points are too close.";
    return;
  }

  state.unit = knownUnitInput.value.trim() || state.unit;
  state.scaleRealPerPixel = knownLength / px;
  calibrationStatus.textContent = `Calibrated: 1 px = ${state.scaleRealPerPixel.toFixed(6)} ${state.unit}`;
}

function clearActiveDrag() {
  state.draggingCalibrationIndex = null;
  state.draggingMeasureIndex = null;
  state.draggingPointerId = null;
}

function resetCalibration() {
  state.calibrationPoints = [];
  state.scaleRealPerPixel = null;
  state.measurePoints = [];
  state.savedAreas = [];
  state.selectedSavedAreaIndex = null;
  clearActiveDrag();
  refreshMeasureResults();
  setMode("idle");
  startMeasureBtn.disabled = true;
  clearPointsBtn.disabled = true;
  calibrationStatus.textContent = "Calibration reset. Enter known length, then click 2 points on the image.";
  measureStatus.textContent = "Calibration required before measuring.";
  setHint("Click two points on the image to calibrate.");
  redraw();
}

function redraw() {
  setupCanvasSize();

  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  if (!state.image) {
    syncMobileScrollUi();
    updateFinishAreaButtonState();
    return;
  }

  updateImageRect();
  const { x, y, w, h } = state.imageRect;
  ctx.drawImage(state.image, x, y, w, h);

  const pointerPoint = state.pointerCanvas
    ? canvasPointToImagePoint(state.pointerCanvas.x, state.pointerCanvas.y)
    : null;
  const isHoveringImage = Boolean(pointerPoint);

  if (state.calibrationPoints.length > 0) {
    drawPoint(state.calibrationPoints[0], "#ff7f4a");
  }
  if (state.calibrationPoints.length > 1) {
    drawPoint(state.calibrationPoints[1], "#ff7f4a");
    drawLine(state.calibrationPoints[0], state.calibrationPoints[1], "#ff7f4a");
    const a = state.calibrationPoints[0];
    const b = state.calibrationPoints[1];
    drawLabel(
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      `Calib: ${formatRealDistance(distance(a, b))} | ${formatLineAngle(a, b)}`,
      angleAwareLabelColor(a, b, "#ffd6c7")
    );
  }

  if (state.mode === "calibration" && state.calibrationPoints.length === 1 && pointerPoint) {
    const a = state.calibrationPoints[0];
    drawLine(a, pointerPoint, "rgba(255, 127, 74, 0.8)");
    drawPoint(pointerPoint, "rgba(255, 127, 74, 0.5)");
    drawLabel(
      { x: (a.x + pointerPoint.x) / 2, y: (a.y + pointerPoint.y) / 2 },
      `Preview: ${formatRealDistance(distance(a, pointerPoint))} | ${formatLineAngle(a, pointerPoint)}`,
      angleAwareLabelColor(a, pointerPoint, "#ffd6c7")
    );
  }

  for (let i = 0; i < state.measurePoints.length; i += 1) {
    drawPoint(state.measurePoints[i], "#22d8ff");
    if (isAreaModeEnabled()) {
      continue;
    }

    if (!isTwoPointModeEnabled() && i > 0) {
      const a = state.measurePoints[i - 1];
      const b = state.measurePoints[i];
      drawLine(a, b, "#22d8ff");
      drawLabel(
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        `${formatRealDistance(distance(a, b))} | ${formatLineAngle(a, b)}`,
        angleAwareLabelColor(a, b, "#d8f8ff")
      );
    }
  }

  if (isAreaModeEnabled()) {
    const selectedSavedArea = getSelectedSavedArea();
    if (selectedSavedArea?.points?.length >= 3) {
      drawPolygonFill(selectedSavedArea.points, "rgba(255, 186, 112, 0.2)");
      for (let i = 1; i < selectedSavedArea.points.length; i += 1) {
        drawLine(selectedSavedArea.points[i - 1], selectedSavedArea.points[i], "#ffba70");
      }
      drawLine(
        selectedSavedArea.points[selectedSavedArea.points.length - 1],
        selectedSavedArea.points[0],
        "#ffba70"
      );
      drawLabel(
        polygonLabelPoint(selectedSavedArea.points),
        `Saved: ${formatRealArea(polygonArea(selectedSavedArea.points))}`,
        "#ffe1c0"
      );
    }

    drawPolygonFill(state.measurePoints);

    for (let i = 1; i < state.measurePoints.length; i += 1) {
      drawLine(state.measurePoints[i - 1], state.measurePoints[i], "#22d8ff");
    }

    if (state.measurePoints.length >= 3) {
      drawLine(state.measurePoints[state.measurePoints.length - 1], state.measurePoints[0], "#22d8ff");
      drawLabel(
        polygonLabelPoint(state.measurePoints),
        `Area: ${formatRealArea(polygonArea(state.measurePoints))}`,
        "#d8f8ff"
      );
    }
  } else if (isTwoPointModeEnabled()) {
    for (let i = 1; i < state.measurePoints.length; i += 2) {
      const a = state.measurePoints[i - 1];
      const b = state.measurePoints[i];
      drawLine(a, b, "#22d8ff");
      drawLabel(
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        `${formatRealDistance(distance(a, b))} | ${formatLineAngle(a, b)}`,
        angleAwareLabelColor(a, b, "#d8f8ff")
      );
    }
  }

  if (state.mode === "measure" && pointerPoint && state.measurePoints.length > 0) {
    const hasAnchor = isAreaModeEnabled()
      || !isTwoPointModeEnabled()
      || state.measurePoints.length % 2 === 1;
    if (hasAnchor) {
      const lastPoint = state.measurePoints[state.measurePoints.length - 1];
      drawLine(lastPoint, pointerPoint, "rgba(70, 197, 220, 0.75)");
      drawPoint(pointerPoint, "rgba(34, 216, 255, 0.6)");
      drawLabel(
        { x: (lastPoint.x + pointerPoint.x) / 2, y: (lastPoint.y + pointerPoint.y) / 2 },
        `${formatRealDistance(distance(lastPoint, pointerPoint))} | ${formatLineAngle(lastPoint, pointerPoint)}`,
        angleAwareLabelColor(lastPoint, pointerPoint, "#d8f8ff")
      );
    }
  }

  if (isHoveringImage && !hasValidKnownLength() && !state.scaleRealPerPixel && state.mode !== "measure") {
    drawBlockingOverlay("Set a known length before calibrating");
  }

  syncMobileScrollUi();
  updateFinishAreaButtonState();
}

function pushResult(text) {
  const li = document.createElement("li");
  li.textContent = text;
  resultsList.prepend(li);
}

function getCanvasCoordinates(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.clientWidth / rect.width;
  const scaleY = canvas.clientHeight / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

function finishCalibration() {
  const knownLength = Number(knownLengthInput.value);
  const a = state.calibrationPoints[0];
  const b = state.calibrationPoints[1];
  const px = distance(a, b);

  if (px <= 0) {
    calibrationStatus.textContent = "Calibration points are too close.";
    return;
  }

  state.scaleRealPerPixel = knownLength / px;
  calibrationStatus.textContent = `Calibrated: 1 px = ${state.scaleRealPerPixel.toFixed(6)} ${state.unit}`;
  setHint("Calibration complete. Start measuring and click points on the image.");
  setMode("idle");
  startMeasureBtn.disabled = false;
  clearPointsBtn.disabled = false;
  measureStatus.textContent = "Ready to measure.";
  redraw();
}

function startMeasuring() {
  if (!state.scaleRealPerPixel) {
    measureStatus.textContent = "You must calibrate first.";
    return;
  }
  if (isAreaModeEnabled()) {
    // Keep completed areas, only reset the in-progress draft polygon.
    state.measurePoints = [];
  }
  state.draggingCalibrationIndex = null;
  state.draggingMeasureIndex = null;
  state.draggingPointerId = null;
  state.pointerCanvas = null;
  refreshMeasureResults();
  setMode("measure");
  if (isAreaModeEnabled()) {
    measureStatus.textContent = "Area mode active. Click points around the shape.";
    setHint("Click 3 or more points to outline a shape and measure area.");
  } else if (isTwoPointModeEnabled()) {
    measureStatus.textContent = "2-point mode active. Click 2 points per measurement.";
    setHint("Click first point, then second point to complete one measurement.");
  } else {
    measureStatus.textContent = "Measure mode active. Click points to create segment distances.";
    setHint("Click first point, then keep clicking to measure segment by segment.");
  }
  redraw();
}

function clearPoints() {
  state.measurePoints = [];
  state.draggingCalibrationIndex = null;
  state.draggingMeasureIndex = null;
  state.draggingPointerId = null;
  state.pointerCanvas = null;
  refreshMeasureResults();
  measureStatus.textContent = "Measurement points cleared.";
  setHint("Click Start measuring to create new segments.");
  redraw();
}

function applyZoom(delta) {
  if (!state.image) {
    return;
  }
  const nextZoom = Number((state.zoom + delta).toFixed(2));
  state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  syncZoomPercentUi();
  redraw();
}

function finishAreaMeasurement() {
  if (!isAreaModeEnabled()) {
    measureStatus.textContent = "Enable area mode first.";
    return;
  }

  if (state.mode !== "measure") {
    measureStatus.textContent = "Click Start measuring first.";
    return;
  }

  if (state.measurePoints.length < 3) {
    measureStatus.textContent = "Area needs at least 3 points.";
    return;
  }

  state.savedAreas.push({
    points: clonePoints(state.measurePoints),
  });
  const nextIndex = state.savedAreas.length;
  state.selectedSavedAreaIndex = nextIndex - 1;
  state.measurePoints = [];
  state.draggingMeasureIndex = null;
  state.draggingPointerId = null;
  state.pointerCanvas = null;

  refreshMeasureResults();
  measureStatus.textContent = `Saved area #${nextIndex}. Click points to start another area.`;
  setHint("Area saved. Click 3 or more points to measure another area.");
  redraw();
}

function clearResults() {
  const shouldClear = window.confirm("Clear all saved results and current draft points?");
  if (!shouldClear) {
    return;
  }

  state.measurePoints = [];
  state.savedAreas = [];
  state.selectedSavedAreaIndex = null;
  state.draggingMeasureIndex = null;
  state.draggingPointerId = null;
  state.pointerCanvas = null;
  refreshMeasureResults();
  measureStatus.textContent = "Results cleared.";
  setHint("Results cleared. Start measuring to add new results.");
  redraw();
}

function loadImageFromFile(file, sourceLabel = "Uploaded") {
  if (!file || !file.type.startsWith("image/")) {
    imageInfo.textContent = "That clipboard item is not an image.";
    return;
  }

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  image.onload = () => {
    state.image = image;
    state.calibrationPoints = [];
    state.measurePoints = [];
    state.savedAreas = [];
    state.selectedSavedAreaIndex = null;
    state.draggingCalibrationIndex = null;
    state.draggingMeasureIndex = null;
    state.draggingPointerId = null;
    state.pointerCanvas = null;
    state.scaleRealPerPixel = null;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.maxPanY = 0;
    setMode("idle");
    updateImageDependentUi();
    syncZoomPercentUi();

    const fileName = file.name || "clipboard-image";
    imageInfo.textContent = `${sourceLabel}: ${fileName} (${image.width} x ${image.height})`;
    calibrationStatus.textContent = "Enter known length, then click 2 calibration points.";
    measureStatus.textContent = "Calibration required before measuring.";
    refreshMeasureResults();
    startMeasureBtn.disabled = true;
    clearPointsBtn.disabled = true;
    setHint("Image loaded. Enter known length, then click two points to calibrate.");
    redraw();
    URL.revokeObjectURL(objectUrl);
  };

  image.onerror = () => {
    imageInfo.textContent = "Could not read image from clipboard.";
    URL.revokeObjectURL(objectUrl);
  };

  image.src = objectUrl;
}

imageInput.addEventListener("change", (evt) => {
  const file = evt.target.files?.[0];
  if (!file) {
    return;
  }
  loadImageFromFile(file, "Uploaded");
});

document.addEventListener("paste", (evt) => {
  const items = evt.clipboardData?.items;
  if (!items?.length) {
    return;
  }

  const imageItem = Array.from(items).find((item) => item.type.startsWith("image/"));
  if (!imageItem) {
    return;
  }

  const file = imageItem.getAsFile();
  if (!file) {
    return;
  }

  evt.preventDefault();
  loadImageFromFile(file, "Pasted");
});

startCalibrationBtn.addEventListener("click", resetCalibration);
startMeasureBtn.addEventListener("click", startMeasuring);
clearPointsBtn.addEventListener("click", clearPoints);
finishAreaBtn.addEventListener("click", finishAreaMeasurement);
clearResultsBtn.addEventListener("click", clearResults);
resultsList.addEventListener("click", (evt) => {
  const target = evt.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const item = target.closest("li[data-saved-area-index]");
  if (!item) {
    return;
  }

  const index = Number(item.dataset.savedAreaIndex);
  if (!Number.isInteger(index) || index < 0 || index >= state.savedAreas.length) {
    return;
  }

  state.selectedSavedAreaIndex = index;
  if (isAreaModeEnabled()) {
    const areaNumber = index + 1;
    measureStatus.textContent = `Showing saved area #${areaNumber}.`;
    setHint("Saved area selected. Start a new draft to measure another shape.");
  }
  refreshMeasureResults();
  redraw();
});
zoomOutBtn.addEventListener("click", () => applyZoom(-ZOOM_STEP));
zoomInBtn.addEventListener("click", () => applyZoom(ZOOM_STEP));
mobileScrollRange.addEventListener("input", () => {
  if (!state.image) {
    return;
  }

  if (state.zoom <= 1 || state.maxPanY <= 0) {
    return;
  }

  const nextPanY = Number(mobileScrollRange.value);
  if (!Number.isFinite(nextPanY)) {
    return;
  }

  state.panY = Math.min(state.maxPanY, Math.max(-state.maxPanY, nextPanY));
  redraw();
});

canvas.addEventListener("pointerdown", (evt) => {
  canvas.setPointerCapture(evt.pointerId);
  const cpt = getCanvasCoordinates(evt);
  const ipt = canvasPointToImagePoint(cpt.x, cpt.y);

  if (!ipt) {
    return;
  }

  if (state.mode !== "measure" && state.calibrationPoints.length > 0) {
    const hitCalibrationIndex = findNearestCalibrationPointIndex(cpt);
    if (hitCalibrationIndex !== -1) {
      state.draggingCalibrationIndex = hitCalibrationIndex;
      state.draggingPointerId = evt.pointerId;
      calibrationStatus.textContent = `Dragging calibration point #${hitCalibrationIndex + 1}.`;
      setHint("Drag to adjust calibration point, then release.");
      redraw();
      return;
    }
  }

  if (state.mode !== "measure") {
    if (!hasValidKnownLength()) {
      calibrationStatus.textContent = "Enter a valid known length first.";
      setHint("Fill in known length before setting calibration points.");
      redraw();
      return;
    }

    if (!hasValidUnit()) {
      calibrationStatus.textContent = "Select a valid unit first.";
      redraw();
      return;
    }

    state.unit = knownUnitInput.value.trim();

    if (state.calibrationPoints.length >= 2) {
      state.calibrationPoints = [];
      state.scaleRealPerPixel = null;
      startMeasureBtn.disabled = true;
      clearPointsBtn.disabled = true;
      measureStatus.textContent = "Finish calibration to enable measuring.";
    }

    setMode("calibration");
    state.calibrationPoints.push(ipt);
    if (state.calibrationPoints.length === 1) {
      calibrationStatus.textContent = `Calibration started. Known length: ${Number(knownLengthInput.value)} ${state.unit}`;
      setHint("Now tap or click the second calibration point.");
    }
    if (state.calibrationPoints.length === 2) {
      finishCalibration();
    }
    redraw();
    return;
  }

  if (state.mode === "measure") {
    const hitIndex = findNearestMeasurePointIndex(cpt);
    if (hitIndex !== -1) {
      state.draggingMeasureIndex = hitIndex;
      state.draggingPointerId = evt.pointerId;
      measureStatus.textContent = `Dragging point #${hitIndex + 1}.`;
      setHint("Drag to adjust point position, then release.");
      redraw();
      return;
    }

    state.measurePoints.push(ipt);
    const pointsCount = state.measurePoints.length;
    if (isAreaModeEnabled()) {
      if (pointsCount < 3) {
        measureStatus.textContent = `Point ${pointsCount} set. Add at least ${3 - pointsCount} more point(s) for area.`;
      } else {
        measureStatus.textContent = `Area: ${formatRealArea(polygonArea(state.measurePoints))}`;
      }
    } else if (isTwoPointModeEnabled()) {
      if (pointsCount % 2 === 1) {
        measureStatus.textContent = `Point ${pointsCount} set. Pick the second point.`;
      } else {
        const a = state.measurePoints[pointsCount - 2];
        const b = state.measurePoints[pointsCount - 1];
        const px = distance(a, b);
        measureStatus.textContent = `Measurement #${pointsCount / 2}: ${formatRealDistance(px)}`;
      }
    } else {
      if (pointsCount > 1) {
        const a = state.measurePoints[pointsCount - 2];
        const b = state.measurePoints[pointsCount - 1];
        const px = distance(a, b);
        measureStatus.textContent = `Last segment: ${formatRealDistance(px)}`;
      } else {
        measureStatus.textContent = "First point set. Choose next point to get distance.";
      }
    }
    refreshMeasureResults();
    redraw();
  }
});

canvas.addEventListener("pointermove", (evt) => {
  state.pointerCanvas = getCanvasCoordinates(evt);

  if (
    state.draggingCalibrationIndex !== null
    && evt.pointerId === state.draggingPointerId
    && state.mode !== "measure"
  ) {
    const dragPoint = canvasPointToImagePointClamped(state.pointerCanvas.x, state.pointerCanvas.y);
    if (dragPoint) {
      state.calibrationPoints[state.draggingCalibrationIndex] = dragPoint;
      recalculateCalibrationFromPoints();
      refreshMeasureResults();
    }
  }

  if (state.mode === "measure" && state.draggingMeasureIndex !== null && evt.pointerId === state.draggingPointerId) {
    const dragPoint = canvasPointToImagePointClamped(state.pointerCanvas.x, state.pointerCanvas.y);
    if (dragPoint) {
      state.measurePoints[state.draggingMeasureIndex] = dragPoint;
      refreshMeasureResults();
      measureStatus.textContent = `Adjusted point #${state.draggingMeasureIndex + 1}.`;
    }
  }

  if (state.image) {
    redraw();
  }
});

canvas.addEventListener("pointerup", (evt) => {
  if (evt.pointerId === state.draggingPointerId) {
    if (state.mode === "measure") {
      if (isAreaModeEnabled()) {
        setHint("Add points around the shape. Drag points to fine-tune area.");
      } else if (isTwoPointModeEnabled()) {
        setHint("Click first point, then second point to complete one measurement.");
      } else {
        setHint("Click first point, then keep clicking to measure segment by segment.");
      }
    } else if (state.calibrationPoints.length >= 2) {
      setHint("Calibration adjusted. Start measuring or continue refining points.");
    }
    clearActiveDrag();
    canvas.releasePointerCapture(evt.pointerId);
    redraw();
  }
});

canvas.addEventListener("pointercancel", (evt) => {
  if (evt.pointerId === state.draggingPointerId) {
    clearActiveDrag();
    canvas.releasePointerCapture(evt.pointerId);
    redraw();
  }
});

canvas.addEventListener("pointerleave", () => {
  state.pointerCanvas = null;
  redraw();
});

canvas.addEventListener(
  "wheel",
  (evt) => {
    if (!state.image || state.zoom <= 1) {
      return;
    }

    evt.preventDefault();
    state.panX -= evt.deltaX;
    state.panY -= evt.deltaY;
    redraw();
  },
  { passive: false }
);

knownLengthInput.addEventListener("input", () => {
  if (!hasValidKnownLength()) {
    state.scaleRealPerPixel = null;
    startMeasureBtn.disabled = true;
    clearPointsBtn.disabled = true;
    if (state.image) {
      calibrationStatus.textContent = "Enter known length, then click 2 calibration points.";
      measureStatus.textContent = "Calibration required before measuring.";
    }
  } else if (state.calibrationPoints.length >= 2) {
    recalculateCalibrationFromPoints();
    startMeasureBtn.disabled = false;
    clearPointsBtn.disabled = false;
  }

  if (state.image) {
    redraw();
  }
});

knownUnitInput.addEventListener("change", () => {
  state.unit = knownUnitInput.value.trim() || state.unit;
  if (state.calibrationPoints.length >= 2 && hasValidKnownLength()) {
    recalculateCalibrationFromPoints();
    refreshMeasureResults();
  }
  redraw();
});

twoPointModeInput.addEventListener("change", () => {
  if (isTwoPointModeEnabled() && isAreaModeEnabled()) {
    areaModeInput.checked = false;
  }

  state.measurePoints = [];
  state.savedAreas = [];
  state.selectedSavedAreaIndex = null;
  state.draggingMeasureIndex = null;
  state.draggingPointerId = null;
  refreshMeasureResults();
  if (state.mode === "measure") {
    if (isAreaModeEnabled()) {
      measureStatus.textContent = "Area mode active. Click points around the shape.";
      setHint("Click 3 or more points to outline a shape and measure area.");
    } else if (isTwoPointModeEnabled()) {
      measureStatus.textContent = "2-point mode active. Click 2 points per measurement.";
      setHint("Click first point, then second point to complete one measurement.");
    } else {
      measureStatus.textContent = "Chain mode active. Each new point continues from the last one.";
      setHint("Click first point, then keep clicking to measure segment by segment.");
    }
  }
  redraw();
});

areaModeInput.addEventListener("change", () => {
  if (isAreaModeEnabled() && isTwoPointModeEnabled()) {
    twoPointModeInput.checked = false;
  }

  state.measurePoints = [];
  state.savedAreas = [];
  state.selectedSavedAreaIndex = null;
  state.draggingMeasureIndex = null;
  state.draggingPointerId = null;
  refreshMeasureResults();

  if (state.mode === "measure") {
    if (isAreaModeEnabled()) {
      measureStatus.textContent = "Area mode active. Click points around the shape.";
      setHint("Click 3 or more points to outline a shape and measure area.");
    } else if (isTwoPointModeEnabled()) {
      measureStatus.textContent = "2-point mode active. Click 2 points per measurement.";
      setHint("Click first point, then second point to complete one measurement.");
    } else {
      measureStatus.textContent = "Chain mode active. Each new point continues from the last one.";
      setHint("Click first point, then keep clicking to measure segment by segment.");
    }
  }

  redraw();
});

window.addEventListener("resize", redraw);
updateImageDependentUi();
syncZoomPercentUi();
redraw();
