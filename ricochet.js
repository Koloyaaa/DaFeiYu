(function () {
  "use strict";

  const WIDTH = 560;
  const HEIGHT = 760;
  const ARENA = { left: 22, right: 538, top: 22, bottom: 738 };
  const EMITTER = { x: WIDTH / 2, y: ARENA.bottom - 58 };
  const MIN_LAUNCH_INTERVAL = 350;
  const LAUNCH_SPEED = 520;
  const BASE_RADIUS = 17.5;
  const RADIUS_GROWTH = 1.1;
  const BEST_STEPS_STORAGE_KEY = "decompression-game-best-steps-v1";
  const TOTAL_PLAY_TIME_STORAGE_KEY = "decompression-game-total-play-ms-v1";
  const STAGE_ORDER = ["豆包", "Mistral", "Gemini", "MuseSpark", "GLM", "Qwen", "Kimi", "Grok", "Claude", "ChatGPT", "DeepSeek"];
  const manifest = window.FISH_ASSET_MANIFEST;
  const order = manifest && Array.isArray(manifest.progressionOrder) ? manifest.progressionOrder : STAGE_ORDER;
  const assets = new Map((manifest && Array.isArray(manifest.assets) ? manifest.assets : []).map((asset) => [asset.id, asset]));
  const stages = order.map((name, level) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", drawBoard);
    const asset = assets.get(name);
    image.src = asset ? asset.src : `./Assets/processed/${encodeURIComponent(name)}.webp?v=2`;
    return { name, level, image };
  });

  const canvas = document.getElementById("ricochet-board");
  const context = canvas.getContext("2d");
  const stepCountNode = document.getElementById("step-count");
  const shotCountNode = document.getElementById("shot-count");
  const bestStepsNode = document.getElementById("best-steps");
  const runTimeNode = document.getElementById("run-time");
  const totalPlayTimeNode = document.getElementById("total-play-time");
  const launchButton = document.getElementById("launch-button");
  const cooldownLabel = document.getElementById("cooldown-label");
  const cooldownProgress = document.getElementById("cooldown-progress");
  const gameStatus = document.getElementById("game-status");
  const arenaState = document.getElementById("arena-state");
  const winDialog = document.getElementById("win-dialog");
  const recordNotice = document.getElementById("record-notice");
  const restartButton = document.getElementById("restart-button");
  const dialogRestartButton = document.getElementById("dialog-restart");

  let balls = [];
  let nextBallId = 1;
  let totalSteps = 0;
  let shotCount = 0;
  let bestSteps = readBestSteps();
  let totalPlayTimeMs = readTotalPlayTime();
  let runPlayTimeMs = 0;
  let persistedRunPlayTimeMs = 0;
  let playClockResumedAt = null;
  let playStarted = false;
  let lastPlayTimeSaveAt = 0;
  let aimAngle = -Math.PI / 2;
  let lastLaunchAt = -Infinity;
  let lastFrameAt = 0;
  let animationFrameId = 0;
  let won = false;
  let pointerDownId = null;
  let lastCooldownText = "";
  let drawScaleX = 1;
  let drawScaleY = 1;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function radiusForLevel(level) {
    return BASE_RADIUS * Math.pow(RADIUS_GROWTH, level);
  }

  function tierForLevel(level) {
    if (level >= 10) return "#5387a8";
    if (level >= 8) return "#c8a24d";
    if (level >= 4) return "#8b9eac";
    return "#b28b62";
  }

  function formatCount(value) {
    return Math.max(0, Math.floor(value)).toLocaleString("zh-CN");
  }

  function readBestSteps() {
    try {
      const stored = window.localStorage.getItem(BEST_STEPS_STORAGE_KEY);
      if (stored === null) return null;
      const parsed = Number(stored);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function readTotalPlayTime() {
    try {
      const stored = window.localStorage.getItem(TOTAL_PLAY_TIME_STORAGE_KEY);
      if (stored === null) return 0;
      const parsed = Number(stored);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    } catch (_) {
      return 0;
    }
  }

  function saveBestSteps(value) {
    try {
      window.localStorage.setItem(BEST_STEPS_STORAGE_KEY, String(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function renderBestSteps() {
    bestStepsNode.textContent = bestSteps === null ? "尚无" : `${formatCount(bestSteps)} 步`;
  }

  function formatDuration(milliseconds) {
    const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    const pad = (value) => String(value).padStart(2, "0");
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(remainingSeconds)}` : `${pad(Math.floor(seconds / 60))}:${pad(remainingSeconds)}`;
  }

  function getRunPlayTime(now = performance.now()) {
    const currentSegment = playClockResumedAt === null ? 0 : Math.max(0, now - playClockResumedAt);
    return runPlayTimeMs + currentSegment;
  }

  function startPlayClock(now) {
    if (playStarted || won) return;
    playStarted = true;
    lastPlayTimeSaveAt = now;
    if (!document.hidden) playClockResumedAt = now;
  }

  function pausePlayClock(now = performance.now()) {
    if (playClockResumedAt === null) return;
    runPlayTimeMs += Math.max(0, now - playClockResumedAt);
    playClockResumedAt = null;
  }

  function persistPlayTime(now = performance.now()) {
    if (!playStarted) return;
    const currentRunMs = Math.floor(getRunPlayTime(now));
    const elapsedSinceSave = currentRunMs - persistedRunPlayTimeMs;
    if (elapsedSinceSave <= 0) return;
    totalPlayTimeMs += elapsedSinceSave;
    persistedRunPlayTimeMs = currentRunMs;
    try {
      window.localStorage.setItem(TOTAL_PLAY_TIME_STORAGE_KEY, String(totalPlayTimeMs));
    } catch (_) {
      // Keep the in-memory total for this page even when local storage is unavailable.
    }
  }

  function updateHud(now) {
    if (playStarted && now - lastPlayTimeSaveAt >= 1000) {
      persistPlayTime(now);
      lastPlayTimeSaveAt = now;
    }
    const stepsText = formatCount(totalSteps);
    const shotsText = formatCount(shotCount);
    if (stepCountNode.textContent !== stepsText) stepCountNode.textContent = stepsText;
    if (shotCountNode.textContent !== shotsText) shotCountNode.textContent = shotsText;
    const runTimeText = formatDuration(getRunPlayTime(now));
    const totalTimeText = formatDuration(totalPlayTimeMs + Math.max(0, getRunPlayTime(now) - persistedRunPlayTimeMs));
    if (runTimeNode.textContent !== runTimeText) runTimeNode.textContent = runTimeText;
    if (totalPlayTimeNode.textContent !== totalTimeText) totalPlayTimeNode.textContent = totalTimeText;

    const elapsed = now - lastLaunchAt;
    const fraction = lastLaunchAt === -Infinity ? 1 : clamp(elapsed / MIN_LAUNCH_INTERVAL, 0, 1);
    const remaining = Math.max(0, MIN_LAUNCH_INTERVAL - elapsed);
    const cooldownText = won
      ? "本局已结束"
      : remaining > 0
        ? `下一发还需 ${(remaining / 1000).toFixed(1)} 秒`
        : "准备就绪 · 最快每 0.35 秒发射一颗";

    launchButton.disabled = won || remaining > 0;
    cooldownProgress.style.transform = `scaleX(${fraction})`;
    if (cooldownText !== lastCooldownText) {
      cooldownLabel.textContent = cooldownText;
      lastCooldownText = cooldownText;
    }
  }

  function createBall(level, x, y, vx, vy) {
    const radius = radiusForLevel(level);
    return {
      id: nextBallId++,
      level,
      x,
      y,
      vx,
      vy,
      radius,
      mass: Math.pow(2, level),
    };
  }

  function fire() {
    const now = performance.now();
    if (won || now - lastLaunchAt < MIN_LAUNCH_INTERVAL) return false;

    startPlayClock(now);

    const vx = Math.cos(aimAngle) * LAUNCH_SPEED;
    const vy = Math.sin(aimAngle) * LAUNCH_SPEED;

    balls.push(createBall(0, EMITTER.x, EMITTER.y, vx, vy));
    totalSteps += 1;
    shotCount += 1;
    lastLaunchAt = now;
    arenaState.textContent = "弹射进行中";
    arenaState.classList.add("is-playing");
    arenaState.classList.remove("is-won");
    gameStatus.textContent = "豆包已发射，计入 1 步。";
    updateHud(now);
    return true;
  }

  function setAimFromPoint(x, y) {
    aimAngle = clamp(Math.atan2(y - EMITTER.y, x - EMITTER.x), -Math.PI + 0.16, -0.16);
  }

  function setAimFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    setAimFromPoint(x, y);
  }

  function resizeCanvas() {
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(WIDTH * pixelRatio);
    const pixelHeight = Math.round(HEIGHT * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    drawScaleX = canvas.width / WIDTH;
    drawScaleY = canvas.height / HEIGHT;
    context.setTransform(drawScaleX, 0, 0, drawScaleY, 0, 0);
    drawBoard();
  }

  function drawArena() {
    context.fillStyle = "#f4f9fb";
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.strokeStyle = "rgba(107, 143, 162, 0.08)";
    context.lineWidth = 1;
    for (let x = ARENA.left + 18; x < ARENA.right; x += 42) {
      context.beginPath();
      context.moveTo(x, ARENA.top + 2);
      context.lineTo(x, ARENA.bottom - 2);
      context.stroke();
    }
    for (let y = ARENA.top + 18; y < ARENA.bottom; y += 42) {
      context.beginPath();
      context.moveTo(ARENA.left + 2, y);
      context.lineTo(ARENA.right - 2, y);
      context.stroke();
    }

    context.fillStyle = "#dce8ed";
    context.fillRect(ARENA.left - 6, ARENA.top - 6, ARENA.right - ARENA.left + 12, 8);
    context.fillRect(ARENA.left - 6, ARENA.bottom - 2, ARENA.right - ARENA.left + 12, 8);
    context.fillRect(ARENA.left - 6, ARENA.top, 8, ARENA.bottom - ARENA.top);
    context.fillRect(ARENA.right - 2, ARENA.top, 8, ARENA.bottom - ARENA.top);
    context.strokeStyle = "#7996a5";
    context.lineWidth = 2;
    context.strokeRect(ARENA.left, ARENA.top, ARENA.right - ARENA.left, ARENA.bottom - ARENA.top);

    const dx = Math.cos(aimAngle);
    const dy = Math.sin(aimAngle);
    let wallDistance = 132;
    if (dx < 0) wallDistance = Math.min(wallDistance, (ARENA.left + 12 - EMITTER.x) / dx);
    if (dx > 0) wallDistance = Math.min(wallDistance, (ARENA.right - 12 - EMITTER.x) / dx);
    if (dy < 0) wallDistance = Math.min(wallDistance, (ARENA.top + 12 - EMITTER.y) / dy);
    context.save();
    context.setLineDash([4, 7]);
    context.strokeStyle = "rgba(49, 117, 153, 0.45)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(EMITTER.x, EMITTER.y);
    context.lineTo(EMITTER.x + dx * wallDistance, EMITTER.y + dy * wallDistance);
    context.stroke();
    context.restore();

    context.fillStyle = "#4f7f96";
    context.beginPath();
    context.arc(EMITTER.x, EMITTER.y, 4, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#a7c1ce";
    context.fillRect(EMITTER.x - 29, ARENA.bottom - 16, 58, 10);
  }

  function drawBall(ball) {
    const stage = stages[ball.level];
    const color = tierForLevel(ball.level);
    context.save();
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = "#ffffff";
    context.fillRect(ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);
    if (stage && stage.image.complete && stage.image.naturalWidth > 0) {
      context.drawImage(stage.image, ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);
    } else {
      context.fillStyle = color;
      context.fillRect(ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);
      context.fillStyle = "#ffffff";
      context.font = `700 ${Math.max(10, ball.radius * 0.65)}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(stage ? stage.name.slice(0, 1) : "?", ball.x, ball.y);
    }
    context.restore();

    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius - 0.5, 0, Math.PI * 2);
    context.strokeStyle = color;
    context.lineWidth = ball.level >= 8 ? 2.5 : 1.6;
    context.stroke();
  }

  function drawBoard() {
    if (!context) return;
    context.setTransform(drawScaleX, 0, 0, drawScaleY, 0, 0);
    drawArena();
    const orderedBalls = balls.slice().sort((a, b) => a.radius - b.radius);
    for (const ball of orderedBalls) drawBall(ball);
  }

  function bounceFromWalls(ball) {
    const minX = ARENA.left + ball.radius;
    const maxX = ARENA.right - ball.radius;
    const minY = ARENA.top + ball.radius;
    const maxY = ARENA.bottom - ball.radius;
    if (ball.x < minX) {
      ball.x = minX;
      if (ball.vx < 0) ball.vx = -ball.vx;
    } else if (ball.x > maxX) {
      ball.x = maxX;
      if (ball.vx > 0) ball.vx = -ball.vx;
    }
    if (ball.y < minY) {
      ball.y = minY;
      if (ball.vy < 0) ball.vy = -ball.vy;
    } else if (ball.y > maxY) {
      ball.y = maxY;
      if (ball.vy > 0) ball.vy = -ball.vy;
    }
  }

  function resolveElasticCollision(a, b, dx, dy, distance) {
    const safeDistance = distance || 0.0001;
    const nx = distance ? dx / safeDistance : 1;
    const ny = distance ? dy / safeDistance : 0;
    const overlap = a.radius + b.radius - distance;
    const totalMass = a.mass + b.mass;
    a.x -= nx * overlap * (b.mass / totalMass);
    a.y -= ny * overlap * (b.mass / totalMass);
    b.x += nx * overlap * (a.mass / totalMass);
    b.y += ny * overlap * (a.mass / totalMass);

    const relativeSpeed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (relativeSpeed >= 0) return;
    const impulse = (-2 * relativeSpeed) / (1 / a.mass + 1 / b.mass);
    a.vx -= (impulse * nx) / a.mass;
    a.vy -= (impulse * ny) / a.mass;
    b.vx += (impulse * nx) / b.mass;
    b.vy += (impulse * ny) / b.mass;
  }

  function mergeBalls(a, b) {
    const level = a.level + 1;
    const totalMass = a.mass + b.mass;
    const merged = createBall(
      level,
      (a.x * a.mass + b.x * b.mass) / totalMass,
      (a.y * a.mass + b.y * b.mass) / totalMass,
      (a.vx * a.mass + b.vx * b.mass) / totalMass,
      (a.vy * a.mass + b.vy * b.mass) / totalMass,
    );
    return merged;
  }

  function finishGame() {
    const finishedAt = performance.now();
    pausePlayClock(finishedAt);
    persistPlayTime(finishedAt);
    won = true;
    const isNewRecord = bestSteps === null || totalSteps < bestSteps;
    let recordWasSaved = true;
    if (isNewRecord) {
      bestSteps = totalSteps;
      recordWasSaved = saveBestSteps(bestSteps);
    }
    arenaState.textContent = "通关完成";
    arenaState.classList.remove("is-playing");
    arenaState.classList.add("is-won");
    gameStatus.textContent = `大肥鱼合成成功！本局消耗 ${formatCount(totalSteps)} 步。`;
    document.getElementById("final-steps").textContent = formatCount(totalSteps);
    document.getElementById("final-shots").textContent = formatCount(shotCount);
    document.getElementById("final-time").textContent = formatDuration(getRunPlayTime(finishedAt));
    recordNotice.hidden = !isNewRecord;
    recordNotice.textContent = recordWasSaved ? "新纪录！最佳步数已保存在本机。" : "新纪录！本机暂时无法保存这项纪录。";
    renderBestSteps();
    updateHud(finishedAt);
    if (typeof winDialog.showModal === "function") winDialog.showModal();
    else winDialog.setAttribute("open", "");
  }

  function simulateStep(delta) {
    for (const ball of balls) {
      ball.x += ball.vx * delta;
      ball.y += ball.vy * delta;
      bounceFromWalls(ball);
    }

    const mergeCandidates = [];
    const mergeIds = new Set();
    for (let i = 0; i < balls.length; i += 1) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j += 1) {
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDistance = a.radius + b.radius;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared >= minDistance * minDistance) continue;
        const distance = Math.sqrt(distanceSquared);

        if (a.level === b.level && !mergeIds.has(a.id) && !mergeIds.has(b.id) && a.level < stages.length - 1) {
          mergeIds.add(a.id);
          mergeIds.add(b.id);
          mergeCandidates.push([a, b]);
          continue;
        }
        resolveElasticCollision(a, b, dx, dy, distance);
      }
    }

    if (mergeCandidates.length) {
      const mergedBalls = [];
      const mergedLevels = [];
      for (const [a, b] of mergeCandidates) {
        const merged = mergeBalls(a, b);
        mergedBalls.push(merged);
        mergedLevels.push(merged.level);
      }
      balls = balls.filter((ball) => !mergeIds.has(ball.id));
      balls.push(...mergedBalls);
      const firstLevel = mergedLevels[0] - 1;
      const mergeText = mergedLevels.length === 1
        ? `${stages[firstLevel].name} × 2 → ${stages[firstLevel + 1].name}`
        : `${mergedLevels.length} 组合成完成，最高进化到 ${stages[Math.max(...mergedLevels)].name}`;
      gameStatus.textContent = `${mergeText}。`;
      if (mergedLevels.includes(stages.length - 1)) finishGame();
    }
  }

  function animate(now) {
    animationFrameId = 0;
    if (!lastFrameAt) lastFrameAt = now;
    const elapsed = clamp((now - lastFrameAt) / 1000, 0, 0.04);
    lastFrameAt = now;
    if (!won && elapsed > 0) {
      const substeps = Math.max(1, Math.ceil(elapsed / (1 / 144)));
      const delta = elapsed / substeps;
      for (let i = 0; i < substeps && !won; i += 1) simulateStep(delta);
    }
    updateHud(now);
    drawBoard();
    if (!won) animationFrameId = window.requestAnimationFrame(animate);
  }

  function resetGame() {
    const now = performance.now();
    pausePlayClock(now);
    persistPlayTime(now);
    if (winDialog.open && typeof winDialog.close === "function") winDialog.close();
    balls = [];
    nextBallId = 1;
    totalSteps = 0;
    shotCount = 0;
    runPlayTimeMs = 0;
    persistedRunPlayTimeMs = 0;
    playClockResumedAt = null;
    playStarted = false;
    lastPlayTimeSaveAt = now;
    aimAngle = -Math.PI / 2;
    lastLaunchAt = -Infinity;
    lastFrameAt = 0;
    lastCooldownText = "";
    won = false;
    pointerDownId = null;
    arenaState.textContent = "等待发射";
    arenaState.classList.remove("is-playing", "is-won");
    gameStatus.textContent = "只发射豆包。两个同阶角色碰撞后，会合成下一阶。";
    recordNotice.hidden = true;
    renderBestSteps();
    updateHud(now);
    drawBoard();
    if (!animationFrameId) animationFrameId = window.requestAnimationFrame(animate);
  }

  launchButton.addEventListener("click", fire);
  restartButton.addEventListener("click", resetGame);
  dialogRestartButton.addEventListener("click", resetGame);

  canvas.addEventListener("pointermove", (event) => {
    if (won) return;
    if (event.pointerType === "mouse" || event.pointerId === pointerDownId) setAimFromEvent(event);
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (won || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    pointerDownId = event.pointerId;
    setAimFromEvent(event);
    if (typeof canvas.setPointerCapture === "function") canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener("pointerup", (event) => {
    if (pointerDownId !== event.pointerId) return;
    setAimFromEvent(event);
    pointerDownId = null;
    fire();
  });
  canvas.addEventListener("pointercancel", () => { pointerDownId = null; });
  canvas.addEventListener("lostpointercapture", () => { pointerDownId = null; });

  document.addEventListener("keydown", (event) => {
    if (won || (event.target instanceof Element && event.target.closest("button, a, input, select, textarea, dialog"))) return;
    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      fire();
    } else if (event.code === "ArrowLeft") {
      event.preventDefault();
      aimAngle = clamp(aimAngle - 0.04, -Math.PI + 0.16, -0.16);
    } else if (event.code === "ArrowRight") {
      event.preventDefault();
      aimAngle = clamp(aimAngle + 0.04, -Math.PI + 0.16, -0.16);
    }
  });

  document.addEventListener("visibilitychange", () => {
    const now = performance.now();
    if (document.hidden) {
      pausePlayClock(now);
      persistPlayTime(now);
    } else if (playStarted && !won) {
      playClockResumedAt = now;
      lastPlayTimeSaveAt = now;
      updateHud(now);
    }
  });

  window.addEventListener("pagehide", () => {
    const now = performance.now();
    pausePlayClock(now);
    persistPlayTime(now);
  });

  if (typeof ResizeObserver === "function") {
    new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }

  resizeCanvas();
  renderBestSteps();
  updateHud(performance.now());
  animationFrameId = window.requestAnimationFrame(animate);
})();
