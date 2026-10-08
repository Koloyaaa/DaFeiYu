(function () {
  "use strict";

  const manifest = window.FISH_ASSET_MANIFEST;
  const canvas = document.getElementById("game");
  const context = canvas.getContext("2d");
  const W = 420;
  const H = 620;
  const LEFT = 24;
  const RIGHT = 396;
  const FLOOR = 594;
  const DANGER_LINE = 136;
  const DROP_Y = 66;
  const GRAVITY = 1450;
  const BASE_SIZE = 45;
  const SIZE_GROWTH = 1.21;
  const PHYSICS_SUBSTEPS = 3;
  const POSITION_ITERATIONS = 4;
  const MAX_ANGULAR_SPEED = 0.72;
  const STARTER_WEIGHTS = [35, 24, 16, 11, 8, 6];
  const SLEEP_LINEAR_SPEED = 18;
  const SLEEP_ANGULAR_SPEED = 0.08;
  const SLEEP_DELAY = 0.45;
  const MIN_BOUNCE_SPEED = 90;
  const CONTACT_FRICTION = 0.3;
  const COLLISION_SLOP = 2; // Allow a tiny overlap so crowded stacks can pack more tightly.
  const geometryCache = new WeakMap();
  const stageOrder = manifest.progressionOrder;
  const rawAssets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const stages = stageOrder.map((id, index) => {
    const asset = rawAssets.get(id);
    const image = new Image();
    image.addEventListener("load", () => draw());
    const polygon = Float32Array.from(asset.collision.polygon.flat());
    return { ...asset, image, polygon, index, loadFailed: false };
  });
  const scoreNode = document.getElementById("score");
  const bestScoreNode = document.getElementById("best-score");
  const nextImage = document.getElementById("next-image");
  const nextName = document.getElementById("next-name");
  const nextRank = document.getElementById("next-rank");
  const collectionList = document.getElementById("collection-list");
  const collectionCount = document.getElementById("collection-count");
  const dialog = document.getElementById("game-over-dialog");
  const toast = document.getElementById("game-toast");
  const announcer = document.getElementById("announcer");
  const assetLoader = document.getElementById("asset-loader");
  const assetLoadingTitle = document.getElementById("asset-loading-title");
  const assetLoadingMessage = document.getElementById("asset-loading-message");
  const assetLoadingCount = document.getElementById("asset-loading-count");
  const assetProgress = document.getElementById("asset-progress");
  const assetRetryButton = document.getElementById("asset-retry");
  const resultCopy = document.getElementById("result-copy");
  const resultTitle = document.getElementById("result-title");
  const resultScore = document.getElementById("result-score");
  const resultAvatar = document.getElementById("result-avatar");
  const touchInstructions = document.getElementById("touch-instructions");
  const TOUCH_DRAG_THRESHOLD = 14;

  const hasTouchInput = (navigator.maxTouchPoints || 0) > 0
    || (window.matchMedia && window.matchMedia("(any-pointer: coarse)").matches);
  if (hasTouchInput) document.body.classList.add("has-touch-input");

  const collectionRows = stages.map((stage, index) => {
    const row = document.createElement("li");
    row.className = "collection-item";
    row.innerHTML = `<span class="collection-rank">${String(index + 1).padStart(2, "0")}</span><img alt="" src="${stage.src}"><span class="collection-name"></span><span class="collection-state"></span>`;
    row.querySelector(".collection-name").textContent = stage.id;
    collectionList.appendChild(row);
    return row;
  });

  let pieces = [];
  let particles = [];
  let score = 0;
  let record = readNumber("big-fish-record", 0);
  let currentLevel = randomStarter();
  let nextLevel = randomStarter();
  let highestLevel = Math.max(currentLevel, nextLevel);
  let aimX = W / 2;
  let gameOver = false;
  let won = false;
  let pendingDropId = null;
  let touchAimArmed = false;
  let activeTouchGesture = null;
  let lastFrame = 0;
  let simulationTime = 0;
  let nextPieceId = 1;
  let toastTimer = 0;
  let lastDropNotice = -Infinity;
  let assetsReady = false;
  let assetLoadRun = 0;

  function readNumber(key, fallback) {
    try {
      const value = Number(window.localStorage.getItem(key));
      return Number.isFinite(value) ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function randomStarter() {
    let roll = Math.random() * 100;
    for (let level = 0; level < STARTER_WEIGHTS.length; level += 1) {
      roll -= STARTER_WEIGHTS[level];
      if (roll < 0) return level;
    }
    return STARTER_WEIGHTS.length - 1;
  }

  function updateAssetProgress(completed, failedCount) {
    const percent = Math.round((completed / stages.length) * 100);
    assetProgress.style.width = `${percent}%`;
    assetProgress.parentElement.setAttribute("aria-valuenow", String(percent));
    assetLoadingCount.textContent = `${percent}%`;
    assetLoadingTitle.textContent = failedCount ? "有素材没有加载成功" : "正在加载角色素材";
  }

  function loadStageAssets(retryFailedOnly = false) {
    const run = ++assetLoadRun;
    const targets = retryFailedOnly ? stages.filter((stage) => stage.loadFailed) : stages;
    let completed = stages.length - targets.length;
    const failed = [];
    assetsReady = false;
    assetLoader.hidden = false;
    assetRetryButton.hidden = true;
    assetLoadingMessage.textContent = retryFailedOnly
      ? "正在重新加载未成功的图片…"
      : "先把所有角色图片准备好，再开始游戏。";
    updateAssetProgress(completed, 0);

    const requests = targets.map((stage) => new Promise((resolve) => {
      let settled = false;
      const finish = (success) => {
        if (settled) return;
        settled = true;
        stage.loadFailed = !success;
        completed += 1;
        if (!success) failed.push(stage.id);
        updateAssetProgress(completed, failed.length);
        resolve();
      };
      stage.image.addEventListener("load", () => finish(true), { once: true });
      stage.image.addEventListener("error", () => finish(false), { once: true });
      const source = retryFailedOnly
        ? `${stage.src}${stage.src.includes("?") ? "&" : "?"}reload=${Date.now()}-${stage.index}`
        : stage.src;
      stage.image.src = source;
      if (stage.image.complete) queueMicrotask(() => finish(stage.image.naturalWidth > 0));
    }));

    Promise.all(requests).then(() => {
      if (run !== assetLoadRun) return;
      if (failed.length) {
        assetLoadingTitle.textContent = "有素材没有加载成功";
        assetLoadingMessage.textContent = `加载失败：${failed.join("、")}。检查网络后可以重试。`;
        assetRetryButton.hidden = false;
        assetRetryButton.focus({ preventScroll: true });
        return;
      }
      assetLoadingTitle.textContent = "素材准备好了";
      assetLoadingMessage.textContent = "图片已全部加载，马上开始。";
      window.setTimeout(() => {
        if (run !== assetLoadRun) return;
        assetLoader.hidden = true;
        assetsReady = true;
        lastFrame = 0;
        draw();
      }, 360);
    });
  }

  function metricsFor(level) {
    const stage = stages[level];
    const bounds = stage.collision.bounds;
    const diameter = BASE_SIZE * 0.75 * Math.pow(SIZE_GROWTH, level);
    const widestFraction = Math.max(bounds.width, bounds.height);
    const imageSize = diameter / widestFraction;
    return {
      diameter,
      w: imageSize * bounds.width,
      h: imageSize * bounds.height,
      imageSize,
      imageX: stage.collision.cx * imageSize,
      imageY: stage.collision.cy * imageSize,
    };
  }

  function updateInterface() {
    scoreNode.textContent = score.toLocaleString("zh-CN");
    bestScoreNode.textContent = record.toLocaleString("zh-CN");
    collectionCount.textContent = `${highestLevel + 1} / ${stages.length}`;
    collectionRows.forEach((row, index) => {
      const unlocked = index <= highestLevel;
      row.classList.toggle("is-unlocked", unlocked);
      row.classList.toggle("is-current", index === highestLevel);
      row.querySelector(".collection-state").textContent = index === highestLevel ? "当前" : unlocked ? "已解锁" : "待解锁";
    });

    const upcoming = stages[nextLevel];
    const previewSize = Math.min(108, Math.max(60, metricsFor(nextLevel).diameter * 1.52));
    nextImage.src = upcoming.src;
    nextImage.style.width = `${previewSize}px`;
    nextImage.style.height = `${previewSize}px`;
    nextName.textContent = upcoming.id;
    nextRank.textContent = String(nextLevel + 1).padStart(2, "0");
  }

  function addPiece(level, x, y, vx = 0, vy = 0, mergeLock = 0, alreadyEnteredBoard = false, angle = 0, angularVelocity = 0) {
    const metrics = metricsFor(level);
    const piece = {
      id: nextPieceId++,
      level,
      x,
      y,
      vx,
      vy,
      angle,
      angularVelocity,
      w: metrics.w,
      h: metrics.h,
      imageSize: metrics.imageSize,
      imageX: metrics.imageX,
      imageY: metrics.imageY,
      squash: 0,
      sleepTimer: 0,
      sleeping: false,
      dangerTime: 0,
      enteredBoard: alreadyEnteredBoard,
      mergeLock,
      bornAt: simulationTime,
    };
    pieces.push(piece);
    return piece;
  }

  function setPendingDrop(id) {
    pendingDropId = id;
    updateTouchInstructions();
  }

  function updateTouchInstructions() {
    if (!touchInstructions) return;
    touchInstructions.textContent = gameOver
      ? "本局已结束。"
      : pendingDropId !== null
        ? "等待角色落稳后，再拖动选择下一位的位置。"
        : touchAimArmed
          ? "位置已选好，再轻触棋盘即可放置。"
          : "拖动棋盘选择位置，松手后再轻触棋盘放置。短距离轻触只移动预览，不会放下角色。";
  }

  function dropCharacter() {
    if (!assetsReady || gameOver) return;
    if (pendingDropId !== null) {
      if (simulationTime - lastDropNotice > 0.8) {
        showToast("等角色落到其他角色或池底，再放下一个");
        lastDropNotice = simulationTime;
      }
      return;
    }
    const metrics = metricsFor(currentLevel);
    const x = clamp(aimX, LEFT + metrics.w / 2, RIGHT - metrics.w / 2);
    const dropped = addPiece(currentLevel, x, DROP_Y + metrics.h / 2);
    touchAimArmed = false;
    setPendingDrop(dropped.id);
    highestLevel = Math.max(highestLevel, currentLevel);
    currentLevel = nextLevel;
    nextLevel = randomStarter();
    highestLevel = Math.max(highestLevel, currentLevel, nextLevel);
    updateInterface();
    announcer.textContent = `放下了 ${stages[dropped.level].id}。`;
  }

  function pointerX(event) {
    const bounds = canvas.getBoundingClientRect();
    return clamp(((event.clientX - bounds.left) / bounds.width) * W, LEFT + 14, RIGHT - 14);
  }

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") {
      aimX = pointerX(event);
      return;
    }
    const gesture = activeTouchGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - gesture.startX) >= TOUCH_DRAG_THRESHOLD) gesture.horizontalDrag = true;
    if (!gesture.armedAtStart || gesture.horizontalDrag) aimX = pointerX(event);
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    if (event.pointerType === "mouse") {
      aimX = pointerX(event);
      dropCharacter();
      return;
    }
    document.body.classList.add("has-touch-input");
    if (activeTouchGesture) return;
    const armedAtStart = touchAimArmed;
    if (!armedAtStart) aimX = pointerX(event);
    activeTouchGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      armedAtStart,
      horizontalDrag: false,
    };
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  });
  window.addEventListener("pointerup", (event) => {
    const gesture = activeTouchGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    activeTouchGesture = null;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const horizontalDrag = gesture.horizontalDrag || Math.abs(deltaX) >= TOUCH_DRAG_THRESHOLD;
    const shortTap = Math.hypot(deltaX, deltaY) < TOUCH_DRAG_THRESHOLD;
    if (gesture.armedAtStart && shortTap) {
      touchAimArmed = false;
      updateTouchInstructions();
      dropCharacter();
      return;
    }
    if (horizontalDrag) {
      aimX = pointerX(event);
      touchAimArmed = !gameOver && pendingDropId === null;
    }
    updateTouchInstructions();
  });
  window.addEventListener("pointercancel", (event) => {
    if (activeTouchGesture?.pointerId === event.pointerId) activeTouchGesture = null;
  });
  document.getElementById("restart-button").addEventListener("click", restart);
  document.getElementById("dialog-restart").addEventListener("click", () => {
    if (dialog.open) dialog.close();
    restart();
    canvas.focus({ preventScroll: true });
  });
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", (event) => {
    if (!assetsReady) return;
    const target = event.target;
    if (target instanceof HTMLButtonElement) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      aimX = clamp(aimX + (event.key === "ArrowLeft" ? -22 : 22), LEFT + 14, RIGHT - 14);
    } else if (event.code === "Space" || event.key === "Enter") {
      event.preventDefault();
      dropCharacter();
    } else if (event.key.toLowerCase() === "r") {
      restart();
    }
  });

  function restart() {
    pieces = [];
    particles = [];
    score = 0;
    currentLevel = randomStarter();
    nextLevel = randomStarter();
    highestLevel = Math.max(currentLevel, nextLevel);
    aimX = W / 2;
    gameOver = false;
    won = false;
    touchAimArmed = false;
    activeTouchGesture = null;
    setPendingDrop(null);
    simulationTime = 0;
    lastDropNotice = -Infinity;
    updateInterface();
    if (dialog.open) dialog.close();
    toast.hidden = true;
    resultAvatar.hidden = true;
    announcer.textContent = "新的一局开始啦。";
    draw();
  }

  function integratePiece(piece, dt) {
    piece.mergeLock = Math.max(0, piece.mergeLock - dt);
    piece.squash *= Math.exp(-dt * 7);
    if (piece.sleeping) return;
    piece.angularVelocity *= Math.pow(0.92, dt * 60);
    if (Math.abs(piece.angularVelocity) < 0.01) piece.angularVelocity = 0;
    const nextAngle = piece.angle + piece.angularVelocity * dt;
    if (fitsAngleInBin(piece.w, piece.h, nextAngle, pieceScale(piece))) {
      piece.angle = nextAngle;
    } else {
      piece.angle = fitAngleToBin(piece.w, piece.h, piece.angle, pieceScale(piece));
      piece.angularVelocity *= -0.28;
    }
    piece.vy = Math.min(piece.vy + GRAVITY * dt, 1250);
    piece.x += piece.vx * dt;
    piece.y += piece.vy * dt;
      piece.vx *= Math.pow(0.991, dt * 60);
    piece.vy *= Math.pow(0.999, dt * 60);

    let bounds = pieceSilhouetteAabb(piece);
    if (bounds.left < LEFT) {
      piece.x += LEFT - bounds.left;
      piece.vx = Math.abs(piece.vx) * 0.48;
      piece.angularVelocity = clamp(piece.angularVelocity + clamp(piece.vy * 0.00015, -0.04, 0.04), -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
      piece.squash = Math.max(piece.squash, 0.12);
    } else if (bounds.right > RIGHT) {
      piece.x -= bounds.right - RIGHT;
      piece.vx = -Math.abs(piece.vx) * 0.48;
      piece.angularVelocity = clamp(piece.angularVelocity - clamp(piece.vy * 0.00015, -0.04, 0.04), -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
      piece.squash = Math.max(piece.squash, 0.12);
    }
    bounds = pieceSilhouetteAabb(piece);
    if (bounds.bottom > FLOOR) {
      piece.y -= bounds.bottom - FLOOR;
      if (piece.id === pendingDropId && piece.vy > 0) setPendingDrop(null);
      if (piece.vy > 105) {
        piece.vy = -piece.vy * 0.36;
        piece.squash = Math.max(piece.squash, 0.12);
        piece.angularVelocity = clamp(piece.angularVelocity + clamp(piece.vx * 0.00025, -0.08, 0.08), -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
      } else {
        piece.vy = 0;
      }
      piece.vx *= Math.pow(0.915, dt * 60);
    }
  }

  function update(dt) {
    simulationTime += dt;
    const substep = dt / PHYSICS_SUBSTEPS;
    let merged = false;

    for (let substepIndex = 0; substepIndex < PHYSICS_SUBSTEPS; substepIndex += 1) {
      for (const piece of pieces) integratePiece(piece, substep);

      // Re-project contacts several times per substep. Each pass removes the
      // remaining overlap, which is the position-based part of the solver.
      for (let iteration = 0; iteration < POSITION_ITERATIONS; iteration += 1) {
        for (const [a, b] of collisionCandidates()) {
          const contact = polygonPenetration(pieceGeometry(a).vertices, pieceGeometry(b).vertices, a.id, b.id);
          if (!contact) continue;

          if (a.level === b.level && a.mergeLock <= 0 && b.mergeLock <= 0 && simulationTime - a.bornAt > 0.05 && simulationTime - b.bornAt > 0.05) {
            if (a.id === pendingDropId || b.id === pendingDropId) setPendingDrop(null);
            mergeCharacters(a, b);
            merged = true;
            break;
          }
          if (a.sleeping && b.sleeping) continue;
          if (a.sleeping) wakePiece(a);
          if (b.sleeping) wakePiece(b);
          if (isPendingDropLanding(a, b)) setPendingDrop(null);
          resolveBounce(a, b, contact, iteration === 0);
        }

        for (const piece of pieces) clampPieceToBin(piece);
        if (merged || gameOver) break;
      }
      if (merged || gameOver) break;
    }

    for (const piece of pieces) updateSleepState(piece, dt);

    for (const piece of pieces) {
      const bounds = pieceSilhouetteAabb(piece);
      if (bounds.bottom > DANGER_LINE + 1) piece.enteredBoard = true;
      if (!piece.enteredBoard || bounds.top >= DANGER_LINE) {
        piece.dangerTime = 0;
        continue;
      }

      // Require a stable overflow for a short grace period. Fast drops and
      // Merge pops can cross the line briefly without ending the run.
      if (Math.hypot(piece.vx, piece.vy) < 86) piece.dangerTime += dt;
      else piece.dangerTime = Math.max(0, piece.dangerTime - dt * 3);
      if (piece.dangerTime >= 1.15) {
        finishGame(false);
        return;
      }
    }

    particles = particles.filter((particle) => {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 120 * dt;
      return particle.life > 0;
    });
  }

  function collisionCandidates() {
    const ordered = pieces
      .map((piece) => ({ piece, bounds: pieceGeometry(piece).bounds }))
      .sort((a, b) => a.bounds.left - b.bounds.left);
    const candidates = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      for (let nextIndex = index + 1; nextIndex < ordered.length; nextIndex += 1) {
        const next = ordered[nextIndex];
        if (next.bounds.left >= current.bounds.right) break;
        if (next.bounds.top >= current.bounds.bottom || next.bounds.bottom <= current.bounds.top) continue;
        candidates.push([current.piece, next.piece]);
      }
    }
    return candidates;
  }

  function isPendingDropLanding(a, b) {
    const dropped = a.id === pendingDropId ? a : b.id === pendingDropId ? b : null;
    if (!dropped) return false;
    const support = dropped === a ? b : a;
    return dropped.y < support.y && dropped.vy >= support.vy - 12;
  }

  function wakePiece(piece) {
    piece.sleeping = false;
    piece.sleepTimer = 0;
  }

  function updateSleepState(piece, dt) {
    if (piece.sleeping) return;
    const slowEnough = Math.hypot(piece.vx, piece.vy) <= SLEEP_LINEAR_SPEED &&
      Math.abs(piece.angularVelocity) <= SLEEP_ANGULAR_SPEED;
    piece.sleepTimer = slowEnough ? piece.sleepTimer + dt : 0;
    if (piece.sleepTimer < SLEEP_DELAY) return;
    piece.vx = 0;
    piece.vy = 0;
    piece.angularVelocity = 0;
    piece.sleeping = true;
  }

  function pieceGeometry(piece) {
    const angle = piece.angle || 0;
    const scale = pieceScale(piece);
    const cached = geometryCache.get(piece);
    if (cached && cached.x === piece.x && cached.y === piece.y && cached.angle === angle && cached.scale === scale) {
      return cached.geometry;
    }

    const polygon = stages[piece.level].polygon;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const vertices = new Float32Array(polygon.length);
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let index = 0; index < polygon.length; index += 2) {
      const localX = (polygon[index] - 0.5) * piece.w * scale;
      const localY = (polygon[index + 1] - 0.5) * piece.h * scale;
      const worldX = piece.x + cosine * localX - sine * localY;
      const worldY = piece.y + sine * localX + cosine * localY;
      vertices[index] = worldX;
      vertices[index + 1] = worldY;
      left = Math.min(left, worldX);
      right = Math.max(right, worldX);
      top = Math.min(top, worldY);
      bottom = Math.max(bottom, worldY);
    }
    const geometry = { vertices, bounds: { left, right, top, bottom } };
    geometryCache.set(piece, { x: piece.x, y: piece.y, angle, scale, geometry });
    return geometry;
  }

  function polygonPenetration(verticesA, verticesB, idA, idB) {
    const countA = verticesA.length / 2;
    const countB = verticesB.length / 2;
    let centerAx = 0;
    let centerAy = 0;
    let centerBx = 0;
    let centerBy = 0;
    for (let index = 0; index < countA; index += 1) {
      centerAx += verticesA[index * 2];
      centerAy += verticesA[index * 2 + 1];
    }
    for (let index = 0; index < countB; index += 1) {
      centerBx += verticesB[index * 2];
      centerBy += verticesB[index * 2 + 1];
    }
    centerAx /= countA;
    centerAy /= countA;
    centerBx /= countB;
    centerBy /= countB;
    let minimumOverlap = Infinity;
    let normalX = 0;
    let normalY = 0;

    for (const vertices of [verticesA, verticesB]) {
      const count = vertices.length / 2;
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        const edgeX = vertices[next * 2] - vertices[index * 2];
        const edgeY = vertices[next * 2 + 1] - vertices[index * 2 + 1];
        const edgeLength = Math.hypot(edgeX, edgeY);
        if (edgeLength < 1e-5) continue;
        let axisX = -edgeY / edgeLength;
        let axisY = edgeX / edgeLength;
        let minA = Infinity;
        let maxA = -Infinity;
        let minB = Infinity;
        let maxB = -Infinity;
        for (let vertex = 0; vertex < countA; vertex += 1) {
          const projection = verticesA[vertex * 2] * axisX + verticesA[vertex * 2 + 1] * axisY;
          minA = Math.min(minA, projection);
          maxA = Math.max(maxA, projection);
        }
        for (let vertex = 0; vertex < countB; vertex += 1) {
          const projection = verticesB[vertex * 2] * axisX + verticesB[vertex * 2 + 1] * axisY;
          minB = Math.min(minB, projection);
          maxB = Math.max(maxB, projection);
        }
        const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
        if (overlap < -0.001) return null;
        if (overlap < minimumOverlap) {
          const direction = (centerBx - centerAx) * axisX + (centerBy - centerAy) * axisY;
          if (direction < -1e-5 || (Math.abs(direction) <= 1e-5 && idA > idB)) {
            axisX = -axisX;
            axisY = -axisY;
          }
          minimumOverlap = Math.max(0, overlap);
          normalX = axisX;
          normalY = axisY;
        }
      }
    }
    return Number.isFinite(minimumOverlap)
      ? { nx: normalX, ny: normalY, depth: minimumOverlap }
      : null;
  }

  function resolveBounce(a, b, contact, applyImpulse = true) {
    const nx = contact.nx;
    const ny = contact.ny;
    const boundsA = pieceAabb(a);
    const boundsB = pieceAabb(b);
    const depth = contact.depth - COLLISION_SLOP;
    if (!Number.isFinite(depth) || depth <= 0) return;

    const invMassA = 1 / (a.w * a.h);
    const invMassB = 1 / (b.w * b.h);
    const inverseTotal = invMassA + invMassB;
    const correction = depth * 0.82;
    a.x -= nx * correction * (invMassA / inverseTotal);
    a.y -= ny * correction * (invMassA / inverseTotal);
    b.x += nx * correction * (invMassB / inverseTotal);
    b.y += ny * correction * (invMassB / inverseTotal);

    const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (applyImpulse && relativeVelocity < 0) {
      const restitution = -relativeVelocity < MIN_BOUNCE_SPEED ? 0 : 0.16;
      const impulse = -(1 + restitution) * relativeVelocity / inverseTotal;
      const tangentVelocityX = (b.vx - a.vx) - relativeVelocity * nx;
      const tangentVelocityY = (b.vy - a.vy) - relativeVelocity * ny;
      const tangentSpeed = Math.hypot(tangentVelocityX, tangentVelocityY);
      const tangentX = tangentSpeed > 0.001 ? tangentVelocityX / tangentSpeed : 0;
      const tangentY = tangentSpeed > 0.001 ? tangentVelocityY / tangentSpeed : 0;
      const frictionImpulse = clamp(-tangentSpeed / inverseTotal, -impulse * CONTACT_FRICTION, impulse * CONTACT_FRICTION);
      a.vx -= impulse * invMassA * nx;
      a.vy -= impulse * invMassA * ny;
      b.vx += impulse * invMassB * nx;
      b.vy += impulse * invMassB * ny;
      a.vx -= frictionImpulse * invMassA * tangentX;
      a.vy -= frictionImpulse * invMassA * tangentY;
      b.vx += frictionImpulse * invMassB * tangentX;
      b.vy += frictionImpulse * invMassB * tangentY;
      if (relativeVelocity < -70) {
        const contactX = (Math.max(boundsA.left, boundsB.left) + Math.min(boundsA.right, boundsB.right)) / 2;
        const contactY = (Math.max(boundsA.top, boundsB.top) + Math.min(boundsA.bottom, boundsB.bottom)) / 2;
        const inertiaA = (1 / invMassA) * (a.w * a.w + a.h * a.h) / 12;
        const inertiaB = (1 / invMassB) * (b.w * b.w + b.h * b.h) / 12;
        const armA = (contactX - a.x) * ny - (contactY - a.y) * nx;
        const armB = (contactX - b.x) * ny - (contactY - b.y) * nx;
        const spinA = clamp(-impulse * armA / inertiaA * 0.22, -0.24, 0.24);
        const spinB = clamp(impulse * armB / inertiaB * 0.22, -0.24, 0.24);
        a.angularVelocity = clamp(a.angularVelocity + spinA, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
        b.angularVelocity = clamp(b.angularVelocity + spinB, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
      }
      a.squash = Math.max(a.squash, 0.1);
      b.squash = Math.max(b.squash, 0.1);
    }
    clampPieceToBin(a);
    clampPieceToBin(b);
  }

  function clampPieceToBin(piece) {
    let bounds = pieceSilhouetteAabb(piece);
    if (bounds.left < LEFT) piece.x += LEFT - bounds.left;
    bounds = pieceSilhouetteAabb(piece);
    if (bounds.right > RIGHT) piece.x -= bounds.right - RIGHT;
    bounds = pieceSilhouetteAabb(piece);
    if (bounds.bottom > FLOOR) piece.y -= bounds.bottom - FLOOR;
  }

  function pieceScale(piece) {
    // Keep impact animation springy without compressing the artwork vertically.
    return 1 + Math.max(0, piece.squash || 0) * 0.08;
  }

  function rotatedExtents(width, height, angle, scale = 1) {
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));
    return {
      x: (cosine * width + sine * height) * scale / 2,
      y: (sine * width + cosine * height) * scale / 2,
    };
  }

  function fitsAngleInBin(width, height, angle, scale = 1) {
    return rotatedExtents(width, height, angle, scale).x * 2 <= RIGHT - LEFT;
  }

  function fitAngleToBin(width, height, angle, scale = 1) {
    if (fitsAngleInBin(width, height, angle, scale)) return angle;
    for (let step = 1; step <= 180; step += 1) {
      const offset = step * Math.PI / 180;
      if (fitsAngleInBin(width, height, angle + offset, scale)) return angle + offset;
      if (fitsAngleInBin(width, height, angle - offset, scale)) return angle - offset;
    }
    return 0;
  }

  function pieceAabb(piece) {
    return pieceGeometry(piece).bounds;
  }

  function pieceSilhouetteAabb(piece) {
    return pieceGeometry(piece).bounds;
  }

  function mergeCharacters(a, b) {
    const weightA = a.w * a.h;
    const weightB = b.w * b.h;
    const x = (a.x * weightA + b.x * weightB) / (weightA + weightB);
    const y = (a.y * weightA + b.y * weightB) / (weightA + weightB);
    const vx = (a.vx + b.vx) * 0.25;
    const vy = (a.vy + b.vy) * 0.2 - 90;
    const mergedAngle = a.angle + Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle)) * (weightB / (weightA + weightB));
    const angularVelocity = ((a.angularVelocity * weightA + b.angularVelocity * weightB) / (weightA + weightB)) * 0.35;
    const alreadyEnteredBoard = a.enteredBoard || b.enteredBoard;
    pieces = pieces.filter((piece) => piece.id !== a.id && piece.id !== b.id);
    const newLevel = a.level + 1;
    score += (newLevel + 1) * 10;
    record = Math.max(record, score);
    try { window.localStorage.setItem("big-fish-record", String(record)); } catch (_) { /* local scores are optional */ }
    emitMerge(x, y, newLevel);

    const metrics = metricsFor(newLevel);
    const angle = fitAngleToBin(metrics.w, metrics.h, mergedAngle);
    const extents = rotatedExtents(metrics.w, metrics.h, angle);
    const newX = clamp(x, LEFT + extents.x, RIGHT - extents.x);
    addPiece(newLevel, newX, y, vx, vy, 0.18, alreadyEnteredBoard, angle, angularVelocity);
    highestLevel = Math.max(highestLevel, newLevel);
    updateInterface();
    announcer.textContent = `合成成功，进化成 ${stages[newLevel].id}！`;
    if (newLevel === stages.length - 1) {
      won = true;
      finishGame(true);
    }
  }

  function emitMerge(x, y, newLevel) {
    const colors = ["#f4cf9f", "#eea27e", "#e9c969", "#a5d7bf", "#b8c4e8"];
    for (let index = 0; index < 15; index += 1) {
      const angle = (Math.PI * 2 * index) / 15 + Math.random() * 0.16;
      const speed = 70 + Math.random() * 145;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 38,
        life: 0.5 + Math.random() * 0.32,
        maxLife: 0.82,
        color: colors[newLevel % colors.length],
        size: 2 + Math.random() * 3.2,
      });
    }
    showToast(`合成成功 · ${stages[newLevel].id}`);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 1100);
  }

  function finishGame(completed) {
    if (gameOver) return;
    gameOver = true;
    updateTouchInstructions();
    resultScore.textContent = score.toLocaleString("zh-CN");
    resultAvatar.hidden = !completed;
    if (completed) {
      resultAvatar.src = stages[stages.length - 1].src;
      resultTitle.textContent = "DeepSeek（大肥鱼）登场！";
    resultCopy.textContent = "十一位伙伴终于合成到最后一阶。大肥鱼，是 DeepSeek 的昵称。";
    } else {
      resultTitle.textContent = "本局结束";
      resultCopy.textContent = `角色越过上方界线，本局进化到 ${stages[highestLevel].id}，获得 ${score.toLocaleString("zh-CN")} 分。`;
    }
    announcer.textContent = completed ? "恭喜，合成到 DeepSeek，也就是大肥鱼。" : "角色越过上方界线，本局结束。";
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function drawBackground() {
    context.clearRect(0, 0, W, H);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, W, H);

    context.save();
    context.strokeStyle = "#d8d8d8";
    context.lineWidth = 1.5;
    context.lineCap = "square";
    context.beginPath();
    context.moveTo(LEFT, 20);
    context.lineTo(LEFT, FLOOR);
    context.moveTo(RIGHT, 20);
    context.lineTo(RIGHT, FLOOR);
    context.moveTo(LEFT, FLOOR);
    context.lineTo(RIGHT, FLOOR);
    context.stroke();
    context.restore();

    context.save();
    context.setLineDash([4, 6]);
    context.lineWidth = 1;
    context.strokeStyle = "rgb(190 92 77 / 72%)";
    context.beginPath();
    context.moveTo(LEFT + 1, DANGER_LINE);
    context.lineTo(RIGHT - 1, DANGER_LINE);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#9b6259";
    context.font = "500 10px 'Microsoft YaHei', sans-serif";
    context.textAlign = "right";
    context.fillText("结束线", RIGHT - 5, DANGER_LINE - 6);
    context.restore();

  }

  function drawAvatar(x, y, level, metrics, alpha = 1, squash = 0, angle = 0) {
    const stage = stages[level];
    if (!stage.image.complete || !stage.image.naturalWidth) return;
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.globalAlpha = alpha;
    const impactScale = 1 + Math.max(0, squash) * 0.08;
    context.scale(impactScale, impactScale);
    context.shadowColor = "rgb(48 88 76 / 22%)";
    context.shadowBlur = Math.min(8, metrics.diameter * 0.11);
    context.shadowOffsetY = 2;
    context.drawImage(
      stage.image,
      -metrics.imageX,
      -metrics.imageY,
      metrics.imageSize,
      metrics.imageSize,
    );
    context.restore();
  }

  function draw() {
    if (!context) return;
    drawBackground();

    const previewMetrics = metricsFor(currentLevel);
    const aimXClamped = clamp(aimX, LEFT + previewMetrics.w / 2, RIGHT - previewMetrics.w / 2);
    const previewY = DROP_Y + previewMetrics.h / 2;
    const previewBounds = pieceAabb({ level: currentLevel, x: aimXClamped, y: previewY, w: previewMetrics.w, h: previewMetrics.h, angle: 0 });
    context.save();
    context.setLineDash([3, 6]);
    context.strokeStyle = "rgb(48 109 94 / 44%)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(aimXClamped, previewBounds.bottom + 3);
    context.lineTo(aimXClamped, Math.min(DANGER_LINE - 4, previewBounds.bottom + 43));
    context.stroke();
    context.restore();
    drawAvatar(aimXClamped, previewY, currentLevel, previewMetrics, pendingDropId === null ? 0.78 : 0.38, 0, 0);

    pieces.slice().sort((a, b) => a.y - b.y).forEach((piece) => {
      drawAvatar(piece.x, piece.y, piece.level, piece, 1, piece.squash, piece.angle);
    });
    for (const particle of particles) {
      context.save();
      context.globalAlpha = Math.min(1, particle.life / particle.maxLife);
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function frame(timestamp) {
    if (!assetsReady) {
      lastFrame = timestamp;
      requestAnimationFrame(frame);
      return;
    }
    const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, 0.032) : 0;
    lastFrame = timestamp;
    if (!gameOver && dt > 0) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  updateInterface();
  updateTouchInstructions();
  resizeCanvas();
  assetRetryButton.addEventListener("click", () => loadStageAssets(true));
  loadStageAssets();
  requestAnimationFrame(frame);
})();
