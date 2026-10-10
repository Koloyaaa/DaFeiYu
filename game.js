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
  const DANGER_LINE = 118;
  const DROP_Y = 66;
  const DROP_INTERVAL = 0.35;
  const HAMMER_COST = 2000;
  const HAMMER_COST_LABEL = HAMMER_COST.toLocaleString("zh-CN");
  const BASE_HAMMER_USES = 3;
  const HAMMER_USES_PER_REVIVE = 2;
  const ITEMS_STORAGE_KEY = "big-fish-items-v1";
  const COMBO_WINDOW_MS = 350;
  const COMBO_BONUS_RATE = 0.1;
  const GRAVITY = 1450;
  const BASE_SIZE = 45;
  const CHARACTER_SIZE_SCALE = 1;
  const SIZE_GROWTH_THROUGH_GLM = 1.202;
  const SIZE_GROWTH_THROUGH_CLAUDE = 1.168;
  const SIZE_GROWTH_AFTER_CLAUDE = 1.145;
  const PHYSICS_SUBSTEPS = 3;
  const POSITION_ITERATIONS = 4;
  const MAX_ANGULAR_SPEED = 0.72;
  const STARTER_WEIGHTS = [40, 25, 16, 10, 6, 3];
  const SLEEP_LINEAR_SPEED = 18;
  const SLEEP_ANGULAR_SPEED = 0.08;
  const SLEEP_DELAY = 0.45;
  const MIN_BOUNCE_SPEED = 55; // Ignore soft impacts so settled stacks stay still.
  const BOUNCE_RESTITUTION = 0.38;
  const WALL_RESTITUTION = 0.45;
  const SQUASH_DECAY = 9;
  const SQUASH_MAX = 0.3;
  const FRICTION_COEFFICIENT = 0.26;
  const COLLISION_POLYGON_SCALE = 0.99;
  const COLLISION_SLOP = 3; // Let crowded stacks overlap slightly instead of pushing apart.
  const SLEEP_WAKE_SPEED = MIN_BOUNCE_SPEED;
  const SLEEP_WAKE_PENETRATION = COLLISION_SLOP + 8;
  const MERGE_PROXIMITY_MIN = 4;
  const MERGE_PROXIMITY_MAX = 8;
  const geometryCache = new WeakMap();
  const stageOrder = manifest.progressionOrder;
  const glmLevel = stageOrder.indexOf("GLM");
  const claudeLevel = stageOrder.indexOf("Claude");
  const sizeMultiplierByLevel = [1];
  for (let level = 1; level < stageOrder.length; level += 1) {
    const growth = level <= glmLevel
      ? SIZE_GROWTH_THROUGH_GLM
      : level <= claudeLevel
        ? SIZE_GROWTH_THROUGH_CLAUDE
        : SIZE_GROWTH_AFTER_CLAUDE;
    sizeMultiplierByLevel.push(sizeMultiplierByLevel[level - 1] * growth);
  }
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
  const loaderCharacter = document.querySelector(".asset-loader-character");
  const fontAwesomeLink = document.getElementById("fontawesome-css");
  const resultCopy = document.getElementById("result-copy");
  const resultTitle = document.getElementById("result-title");
  const resultScore = document.getElementById("result-score");
  const resultLeaderboardStatus = document.getElementById("result-leaderboard-status");
  const resultAvatar = document.getElementById("result-avatar");
  const touchInstructions = document.getElementById("touch-instructions");
  const achievementDialog = document.getElementById("achievement-dialog");
  const achievementTier = document.getElementById("achievement-tier");
  const achievementTitle = document.getElementById("achievement-title");
  const achievementCopy = document.getElementById("achievement-copy");
  const achievementAvatar = document.getElementById("achievement-avatar");
  const achievementCaption = document.getElementById("achievement-caption");
  const achievementContinue = document.getElementById("achievement-continue");
  const hammerButton = document.getElementById("hammer-button");
  const hammerButtonNote = document.getElementById("hammer-button-note");
  const reviveCardCountNode = document.getElementById("revive-card-count");
  const bigFishProgressNode = document.getElementById("big-fish-progress");
  const itemStatus = document.getElementById("item-status");
  const reviveButton = document.getElementById("dialog-revive");

  const hasTouchInput = (navigator.maxTouchPoints || 0) > 0
    || (window.matchMedia && window.matchMedia("(any-pointer: coarse)").matches);
  if (hasTouchInput) document.body.classList.add("has-touch-input");

  const collectionRows = stages.map((stage, index) => {
    const row = document.createElement("li");
    const tier = tierForLevel(index);
    row.className = `collection-item tier-${tier}`;
    row.dataset.tier = tierLabel(tier);
    row.setAttribute("aria-label", `${stage.id}，${tierLabel(tier)}角色`);
    row.innerHTML = `<span class="collection-rank">${String(index + 1).padStart(2, "0")}</span><img alt="" src="${stage.src}"><span class="collection-name"></span><span class="collection-state"></span>`;
    row.querySelector(".collection-name").textContent = stage.id;
    collectionList.appendChild(row);
    return row;
  });

  let pieces = [];
  let particles = [];
  let score = 0;
  let scoreEarned = 0;
  let scoreSpent = 0;
  let runIntegrityCompromised = false;
  let scoreSubmissionStarted = false;
  let itemStorageCompromised = false;
  let itemState = loadItemState();
  let celebratedStagesThisGame = new Set();
  let comboCount = 0;
  let comboBasePoints = 0;
  let comboAwardedBonus = 0;
  let comboLastMergeAt = -Infinity;
  let pendingComboToast = null;
  let pendingResultComboToast = null;
  let hammersUsed = 0;
  let revivalsUsedThisGame = 0;
  let hammerTargeting = false;
  let hammerAimY = H * 0.55;
  let record = readNumber("big-fish-record", 0);
  let currentLevel = randomStarter();
  let nextLevel = randomStarter();
  let highestLevel = Math.max(currentLevel, nextLevel);
  let aimX = W / 2;
  let gameOver = false;
  let pendingDropId = null;
  let activeTouchGesture = null;
  let lastFrame = 0;
  let simulationTime = 0;
  let lastDropAt = -Infinity;
  let nextPieceId = 1;
  let toastTimer = 0;
  let assetsReady = false;
  let assetLoadRun = 0;
  const loadedStageIds = new Set();
  const startupState = {
    loaderImage: false,
    fontStylesheet: false,
    solidIconFont: false,
    brandIconFont: false,
    database: false,
  };

  function readNumber(key, fallback) {
    try {
      const value = Number(window.localStorage.getItem(key));
      return Number.isFinite(value) ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function tierForLevel(level) {
    if (level < 4) return "bronze";
    if (level < 8) return "silver";
    if (level < stages.length - 1) return "gold";
    return "supreme";
  }

  function tierLabel(tier) {
    return ({ bronze: "青铜", silver: "白银", gold: "黄金", supreme: "至尊" })[tier] || "";
  }

  function showAchievement(level, details = {}) {
    const tier = tierForLevel(level);
    if (tier !== "gold" && tier !== "supreme") return false;
    const stage = stages[level];
    if (celebratedStagesThisGame.has(stage.id)) return false;

    celebratedStagesThisGame.add(stage.id);

    achievementTier.textContent = `${tierLabel(tier)}角色 · 本局首次合成`;
    achievementTitle.textContent = tier === "supreme"
      ? "恭喜用户合成出了至尊角色——大肥鱼"
      : `恭喜用户合成出了黄金角色——${stage.id}`;
    achievementAvatar.src = stage.src;
    achievementAvatar.alt = `${stage.id}头像`;
    achievementCaption.textContent = `${stage.id} · ${tierLabel(tier)}角色`;
    achievementCopy.textContent = tier === "supreme"
      ? details.earnsCard
        ? `两条大肥鱼合成了 1 张复活卡；当前共有 ${itemState.reviveCards} 张。关闭后游戏继续。`
        : details.saved
          ? "大肥鱼已加入图鉴；再合成一条即可获得复活卡。关闭后游戏继续。"
          : "大肥鱼合成成功，但本地道具进度没有保存。关闭后游戏继续。"
      : "新角色已经加入图鉴。关闭弹窗后，本局会从当前局面继续。";
    announcer.textContent = achievementTitle.textContent;
    if (!achievementDialog.open && typeof achievementDialog.showModal === "function") {
      achievementDialog.showModal();
      achievementContinue.focus({ preventScroll: true });
    }
    return true;
  }

  function itemStateProof(reviveCards, bigFishProgress) {
    // This detects casual localStorage edits. Browser-side code is public, so it is not a secret signature.
    const source = `big-fish-items-v1:${reviveCards}:${bigFishProgress}:local-integrity`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function loadItemState() {
    const emptyState = { reviveCards: 0, bigFishProgress: 0 };
    try {
      const stored = window.localStorage.getItem(ITEMS_STORAGE_KEY);
      if (stored === null) return emptyState;
      const parsed = JSON.parse(stored);
      const validCounts = parsed
        && parsed.version === 1
        && Number.isSafeInteger(parsed.reviveCards)
        && parsed.reviveCards >= 0
        && parsed.reviveCards <= 9999
        && Number.isSafeInteger(parsed.bigFishProgress)
        && (parsed.bigFishProgress === 0 || parsed.bigFishProgress === 1);
      if (!validCounts || parsed.proof !== itemStateProof(parsed.reviveCards, parsed.bigFishProgress)) {
        itemStorageCompromised = true;
        return emptyState;
      }
      return { reviveCards: parsed.reviveCards, bigFishProgress: parsed.bigFishProgress };
    } catch (_) {
      itemStorageCompromised = true;
      return emptyState;
    }
  }

  function saveItemState(nextState) {
    const validCounts = Number.isSafeInteger(nextState.reviveCards)
      && nextState.reviveCards >= 0
      && nextState.reviveCards <= 9999
      && Number.isSafeInteger(nextState.bigFishProgress)
      && (nextState.bigFishProgress === 0 || nextState.bigFishProgress === 1);
    if (!validCounts || itemStorageCompromised) return false;
    const stored = {
      version: 1,
      reviveCards: nextState.reviveCards,
      bigFishProgress: nextState.bigFishProgress,
      proof: itemStateProof(nextState.reviveCards, nextState.bigFishProgress),
    };
    try {
      window.localStorage.setItem(ITEMS_STORAGE_KEY, JSON.stringify(stored));
      itemState = { reviveCards: stored.reviveCards, bigFishProgress: stored.bigFishProgress };
      return true;
    } catch (_) {
      return false;
    }
  }

  function hammerUseLimit() {
    return BASE_HAMMER_USES + revivalsUsedThisGame * HAMMER_USES_PER_REVIVE;
  }

  function runIntegrityIsValid() {
    const expectedScore = scoreEarned - scoreSpent;
    return !runIntegrityCompromised
      && Number.isSafeInteger(score)
      && Number.isSafeInteger(scoreEarned)
      && Number.isSafeInteger(scoreSpent)
      && Number.isSafeInteger(hammersUsed)
      && Number.isSafeInteger(revivalsUsedThisGame)
      && scoreEarned >= 0
      && scoreSpent >= 0
      && score === expectedScore
      && score >= 0
      && !itemStorageCompromised
      && scoreSpent === hammersUsed * HAMMER_COST
      && hammersUsed <= hammerUseLimit();
  }

  function updateItemInterface() {
    const hammerLimit = hammerUseLimit();
    const remainingUses = Math.max(0, hammerLimit - hammersUsed);
    const profileReady = window.FishLeaderboard && window.FishLeaderboard.isProfileReady();
    hammerButtonNote.textContent = hammerTargeting
      ? `瞄准中 · ${hammersUsed} / ${hammerLimit}`
      : `已用 ${hammersUsed} / ${hammerLimit} · ${HAMMER_COST_LABEL} 积分`;
    hammerButton.classList.toggle("is-selected", hammerTargeting);
    hammerButton.setAttribute("aria-pressed", String(hammerTargeting));
    hammerButton.disabled = !assetsReady
      || !profileReady
      || gameOver
      || (remainingUses <= 0 && !hammerTargeting)
      || (!hammerTargeting && score < HAMMER_COST)
      || itemStorageCompromised;
    reviveCardCountNode.textContent = String(itemState.reviveCards);
    bigFishProgressNode.textContent = `大肥鱼 ${itemState.bigFishProgress} / 2`;
    reviveButton.hidden = !gameOver || itemState.reviveCards <= 0;
    if (gameOver && itemState.reviveCards > 0) {
      reviveButton.textContent = `使用 1 张复活卡（再获 2 次重锤）`;
    }
  }

  function setItemStatus(message) {
    itemStatus.textContent = message;
  }

  function randomStarter() {
    let roll = Math.random() * 100;
    for (let level = 0; level < STARTER_WEIGHTS.length; level += 1) {
      roll -= STARTER_WEIGHTS[level];
      if (roll < 0) return level;
    }
    return STARTER_WEIGHTS.length - 1;
  }

  function updateAssetProgress(run) {
    if (run !== assetLoadRun) return;
    const total = stages.length + 5;
    const completed = loadedStageIds.size + Object.values(startupState).filter(Boolean).length;
    const percent = Math.round((completed / total) * 100);
    assetProgress.style.width = `${percent}%`;
    assetProgress.parentElement.setAttribute("aria-valuenow", String(percent));
    assetLoadingCount.textContent = `干饭进度：${percent}%（${completed}/${total}）`;
    assetLoadingTitle.textContent = completed === total ? "准备完成" : "正在干饭";
  }

  function cacheBustedUrl(source, label) {
    const url = new URL(source, document.baseURI);
    url.searchParams.set("reload", `${Date.now()}-${label}`);
    return url.href;
  }

  function waitForImage(image) {
    if (image.complete) {
      return image.naturalWidth > 0
        ? Promise.resolve()
        : Promise.reject(new Error("图片无法读取"));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => finish(false), 12000);
      const finish = (success) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
        if (success) resolve();
        else reject(new Error("图片加载失败"));
      };
      const onLoad = () => finish(true);
      const onError = () => finish(false);
      image.addEventListener("load", onLoad, { once: true });
      image.addEventListener("error", onError, { once: true });
      if (image.complete) queueMicrotask(() => finish(image.naturalWidth > 0));
    });
  }

  async function loadImageWithRetry(image, source, label, refreshFirst = false) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      image.src = refreshFirst || attempt > 0
        ? cacheBustedUrl(source, `${label}-${attempt}`)
        : source;
      try {
        await waitForImage(image);
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
    }
    throw lastError || new Error("图片加载失败");
  }

  function waitForFontStylesheet(retry) {
    if (!fontAwesomeLink) return Promise.reject(new Error("找不到 Font Awesome 样式"));
    if (!retry && fontAwesomeLink.dataset.loadState === "loaded") {
      return Promise.resolve();
    }
    if (!retry && fontAwesomeLink.dataset.loadState === "error") {
      return Promise.reject(new Error("Font Awesome 样式加载失败"));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timer);
        fontAwesomeLink.removeEventListener("load", onLoad);
        fontAwesomeLink.removeEventListener("error", onError);
      };
      const finish = (success) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (success) resolve();
        else reject(new Error("Font Awesome 样式加载失败"));
      };
      const onLoad = () => finish(true);
      const onError = () => finish(false);
      const timer = window.setTimeout(() => finish(false), 12000);
      fontAwesomeLink.addEventListener("load", onLoad, { once: true });
      fontAwesomeLink.addEventListener("error", onError, { once: true });
      if (retry) {
        const url = new URL(fontAwesomeLink.href);
        url.searchParams.set("reload", String(Date.now()));
        fontAwesomeLink.dataset.loadState = "loading";
        fontAwesomeLink.href = url.href;
      } else if (fontAwesomeLink.dataset.loadState === "loaded") {
        finish(true);
      } else if (fontAwesomeLink.dataset.loadState === "error") {
        finish(false);
      }
    });
  }

  async function loadIconFont(declaration, glyph) {
    if (!document.fonts || typeof document.fonts.load !== "function") {
      throw new Error("浏览器无法检查图标字体");
    }
    let timeout;
    try {
      const faces = await Promise.race([
        document.fonts.load(declaration, glyph),
        new Promise((_, reject) => {
          timeout = window.setTimeout(() => reject(new Error("图标字体加载超时")), 12000);
        }),
      ]);
      if (!faces.length || !faces.some((face) => face.status === "loaded")) {
        throw new Error("图标字体加载失败");
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function loadStageAssets(retryFailedOnly = false) {
    const run = ++assetLoadRun;
    const targets = retryFailedOnly ? stages.filter((stage) => stage.loadFailed) : stages;
    const failures = [];
    assetsReady = false;
    assetLoader.hidden = false;
    assetRetryButton.hidden = true;
    assetLoadingTitle.textContent = "正在干饭";
    assetLoadingMessage.textContent = "大肥鱼正在偷吃用户的白饭，吃完这碗就来玩！";

    const tasks = targets.map(async (stage) => {
      try {
        await loadImageWithRetry(stage.image, stage.src, stage.index, retryFailedOnly);
        stage.loadFailed = false;
        loadedStageIds.add(stage.id);
      } catch (_) {
        stage.loadFailed = true;
        loadedStageIds.delete(stage.id);
        failures.push(`${stage.id} 图片`);
      }
      updateAssetProgress(run);
    });

    if (!startupState.loaderImage) {
      tasks.push((async () => {
        try {
          await loadImageWithRetry(loaderCharacter, loaderCharacter.getAttribute("src"), "loader", retryFailedOnly);
          startupState.loaderImage = true;
        } catch (_) {
          failures.push("加载页插画");
        }
        updateAssetProgress(run);
      })());
    }

    const retryFontStylesheet = retryFailedOnly && (!startupState.solidIconFont || !startupState.brandIconFont);
    if (retryFontStylesheet) startupState.fontStylesheet = false;
    let stylesheetPromise;
    const ensureStylesheet = () => {
      if (!stylesheetPromise) {
        stylesheetPromise = (async () => {
          if (startupState.fontStylesheet) return;
          await waitForFontStylesheet(retryFontStylesheet);
          startupState.fontStylesheet = true;
          updateAssetProgress(run);
        })();
      }
      return stylesheetPromise;
    };

    const iconFonts = [
      { key: "solidIconFont", declaration: '900 1em "Font Awesome 7 Free"', glyph: "\uf2f1", label: "Font Awesome 实心图标" },
      { key: "brandIconFont", declaration: '400 1em "Font Awesome 7 Brands"', glyph: "\uf09b", label: "GitHub 品牌图标" },
    ];
    for (const font of iconFonts) {
      if (startupState[font.key]) continue;
      tasks.push((async () => {
        try {
          await ensureStylesheet();
          await loadIconFont(font.declaration, font.glyph);
          startupState[font.key] = true;
        } catch (_) {
          failures.push(font.label);
        }
        updateAssetProgress(run);
      })());
    }

    if (!startupState.database) {
      tasks.push((async () => {
        try {
          const leaderboard = window.FishLeaderboard;
          if (!leaderboard) throw new Error("排行榜模块不可用");
          const result = retryFailedOnly ? await leaderboard.connect() : await leaderboard.connectionReady;
          if (result === null) throw new Error("排行榜连接失败");
          startupState.database = true;
        } catch (_) {
          failures.push("全球排行榜连接");
        }
        updateAssetProgress(run);
      })());
    }

    updateAssetProgress(run);
    await Promise.all(tasks);
    if (run !== assetLoadRun) return;

    if (failures.length) {
      assetLoadingTitle.textContent = "暂时无法开始";
      assetLoadingMessage.textContent = `${[...new Set(failures)].join("、")}未能完成，请检查网络后重试。`;
      assetRetryButton.textContent = "重试加载与连接";
      assetRetryButton.hidden = false;
      assetRetryButton.focus({ preventScroll: true });
      return;
    }

    assetLoadingTitle.textContent = "准备完成";
    assetLoadingMessage.textContent = "资源已加载，排行榜已连接。";
    await new Promise((resolve) => window.setTimeout(resolve, 360));
    if (run !== assetLoadRun) return;
    assetLoader.hidden = true;
    assetsReady = true;
    lastFrame = 0;
    draw();
    if (!window.FishLeaderboard.isProfileReady()) window.FishLeaderboard.openProfileSetup();
  }

  function metricsFor(level) {
    const stage = stages[level];
    const bounds = stage.collision.bounds;
    const characterScale = stage.id === "豆包" ? 0.85 : 1;
    const diameter = BASE_SIZE * 0.75 * CHARACTER_SIZE_SCALE * sizeMultiplierByLevel[level] * characterScale;
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
    const previewScale = stages[nextLevel].id === "豆包" ? 0.85 : 1;
    const previewSize = Math.min(108, Math.max(60, metricsFor(nextLevel).diameter * 1.52)) * previewScale;
    nextImage.src = upcoming.src;
    nextImage.style.width = `${previewSize}px`;
    nextImage.style.height = `${previewSize}px`;
    nextName.textContent = upcoming.id;
    nextRank.textContent = String(nextLevel + 1).padStart(2, "0");
    updateItemInterface();
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
      squashAngle: 0,
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
      ? "本局结束"
      : hammerTargeting
        ? "重锤已选中：轻点一个角色砸掉；再次点重锤可取消。"
      : "轻点即落下；按住拖动选位，松手放置。";
  }

  function dropCharacter() {
    if (!window.FishLeaderboard || !window.FishLeaderboard.isProfileReady() || !assetsReady || gameOver) return;
    if (simulationTime - lastDropAt < DROP_INTERVAL) return;
    const metrics = metricsFor(currentLevel);
    const x = clamp(aimX, LEFT + metrics.w / 2, RIGHT - metrics.w / 2);
    const dropped = addPiece(currentLevel, x, DROP_Y + metrics.h / 2);
    lastDropAt = simulationTime;
    setPendingDrop(dropped.id);
    highestLevel = Math.max(highestLevel, currentLevel);
    currentLevel = nextLevel;
    nextLevel = randomStarter();
    highestLevel = Math.max(highestLevel, currentLevel, nextLevel);
    updateInterface();
    announcer.textContent = `放下了 ${stages[dropped.level].id}。`;
  }

  function pointInPolygon(x, y, vertices) {
    let inside = false;
    const count = vertices.length / 2;
    for (let index = 0, previous = count - 1; index < count; previous = index, index += 1) {
      const currentX = vertices[index * 2];
      const currentY = vertices[index * 2 + 1];
      const previousX = vertices[previous * 2];
      const previousY = vertices[previous * 2 + 1];
      const crosses = (currentY > y) !== (previousY > y)
        && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function findHammerTarget(x, y) {
    return pieces
      .filter((piece) => {
        const geometry = pieceGeometry(piece);
        const bounds = geometry.bounds;
        return x >= bounds.left && x <= bounds.right
          && y >= bounds.top && y <= bounds.bottom
          && pointInPolygon(x, y, geometry.vertices);
      })
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0] || null;
  }

  function beginHammerTargeting() {
    if (!assetsReady || gameOver || !window.FishLeaderboard?.isProfileReady()) return;
    if (hammerTargeting) {
      hammerTargeting = false;
      updateTouchInstructions();
      updateInterface();
      setItemStatus("已取消重锤瞄准，没有消耗积分。");
      return;
    }
    if (itemStorageCompromised) {
      setItemStatus("本地道具存档校验失败，道具已停用。");
      return;
    }
    if (!runIntegrityIsValid()) {
      runIntegrityCompromised = true;
      setItemStatus("本局数据校验失败，道具已停用。");
      updateInterface();
      return;
    }
    if (hammersUsed >= hammerUseLimit()) {
      setItemStatus(`本局重锤次数已用完（${hammerUseLimit()} 次）。`);
      return;
    }
    if (score < HAMMER_COST) {
      setItemStatus(`本局积分不足：需要 ${HAMMER_COST.toLocaleString("zh-CN")} 分。`);
      return;
    }
    hammerTargeting = true;
    hammerAimY = clamp(hammerAimY, 24, FLOOR - 12);
    updateTouchInstructions();
    updateInterface();
    setItemStatus(`重锤已就绪：点一个角色砸掉；Esc 可取消。命中后才扣 ${HAMMER_COST_LABEL} 分。`);
    canvas.focus({ preventScroll: true });
    draw();
  }

  function cancelHammerTargeting(message) {
    if (!hammerTargeting) return;
    hammerTargeting = false;
    updateTouchInstructions();
    updateInterface();
    if (message) setItemStatus(message);
    draw();
  }

  function useHammerAt(x, y) {
    if (!hammerTargeting || gameOver) return;
    if (!runIntegrityIsValid() || itemStorageCompromised) {
      runIntegrityCompromised = true;
      cancelHammerTargeting("本局数据校验失败，道具已停用。");
      return;
    }
    if (hammersUsed >= hammerUseLimit() || score < HAMMER_COST) {
      cancelHammerTargeting("重锤次数或积分不足，没有消耗道具。");
      return;
    }
    const target = findHammerTarget(x, y);
    if (!target) {
      setItemStatus("没有点中角色，请点在角色图案上；Esc 可取消。");
      return;
    }

    const nextScoreSpent = scoreSpent + HAMMER_COST;
    if (scoreEarned - nextScoreSpent < 0) {
      runIntegrityCompromised = true;
      cancelHammerTargeting("本局积分流水校验失败，道具已停用。");
      return;
    }
    wakeSupportedPieces(target);
    pieces = pieces.filter((piece) => piece.id !== target.id);
    if (target.id === pendingDropId) setPendingDrop(null);
    scoreSpent = nextScoreSpent;
    score = scoreEarned - scoreSpent;
    hammersUsed += 1;
    hammerTargeting = false;
    updateTouchInstructions();
    updateInterface();
    setItemStatus(`重锤砸掉了 ${stages[target.level].id}，扣除 ${HAMMER_COST_LABEL} 分。`);
    announcer.textContent = `重锤砸掉了 ${stages[target.level].id}。`;
    showToast(`重锤命中：${stages[target.level].id}`);
    if (!runIntegrityIsValid()) runIntegrityCompromised = true;
    draw();
  }

  function reviveRun() {
    if (!gameOver || itemStorageCompromised || itemState.reviveCards < 1) return;
    if (!runIntegrityIsValid()) {
      runIntegrityCompromised = true;
      setItemStatus("本局数据校验失败，无法使用复活卡。");
      return;
    }
    const nextItems = { ...itemState, reviveCards: itemState.reviveCards - 1 };
    if (!saveItemState(nextItems)) {
      setItemStatus("无法保存道具库存，复活卡没有被消耗。");
      return;
    }

    const removedIds = new Set(
      pieces.filter((piece) => pieceSilhouetteAabb(piece).top < DANGER_LINE).map((piece) => piece.id),
    );
    for (const piece of pieces) {
      if (removedIds.has(piece.id)) wakeSupportedPieces(piece);
    }
    pieces = pieces.filter((piece) => !removedIds.has(piece.id));
    if (removedIds.has(pendingDropId)) setPendingDrop(null);
    pieces.forEach((piece) => {
      piece.dangerTime = 0;
      wakePiece(piece);
    });

    gameOver = false;
    revivalsUsedThisGame += 1;
    scoreSubmissionStarted = false;
    hammerTargeting = false;
    activeTouchGesture = null;
    if (dialog.open) dialog.close();
    resultLeaderboardStatus.hidden = true;
    updateTouchInstructions();
    updateInterface();
    setItemStatus(`已使用复活卡，清除了 ${removedIds.size} 个危险区角色；本局重锤上限增加 2 次。`);
    announcer.textContent = "复活成功，本局重锤次数增加 2 次。";
    draw();
  }

  function pointerX(event) {
    const bounds = canvas.getBoundingClientRect();
    return clamp(((event.clientX - bounds.left) / bounds.width) * W, LEFT + 14, RIGHT - 14);
  }

  function pointerY(event) {
    const bounds = canvas.getBoundingClientRect();
    return clamp(((event.clientY - bounds.top) / bounds.height) * H, 20, FLOOR - 8);
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
      if (hammerTargeting) hammerAimY = pointerY(event);
      return;
    }
    const gesture = activeTouchGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    aimX = pointerX(event);
    if (gesture.usingHammer) hammerAimY = pointerY(event);
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (!window.FishLeaderboard || !window.FishLeaderboard.isProfileReady()) return;
    event.preventDefault();
    if (!assetsReady || gameOver) return;
    canvas.focus({ preventScroll: true });
    if (event.pointerType === "mouse") {
      aimX = pointerX(event);
      if (hammerTargeting) {
        hammerAimY = pointerY(event);
        useHammerAt(aimX, hammerAimY);
        return;
      }
      dropCharacter();
      return;
    }
    document.body.classList.add("has-touch-input");
    if (activeTouchGesture) return;
    aimX = pointerX(event);
    if (hammerTargeting) hammerAimY = pointerY(event);
    activeTouchGesture = {
      pointerId: event.pointerId,
      usingHammer: hammerTargeting,
    };
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  });
  window.addEventListener("pointerup", (event) => {
    const gesture = activeTouchGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    activeTouchGesture = null;
    aimX = pointerX(event);
    if (gesture.usingHammer) {
      hammerAimY = pointerY(event);
      useHammerAt(aimX, hammerAimY);
    } else {
      dropCharacter();
    }
    updateTouchInstructions();
  });
  window.addEventListener("pointercancel", (event) => {
    if (activeTouchGesture?.pointerId === event.pointerId) activeTouchGesture = null;
  });
  document.getElementById("restart-button").addEventListener("click", restart);
  document.getElementById("dialog-restart").addEventListener("click", () => {
    if (gameOver) submitFinalScore();
    restart();
    canvas.focus({ preventScroll: true });
  });
  achievementContinue.addEventListener("click", () => {
    if (achievementDialog.open) achievementDialog.close();
  });
  achievementDialog.addEventListener("close", () => {
    if (pendingComboToast) {
      const combo = pendingComboToast;
      pendingComboToast = null;
      if (gameOver) pendingResultComboToast = combo;
      else showComboToast(combo.count, combo.totalBonus, combo.stageName);
    }
    if (gameOver && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    else if (!gameOver) canvas.focus({ preventScroll: true });
  });
  dialog.addEventListener("close", () => {
    if (!pendingResultComboToast) return;
    const combo = pendingResultComboToast;
    pendingResultComboToast = null;
    showComboToast(combo.count, combo.totalBonus, combo.stageName);
  });
  hammerButton.addEventListener("click", beginHammerTargeting);
  reviveButton.addEventListener("click", reviveRun);
  window.addEventListener("fish-profile-updated", updateItemInterface);
  window.addEventListener("fish-theme-change", draw);
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", (event) => {
    if (!window.FishLeaderboard || !window.FishLeaderboard.isProfileReady()) return;
    if (!assetsReady) return;
    const target = event.target;
    if (target instanceof HTMLButtonElement) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
    if (hammerTargeting) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelHammerTargeting("已取消重锤瞄准，没有消耗积分。");
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        aimX = clamp(aimX + (event.key === "ArrowLeft" ? -18 : 18), LEFT, RIGHT);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        hammerAimY = clamp(hammerAimY + (event.key === "ArrowUp" ? -18 : 18), 20, FLOOR - 8);
      } else if (event.code === "Space" || event.key === "Enter") {
        event.preventDefault();
        useHammerAt(aimX, hammerAimY);
      }
      return;
    }
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
    if (achievementDialog.open) achievementDialog.close();
    celebratedStagesThisGame.clear();
    comboCount = 0;
    comboBasePoints = 0;
    comboAwardedBonus = 0;
    comboLastMergeAt = -Infinity;
    pendingComboToast = null;
    pieces = [];
    particles = [];
    score = 0;
    scoreEarned = 0;
    scoreSpent = 0;
    runIntegrityCompromised = false;
    scoreSubmissionStarted = false;
    hammersUsed = 0;
    revivalsUsedThisGame = 0;
    hammerTargeting = false;
    hammerAimY = H * 0.55;
    currentLevel = randomStarter();
    nextLevel = randomStarter();
    highestLevel = Math.max(currentLevel, nextLevel);
    aimX = W / 2;
    gameOver = false;
    activeTouchGesture = null;
    setPendingDrop(null);
    simulationTime = 0;
    lastDropAt = -Infinity;
    updateInterface();
    toast.hidden = true;
    if (dialog.open) dialog.close();
    resultAvatar.hidden = true;
    resultLeaderboardStatus.hidden = true;
    updateTouchInstructions();
    updateItemInterface();
    setItemStatus(itemStorageCompromised
      ? "本地道具存档校验失败，道具已停用。"
      : `消耗 ${HAMMER_COST_LABEL} 本局积分换重锤，选中后点一个角色。`);
    announcer.textContent = "新的一局开始";
    draw();
  }

  function integratePiece(piece, dt) {
    piece.mergeLock = Math.max(0, piece.mergeLock - dt);
    piece.squash *= Math.exp(-dt * SQUASH_DECAY);
    if (piece.sleeping) return;
    piece.angularVelocity *= Math.pow(0.92, dt * 60);
    if (Math.abs(piece.angularVelocity) < 0.01) piece.angularVelocity = 0;
    const nextAngle = piece.angle + piece.angularVelocity * dt;
    if (fitsAngleInBin(piece.w, piece.h, nextAngle)) {
      piece.angle = nextAngle;
    } else {
      piece.angle = fitAngleToBin(piece.w, piece.h, piece.angle);
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
      const impactSpeed = Math.abs(piece.vx);
      piece.vx = impactSpeed > MIN_BOUNCE_SPEED ? impactSpeed * WALL_RESTITUTION : 0;
      if (impactSpeed > MIN_BOUNCE_SPEED) {
        piece.angularVelocity = clamp(piece.angularVelocity + clamp(piece.vy * 0.00015, -0.04, 0.04), -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
        squashPiece(piece, 1, 0, impactSpeed);
      }
    } else if (bounds.right > RIGHT) {
      piece.x -= bounds.right - RIGHT;
      const impactSpeed = Math.abs(piece.vx);
      piece.vx = impactSpeed > MIN_BOUNCE_SPEED ? -impactSpeed * WALL_RESTITUTION : 0;
      if (impactSpeed > MIN_BOUNCE_SPEED) {
        piece.angularVelocity = clamp(piece.angularVelocity - clamp(piece.vy * 0.00015, -0.04, 0.04), -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
        squashPiece(piece, -1, 0, impactSpeed);
      }
    }
    bounds = pieceSilhouetteAabb(piece);
    if (bounds.bottom > FLOOR) {
      piece.y -= bounds.bottom - FLOOR;
      if (piece.id === pendingDropId && piece.vy > 0) setPendingDrop(null);
      const impactSpeed = piece.vy;
      let normalImpulsePerMass = Math.max(0, impactSpeed);
      if (impactSpeed > MIN_BOUNCE_SPEED) {
        piece.vy = -piece.vy * WALL_RESTITUTION;
        normalImpulsePerMass += Math.abs(piece.vy);
        squashPiece(piece, 0, -1, impactSpeed);
        const floorContact = averageSupportPoint(pieceGeometry(piece).vertices, 0, 1, true);
        const spinInertia = (piece.w * piece.w + piece.h * piece.h) / 12;
        const floorOffsetX = floorContact.x - piece.x;
        const floorKick = clamp(-impactSpeed * floorOffsetX / spinInertia * piece.w * 0.035, -32, 32);
        const floorSpin = clamp(
          -impactSpeed * floorOffsetX / spinInertia * 0.04,
          -0.18,
          0.18,
        );
        piece.vx += floorKick;
        piece.angularVelocity = clamp(
          piece.angularVelocity + floorSpin + clamp(piece.vx * 0.00025, -0.08, 0.08),
          -MAX_ANGULAR_SPEED,
          MAX_ANGULAR_SPEED,
        );
      } else if (impactSpeed >= 0) {
        piece.vy = 0;
        normalImpulsePerMass = Math.max(normalImpulsePerMass, GRAVITY * dt);
      }
      // Coulomb friction: horizontal speed changes by μ times the floor's normal impulse.
      const maximumFrictionDelta = FRICTION_COEFFICIENT * normalImpulsePerMass;
      piece.vx = Math.abs(piece.vx) <= maximumFrictionDelta
        ? 0
        : piece.vx - Math.sign(piece.vx) * maximumFrictionDelta;
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
          const closingSpeed = -((b.vx - a.vx) * contact.nx + (b.vy - a.vy) * contact.ny);
          if (shouldWakeFromContact(a, closingSpeed, contact)) wakePiece(a);
          if (shouldWakeFromContact(b, closingSpeed, contact)) wakePiece(b);
          if (isPendingDropLanding(a, b)) setPendingDrop(null);
          resolveBounce(a, b, contact, iteration === 0);
        }

        for (const piece of pieces) clampPieceToBin(piece);
        if (merged || gameOver) break;
      }
      if (merged || gameOver) break;
    }

    const newlySleepingPieces = [];
    for (const piece of pieces) {
      if (updateSleepState(piece, dt)) newlySleepingPieces.push(piece);
    }

    // Only do near-miss checks when a piece settles, never on every frame.
    for (const piece of newlySleepingPieces) {
      const partner = findNearbyMergePartner(piece);
      if (!partner) continue;
      if (piece.id === pendingDropId || partner.id === pendingDropId) setPendingDrop(null);
      mergeCharacters(piece, partner);
      merged = true;
      break;
    }

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
    if (!piece.sleeping) return;
    piece.sleeping = false;
    piece.sleepTimer = 0;
    wakeSupportedPieces(piece);
  }

  function wakeSupportedPieces(support) {
    const supports = [support];
    const visited = new Set([support.id]);

    while (supports.length > 0) {
      const current = supports.pop();
      const currentGeometry = pieceGeometry(current);
      for (const candidate of pieces) {
        if (candidate.sleeping === false || visited.has(candidate.id)) continue;
        const candidateGeometry = pieceGeometry(candidate);
        if (!aabbsWithinDistance(candidateGeometry.bounds, currentGeometry.bounds, COLLISION_SLOP + 2)) continue;
        const contact = polygonPenetration(
          candidateGeometry.vertices,
          currentGeometry.vertices,
          candidate.id,
          current.id,
        );
        if (!contact || contact.ny <= 0.15) continue;

        candidate.sleeping = false;
        candidate.sleepTimer = 0;
        visited.add(candidate.id);
        supports.push(candidate);
      }
    }
  }

  function shouldWakeFromContact(piece, closingSpeed, contact) {
    return piece.sleeping && (
      closingSpeed > SLEEP_WAKE_SPEED ||
      contact.depth > SLEEP_WAKE_PENETRATION
    );
  }

  function updateSleepState(piece, dt) {
    if (piece.sleeping) return false;
    const slowEnough = Math.hypot(piece.vx, piece.vy) <= SLEEP_LINEAR_SPEED &&
      Math.abs(piece.angularVelocity) <= SLEEP_ANGULAR_SPEED;
    piece.sleepTimer = slowEnough ? piece.sleepTimer + dt : 0;
    if (piece.sleepTimer < SLEEP_DELAY) return false;
    if (!hasStableSupport(piece)) {
      piece.sleepTimer = 0;
      return false;
    }
    piece.vx = 0;
    piece.vy = 0;
    piece.angularVelocity = 0;
    piece.sleeping = true;
    return true;
  }

  function hasStableSupport(piece) {
    const bounds = pieceGeometry(piece).bounds;
    if (bounds.bottom >= FLOOR - 0.5) return true;

    let supportNormalX = 0;
    let supportNormalY = 0;
    const vertices = pieceGeometry(piece).vertices;
    for (const support of pieces) {
      if (support.id === piece.id || !support.sleeping) continue;
      const supportGeometry = pieceGeometry(support);
      if (!aabbsWithinDistance(bounds, supportGeometry.bounds, COLLISION_SLOP + 2)) continue;
      const contact = polygonPenetration(vertices, supportGeometry.vertices, piece.id, support.id);
      if (!contact || contact.ny <= 0) continue;
      supportNormalX += contact.nx;
      supportNormalY += contact.ny;
    }

    return supportNormalY > 0.25 &&
      Math.abs(supportNormalX) <= FRICTION_COEFFICIENT * supportNormalY;
  }

  function findNearbyMergePartner(piece) {
    if (piece.mergeLock > 0 || simulationTime - piece.bornAt <= 0.05) return null;
    const proximity = clamp(Math.min(piece.w, piece.h) * 0.08, MERGE_PROXIMITY_MIN, MERGE_PROXIMITY_MAX);
    const bounds = pieceGeometry(piece).bounds;

    for (const candidate of pieces) {
      if (candidate.id === piece.id || !candidate.sleeping || candidate.level !== piece.level) continue;
      if (candidate.mergeLock > 0 || simulationTime - candidate.bornAt <= 0.05) continue;
      if (!aabbsWithinDistance(bounds, pieceGeometry(candidate).bounds, proximity)) continue;
      if (polygonsWithinDistance(pieceGeometry(piece).vertices, pieceGeometry(candidate).vertices, proximity)) {
        return candidate;
      }
    }
    return null;
  }

  function aabbsWithinDistance(a, b, distance) {
    const gapX = Math.max(0, a.left - b.right, b.left - a.right);
    const gapY = Math.max(0, a.top - b.bottom, b.top - a.bottom);
    return gapX * gapX + gapY * gapY <= distance * distance;
  }

  function polygonsWithinDistance(verticesA, verticesB, distance) {
    const maximumDistanceSquared = distance * distance;
    return verticesWithinDistanceOfPolygon(verticesA, verticesB, maximumDistanceSquared) ||
      verticesWithinDistanceOfPolygon(verticesB, verticesA, maximumDistanceSquared);
  }

  function verticesWithinDistanceOfPolygon(vertices, polygon, maximumDistanceSquared) {
    const count = polygon.length / 2;
    for (let index = 0; index < vertices.length; index += 2) {
      const x = vertices[index];
      const y = vertices[index + 1];
      for (let edge = 0; edge < count; edge += 1) {
        const next = (edge + 1) % count;
        const ax = polygon[edge * 2];
        const ay = polygon[edge * 2 + 1];
        const edgeX = polygon[next * 2] - ax;
        const edgeY = polygon[next * 2 + 1] - ay;
        const lengthSquared = edgeX * edgeX + edgeY * edgeY;
        const projection = lengthSquared > 1e-8
          ? clamp(((x - ax) * edgeX + (y - ay) * edgeY) / lengthSquared, 0, 1)
          : 0;
        const dx = x - (ax + edgeX * projection);
        const dy = y - (ay + edgeY * projection);
        if (dx * dx + dy * dy <= maximumDistanceSquared) return true;
      }
    }
    return false;
  }

  function pieceGeometry(piece) {
    const angle = piece.angle || 0;
    // Keep impact squash visual only; it must not change collision boundaries.
    const scale = 1;
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
      const localX = (polygon[index] - 0.5) * piece.w * scale * COLLISION_POLYGON_SCALE;
      const localY = (polygon[index + 1] - 0.5) * piece.h * scale * COLLISION_POLYGON_SCALE;
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
    const depth = contact.depth - COLLISION_SLOP;
    if (!Number.isFinite(depth)) return;

    // Sleeping pieces and pieces already supported by the floor do not move
    // vertically when another piece presses into them.
    const invMassA = a.sleeping ? 0 : 1 / (a.w * a.h);
    const invMassB = b.sleeping ? 0 : 1 / (b.w * b.h);
    const verticalResponseA = isFloorSupported(a) ? 0 : 1;
    const verticalResponseB = isFloorSupported(b) ? 0 : 1;
    const inverseTotal = invMassA * (nx * nx + verticalResponseA * ny * ny) +
      invMassB * (nx * nx + verticalResponseB * ny * ny);
    if (inverseTotal <= 1e-8) return;

    if (depth > 0) {
      const correction = depth * 0.82 / inverseTotal;
      a.x -= nx * correction * invMassA;
      a.y -= ny * correction * invMassA * verticalResponseA;
      b.x += nx * correction * invMassB;
      b.y += ny * correction * invMassB * verticalResponseB;
    }

    const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (applyImpulse && relativeVelocity < 0) {
      const closingSpeed = -relativeVelocity;
      const restitution = closingSpeed <= MIN_BOUNCE_SPEED ? 0 : BOUNCE_RESTITUTION;
      const impulse = -(1 + restitution) * relativeVelocity / inverseTotal;
      const tangentVelocityX = (b.vx - a.vx) - relativeVelocity * nx;
      const tangentVelocityY = (b.vy - a.vy) - relativeVelocity * ny;
      const tangentSpeed = Math.hypot(tangentVelocityX, tangentVelocityY);
      const tangentX = tangentSpeed > 0.001 ? tangentVelocityX / tangentSpeed : 0;
      const tangentY = tangentSpeed > 0.001 ? tangentVelocityY / tangentSpeed : 0;
      const frictionInverseTotal = invMassA * (tangentX * tangentX + verticalResponseA * tangentY * tangentY) +
        invMassB * (tangentX * tangentX + verticalResponseB * tangentY * tangentY);
      const frictionImpulse = frictionInverseTotal > 1e-8
        ? clamp(-tangentSpeed / frictionInverseTotal, -impulse * FRICTION_COEFFICIENT, impulse * FRICTION_COEFFICIENT)
        : 0;
      a.vx -= impulse * invMassA * nx;
      a.vy -= impulse * invMassA * ny * verticalResponseA;
      b.vx += impulse * invMassB * nx;
      b.vy += impulse * invMassB * ny * verticalResponseB;
      a.vx -= frictionImpulse * invMassA * tangentX;
      a.vy -= frictionImpulse * invMassA * tangentY * verticalResponseA;
      b.vx += frictionImpulse * invMassB * tangentX;
      b.vy += frictionImpulse * invMassB * tangentY * verticalResponseB;
      if (closingSpeed > MIN_BOUNCE_SPEED) {
        squashPiece(a, -nx, -ny, closingSpeed);
        squashPiece(b, nx, ny, closingSpeed);
      }
      if (closingSpeed > 70) {
        const impactPoint = collisionContactPoint(a, b, nx, ny);
        const inertiaA = (a.w * a.h) * (a.w * a.w + a.h * a.h) / 12;
        const inertiaB = (b.w * b.h) * (b.w * b.w + b.h * b.h) / 12;
        const offsetAX = impactPoint.x - a.x;
        const offsetAY = impactPoint.y - a.y;
        const offsetBX = impactPoint.x - b.x;
        const offsetBY = impactPoint.y - b.y;
        const armA = offsetAX * ny - offsetAY * nx;
        const armB = offsetBX * ny - offsetBY * nx;
        const armATangent = offsetAX * tangentY - offsetAY * tangentX;
        const armBTangent = offsetBX * tangentY - offsetBY * tangentX;
        const impactTangentX = -ny;
        const impactTangentY = nx;
        const impactRadius = Math.max(10, Math.min(a.w, a.h, b.w, b.h) * 0.5);
        const impactOffset = clamp((armA + armB) * 0.5 / impactRadius, -0.5, 0.5);
        const tangentKick = impulse * impactOffset * 0.045;
        a.vx -= tangentKick * impactTangentX * invMassA;
        a.vy -= tangentKick * impactTangentY * invMassA * verticalResponseA;
        b.vx += tangentKick * impactTangentX * invMassB;
        b.vy += tangentKick * impactTangentY * invMassB * verticalResponseB;
        const armAImpactTangent = offsetAX * impactTangentY - offsetAY * impactTangentX;
        const armBImpactTangent = offsetBX * impactTangentY - offsetBY * impactTangentX;
        const spinA = clamp((-impulse * armA - frictionImpulse * armATangent - tangentKick * armAImpactTangent) / inertiaA * 0.26, -0.24, 0.24);
        const spinB = clamp((impulse * armB + frictionImpulse * armBTangent + tangentKick * armBImpactTangent) / inertiaB * 0.26, -0.24, 0.24);
        if (!a.sleeping) a.angularVelocity = clamp(a.angularVelocity + spinA, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
        if (!b.sleeping) b.angularVelocity = clamp(b.angularVelocity + spinB, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
      }
    }
    clampPieceToBin(a);
    clampPieceToBin(b);
  }

  function averageSupportPoint(vertices, nx, ny, findMaximum) {
    let target = findMaximum ? -Infinity : Infinity;
    for (let index = 0; index < vertices.length; index += 2) {
      const projection = vertices[index] * nx + vertices[index + 1] * ny;
      target = findMaximum ? Math.max(target, projection) : Math.min(target, projection);
    }

    let x = 0;
    let y = 0;
    let count = 0;
    for (let index = 0; index < vertices.length; index += 2) {
      const projection = vertices[index] * nx + vertices[index + 1] * ny;
      if (Math.abs(projection - target) > 1.5) continue;
      x += vertices[index];
      y += vertices[index + 1];
      count += 1;
    }
    return { x: x / count, y: y / count };
  }

  function collisionContactPoint(a, b, nx, ny) {
    const supportA = averageSupportPoint(pieceGeometry(a).vertices, nx, ny, true);
    const supportB = averageSupportPoint(pieceGeometry(b).vertices, nx, ny, false);
    return { x: (supportA.x + supportB.x) / 2, y: (supportA.y + supportB.y) / 2 };
  }

  function isFloorSupported(piece) {
    return piece.vy >= -0.1 && pieceSilhouetteAabb(piece).bottom >= FLOOR - 0.5;
  }

  function squashPiece(piece, nx, ny, speed) {
    const amount = Math.min(SQUASH_MAX, speed / 1500);
    if (amount <= piece.squash) return;
    piece.squash = amount;
    piece.squashAngle = Math.atan2(ny, nx);
  }

  function clampPieceToBin(piece) {
    let bounds = pieceSilhouetteAabb(piece);
    if (bounds.left < LEFT) piece.x += LEFT - bounds.left;
    bounds = pieceSilhouetteAabb(piece);
    if (bounds.right > RIGHT) piece.x -= bounds.right - RIGHT;
    bounds = pieceSilhouetteAabb(piece);
    if (bounds.bottom > FLOOR) piece.y -= bounds.bottom - FLOOR;
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
    // A merge removes both supports; wake any sleepers stacked above them
    // before their geometry disappears, including higher pieces in the stack.
    wakeSupportedPieces(a);
    wakeSupportedPieces(b);

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
    const newLevel = Math.min(a.level + 1, stages.length - 1);
    const pointsEarned = (newLevel + 1) * 10;
    const combo = trackMergeCombo(pointsEarned);
    scoreEarned += pointsEarned + combo.bonusAdded;
    score += pointsEarned + combo.bonusAdded;
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
    announcer.textContent = `合成：${stages[newLevel].id}`;
    const achievementShown = newLevel === stages.length - 1
      ? recordBigFishCreated()
      : showAchievement(newLevel);
    if (combo.count >= 3) {
      const comboToastState = { count: combo.count, totalBonus: combo.totalBonus, stageName: stages[newLevel].id };
      if (achievementShown && achievementDialog.open) pendingComboToast = comboToastState;
      else showComboToast(comboToastState.count, comboToastState.totalBonus, comboToastState.stageName);
    }
  }

  function trackMergeCombo(pointsEarned) {
    const now = performance.now();
    if (now - comboLastMergeAt > COMBO_WINDOW_MS) {
      comboCount = 0;
      comboBasePoints = 0;
      comboAwardedBonus = 0;
    }

    comboCount += 1;
    comboBasePoints += pointsEarned;
    comboLastMergeAt = now;

    if (comboCount < 3) return { count: comboCount, bonusAdded: 0, totalBonus: 0 };

    const totalBonus = Math.floor(comboBasePoints * COMBO_BONUS_RATE);
    const bonusAdded = totalBonus - comboAwardedBonus;
    comboAwardedBonus = totalBonus;
    return { count: comboCount, bonusAdded, totalBonus };
  }

  function emitMerge(x, y, newLevel) {
    const colors = ["#75aeea", "#68c2e5", "#75cbbb", "#a4c8f5", "#4d8fd5"];
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
    showToast(stages[newLevel].id);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 1100);
  }

  function showComboToast(count, totalBonus, stageName) {
    toast.textContent = `恭喜用户完成 ${count} 连消除！\n合成 ${stageName} · 本轮连消加成 +${totalBonus} 积分`;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 1600);
  }

  function recordBigFishCreated() {
    const earnsCard = itemState.bigFishProgress === 1;
    const nextState = {
      reviveCards: Math.min(9999, itemState.reviveCards + (earnsCard ? 1 : 0)),
      bigFishProgress: earnsCard ? 0 : 1,
    };
    if (!saveItemState(nextState)) {
      setItemStatus("大肥鱼合成成功，但本机无法保存道具进度；请检查浏览器存储空间。");
      return showAchievement(stages.length - 1, { saved: false, earnsCard: false });
    }
    updateItemInterface();
    setItemStatus(earnsCard
      ? `两条大肥鱼已合成，获得复活卡 ×1（当前 ${itemState.reviveCards} 张）。`
      : "大肥鱼进度 1 / 2；再合成一条即可获得复活卡。");
    return showAchievement(stages.length - 1, { saved: true, earnsCard });
  }

  function finishGame() {
    if (gameOver) return;
    gameOver = true;
    hammerTargeting = false;
    activeTouchGesture = null;
    updateTouchInstructions();
    updateItemInterface();
    resultScore.textContent = score.toLocaleString("zh-CN");
    resultAvatar.hidden = true;
    resultTitle.textContent = "本局结束";
    resultCopy.textContent = `最高阶段：${stages[highestLevel].id}`;
    resultLeaderboardStatus.hidden = false;
    if (!runIntegrityIsValid()) {
      runIntegrityCompromised = true;
      resultLeaderboardStatus.textContent = "本局数据校验未通过，成绩不会提交全球排行榜。";
    } else if (itemState.reviveCards > 0) {
      resultLeaderboardStatus.textContent = "你有复活卡：复活会继续本局；选择“再开一局”将提交本局成绩。";
    } else {
      submitFinalScore();
    }
    announcer.textContent = "本局结束。你可以使用复活卡继续，或开始新的一局。";
    if (!achievementDialog.open && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  }

  function submitFinalScore() {
    if (scoreSubmissionStarted) return;
    scoreSubmissionStarted = true;
    if (!runIntegrityIsValid()) {
      runIntegrityCompromised = true;
      resultLeaderboardStatus.textContent = "本局数据校验未通过，成绩不会提交全球排行榜。";
      return;
    }
    if (!window.FishLeaderboard) {
      resultLeaderboardStatus.textContent = "全球排行榜尚未连接；本地最高纪录仍会保存。";
      return;
    }
    resultLeaderboardStatus.textContent = "正在读取榜单并检查本局成绩…";
    window.FishLeaderboard.submitScore(score).then((result) => {
      if (!gameOver) return;
      if (result.status === "ranked") {
        resultLeaderboardStatus.textContent = result.rank
          ? `进入全球前 20 名！当前第 ${result.rank} 名。`
          : "本局成绩已进入全球前 20 名！";
      } else if (result.status === "not-ranked") {
        resultLeaderboardStatus.textContent = result.rank
          ? `你的昵称当前排第 ${result.rank} 名；本局没有刷新榜单纪录。`
          : "本局成绩暂未进入全球前 20 名，再接再厉！";
      } else if (result.status === "unconfigured") {
        resultLeaderboardStatus.textContent = "全球排行榜尚未连接；本地最高纪录仍会保存。";
      } else {
        resultLeaderboardStatus.textContent = "暂时无法连接全球排行榜；本地最高纪录仍会保存。";
      }
    }).catch(() => {
      if (gameOver) resultLeaderboardStatus.textContent = "暂时无法连接全球排行榜；本地最高纪录仍会保存。";
    });
  }

  function drawBackground() {
    const dark = document.documentElement.dataset.theme === "dark";
    context.clearRect(0, 0, W, H);
    context.fillStyle = dark ? "#15222d" : "#f3f8ff";
    context.fillRect(0, 0, W, H);

    context.save();
    context.strokeStyle = dark ? "#3a5264" : "#c5d8ec";
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
    context.strokeStyle = dark ? "rgb(112 178 223 / 78%)" : "rgb(45 115 191 / 70%)";
    context.beginPath();
    context.moveTo(LEFT + 1, DANGER_LINE);
    context.lineTo(RIGHT - 1, DANGER_LINE);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = dark ? "#9ccbf0" : "#2d73bf";
    context.font = "500 10px 'Microsoft YaHei', sans-serif";
    context.textAlign = "right";
    context.fillText("结束线", RIGHT - 5, DANGER_LINE - 6);
    context.restore();

  }

  function drawAvatar(x, y, level, metrics, alpha = 1, squash = 0, angle = 0, squashAngle = 0) {
    const stage = stages[level];
    if (!stage.image.complete || !stage.image.naturalWidth) return;
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.globalAlpha = alpha;
    const impactSquash = clamp(squash, 0, SQUASH_MAX);
    if (impactSquash > 0.004) {
      const relativeSquashAngle = squashAngle - angle;
      context.rotate(relativeSquashAngle);
      context.scale(1 - impactSquash, 1 + impactSquash * 0.85);
      context.rotate(-relativeSquashAngle);
    }
    context.shadowColor = "rgb(35 83 133 / 22%)";
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
    context.strokeStyle = "rgb(45 115 191 / 46%)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(aimXClamped, previewBounds.bottom + 3);
    context.lineTo(aimXClamped, Math.min(DANGER_LINE - 4, previewBounds.bottom + 43));
    context.stroke();
    context.restore();
    drawAvatar(aimXClamped, previewY, currentLevel, previewMetrics, pendingDropId === null ? 0.78 : 0.38, 0, 0);

    pieces.slice().sort((a, b) => a.y - b.y).forEach((piece) => {
      drawAvatar(piece.x, piece.y, piece.level, piece, 1, piece.squash, piece.angle, piece.squashAngle);
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
    if (hammerTargeting) {
      const canHit = Boolean(findHammerTarget(aimX, hammerAimY));
      context.save();
      context.strokeStyle = canHit ? "#c34b4b" : "#2d73bf";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(aimX, hammerAimY, 13, 0, Math.PI * 2);
      context.moveTo(aimX - 19, hammerAimY);
      context.lineTo(aimX - 7, hammerAimY);
      context.moveTo(aimX + 7, hammerAimY);
      context.lineTo(aimX + 19, hammerAimY);
      context.moveTo(aimX, hammerAimY - 19);
      context.lineTo(aimX, hammerAimY - 7);
      context.moveTo(aimX, hammerAimY + 7);
      context.lineTo(aimX, hammerAimY + 19);
      context.stroke();
      context.fillStyle = canHit ? "#a83e3e" : "#2d73bf";
      context.font = "600 11px 'Microsoft YaHei', sans-serif";
      context.textAlign = "left";
      context.fillText(canHit ? "砸击" : "瞄准", aimX + 17, hammerAimY - 12);
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
    if (!gameOver && !achievementDialog.open && dt > 0) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  updateInterface();
  updateTouchInstructions();
  if (itemStorageCompromised) setItemStatus("本地道具存档校验失败，道具已停用；本局成绩不会提交排行榜。");
  resizeCanvas();
  assetRetryButton.addEventListener("click", () => loadStageAssets(true));
  loadStageAssets();
  requestAnimationFrame(frame);
})();
