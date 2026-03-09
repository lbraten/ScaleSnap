const imageInput = document.getElementById("imageInput");
const imageInfo = document.getElementById("imageInfo");
const knownLengthInput = document.getElementById("knownLength");
const knownUnitInput = document.getElementById("knownUnit");
const startCalibrationBtn = document.getElementById("startCalibration");
const startMeasureBtn = document.getElementById("startMeasure");
const clearPointsBtn = document.getElementById("clearPoints");
const twoPointModeInput = document.getElementById("twoPointMode");
const calibrationStatus = document.getElementById("calibrationStatus");
const measureStatus = document.getElementById("measureStatus");
const modeBadge = document.getElementById("modeBadge");
const zoomControls = document.getElementById("zoomControls");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const hintBar = document.getElementById("hintBar");
const resultsList = document.getElementById("resultsList");

const canvas = document.getElementById("measureCanvas");
const ctx = canvas.getContext("2d");

const state = {
  image: null,
  imageRect: null,
  mode: "idle",
  calibrationPoints: [],
  measurePoints: [],
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
  zoomControls.hidden = !hasImage;
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

function hasValidKnownLength() {
  const knownLength = Number(knownLengthInput.value);
  return Number.isFinite(knownLength) && knownLength > 0;
}

function formatRealDistance(px) {
  if (!state.scaleRealPerPixel) {
    return "n/a";
  }
  const real = px * state.scaleRealPerPixel;
  return `${real.toFixed(2)} ${state.unit}`;
}

function isTwoPointModeEnabled() {
  return Boolean(twoPointModeInput?.checked);
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

  if (isTwoPointModeEnabled()) {
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

function redraw() {
  setupCanvasSize();

  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  if (!state.image) {
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
      `Calib: ${formatRealDistance(distance(a, b))}`,
      "#ffd6c7"
    );
  }

  for (let i = 0; i < state.measurePoints.length; i += 1) {
    drawPoint(state.measurePoints[i], "#22d8ff");
    if (!isTwoPointModeEnabled() && i > 0) {
      const a = state.measurePoints[i - 1];
      const b = state.measurePoints[i];
      drawLine(a, b, "#22d8ff");
      drawLabel(
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        formatRealDistance(distance(a, b)),
        "#d8f8ff"
      );
    }
  }

  if (isTwoPointModeEnabled()) {
    for (let i = 1; i < state.measurePoints.length; i += 2) {
      const a = state.measurePoints[i - 1];
      const b = state.measurePoints[i];
      drawLine(a, b, "#22d8ff");
      drawLabel(
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        formatRealDistance(distance(a, b)),
        "#d8f8ff"
      );
    }
  }

  if (state.mode === "measure" && pointerPoint && state.measurePoints.length > 0) {
    const hasAnchor = !isTwoPointModeEnabled() || state.measurePoints.length % 2 === 1;
    if (hasAnchor) {
      const lastPoint = state.measurePoints[state.measurePoints.length - 1];
      drawLine(lastPoint, pointerPoint, "rgba(70, 197, 220, 0.75)");
      drawPoint(pointerPoint, "rgba(34, 216, 255, 0.6)");
      drawLabel(
        { x: (lastPoint.x + pointerPoint.x) / 2, y: (lastPoint.y + pointerPoint.y) / 2 },
        formatRealDistance(distance(lastPoint, pointerPoint)),
        "#d8f8ff"
      );
    }
  }

  if (isHoveringImage && !hasValidKnownLength() && !state.scaleRealPerPixel && state.mode !== "measure") {
    drawBlockingOverlay("Set a known length before calibrating");
  }
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

function beginCalibration() {
  const knownLength = Number(knownLengthInput.value);
  const unit = knownUnitInput.value.trim();

  if (!state.image) {
    calibrationStatus.textContent = "Upload an image first.";
    return;
  }
  if (!Number.isFinite(knownLength) || knownLength <= 0) {
    calibrationStatus.textContent = "Enter a valid known length first.";
    return;
  }
  if (!unit) {
    calibrationStatus.textContent = "Enter a unit like mm or cm.";
    return;
  }

  state.calibrationPoints = [];
  state.scaleRealPerPixel = null;
  state.unit = unit;
  setMode("calibration");
  setHint("Tap or click the first point for your known-length reference.");
  calibrationStatus.textContent = `Calibration active. Known length: ${knownLength} ${unit}`;
  measureStatus.textContent = "Finish calibration to enable measuring.";
  startMeasureBtn.disabled = true;
  clearPointsBtn.disabled = true;
  redraw();
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
  state.measurePoints = [];
  state.draggingCalibrationIndex = null;
  state.draggingMeasureIndex = null;
  state.draggingPointerId = null;
  refreshMeasureResults();
  setMode("measure");
  if (isTwoPointModeEnabled()) {
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
    state.draggingCalibrationIndex = null;
    state.draggingMeasureIndex = null;
    state.draggingPointerId = null;
    state.pointerCanvas = null;
    state.scaleRealPerPixel = null;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    setMode("idle");
    updateImageDependentUi();

    const fileName = file.name || "clipboard-image";
    imageInfo.textContent = `${sourceLabel}: ${fileName} (${image.width} x ${image.height})`;
    calibrationStatus.textContent = "Set known length and pick 2 calibration points.";
    measureStatus.textContent = "Calibration required before measuring.";
    refreshMeasureResults();
    startMeasureBtn.disabled = true;
    clearPointsBtn.disabled = true;
    setHint("Image loaded. Enter known length and start calibration.");
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

startCalibrationBtn.addEventListener("click", beginCalibration);
startMeasureBtn.addEventListener("click", startMeasuring);
clearPointsBtn.addEventListener("click", clearPoints);
zoomOutBtn.addEventListener("click", () => applyZoom(-ZOOM_STEP));
zoomInBtn.addEventListener("click", () => applyZoom(ZOOM_STEP));

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

  if (state.mode === "calibration") {
    state.calibrationPoints.push(ipt);
    if (state.calibrationPoints.length === 1) {
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
    if (isTwoPointModeEnabled()) {
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
      if (isTwoPointModeEnabled()) {
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
  if (state.image) {
    redraw();
  }
});

twoPointModeInput.addEventListener("change", () => {
  refreshMeasureResults();
  if (state.mode === "measure") {
    if (isTwoPointModeEnabled()) {
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
redraw();
