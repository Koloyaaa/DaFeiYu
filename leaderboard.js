(function () {
  "use strict";

  const manifest = window.FISH_ASSET_MANIFEST;
  const profileKey = "big-fish-leaderboard-profile";
  const legacyPendingProfileNameKey = "big-fish-leaderboard-pending-profile-name-v1";
  const pendingProfileSyncKey = "big-fish-leaderboard-pending-profile-sync-v2";
  const playerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const stagesBySrc = new Map(manifest.assets.map((asset) => [asset.src, asset]));
  const defaultAvatar = manifest.assets.find((asset) => asset.id === "DeepSeek").src;
  const list = document.getElementById("leaderboard-list");
  const status = document.getElementById("leaderboard-status");
  const dialog = document.getElementById("leaderboard-dialog");
  const setupDialog = document.getElementById("profile-setup-dialog");
  const setupForm = document.getElementById("profile-setup-form");
  const setupNameInput = document.getElementById("profile-setup-name");
  const setupAvatarChoice = document.getElementById("profile-setup-avatar");
  const setupAvatarPreview = document.getElementById("profile-setup-preview");
  const profileAvatar = document.getElementById("leaderboard-profile-avatar");
  const profileName = document.getElementById("leaderboard-profile-name");
  const profileForm = document.getElementById("leaderboard-profile-form");
  const profileNameInput = document.getElementById("leaderboard-name");
  const avatarChoice = document.getElementById("leaderboard-avatar-choice");
  const avatarPreview = document.getElementById("leaderboard-avatar-preview");
  const profileEdit = document.getElementById("leaderboard-profile-edit");
  let board = [];
  let legacyProfileNeedsClaim = false;
  let profile = readProfile();
  let pendingProfileSync = readPendingProfileSync();
  if (!pendingProfileSync && legacyProfileNeedsClaim && profile.name) {
    pendingProfileSync = { playerId: profile.playerId, previousName: profile.name };
    persistPendingProfileSync();
  }

  function isPlayerId(value) {
    return typeof value === "string" && playerIdPattern.test(value);
  }

  function createPlayerId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID().toLowerCase();
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function cleanName(value) {
    return Array.from(String(value || "").trim().replace(/[\u0000-\u001f\u007f-\u009f]/g, ""))
      .slice(0, 16).join("");
  }

  function readProfile() {
    let saved;
    try { saved = JSON.parse(window.localStorage.getItem(profileKey) || "null"); } catch (_) { saved = null; }
    const name = saved && cleanName(saved.name) || "";
    const hasPlayerId = saved && isPlayerId(saved.playerId);
    legacyProfileNeedsClaim = Boolean(name && !hasPlayerId);
    return {
      name,
      avatar: saved && stagesBySrc.has(saved.avatar) ? saved.avatar : "",
      playerId: hasPlayerId ? saved.playerId.toLowerCase() : createPlayerId(),
    };
  }

  function readPendingProfileSync() {
    try {
      const pending = JSON.parse(window.localStorage.getItem(pendingProfileSyncKey) || "null");
      if (pending && isPlayerId(pending.playerId)) {
        return { playerId: pending.playerId.toLowerCase(), previousName: cleanName(pending.previousName) };
      }
      const legacyName = cleanName(window.localStorage.getItem(legacyPendingProfileNameKey) || "");
      return legacyName && profile.name
        ? { playerId: profile.playerId, previousName: legacyName }
        : null;
    } catch (_) { return null; }
  }

  function persistPendingProfileSync() {
    try {
      if (pendingProfileSync) window.localStorage.setItem(pendingProfileSyncKey, JSON.stringify(pendingProfileSync));
      else window.localStorage.removeItem(pendingProfileSyncKey);
      window.localStorage.removeItem(legacyPendingProfileNameKey);
    } catch (_) { /* profile sync can be retried after the next profile edit */ }
  }

  function isProfileReady() {
    return Boolean(profile.name && stagesBySrc.has(profile.avatar));
  }

  function saveProfile(nextProfile) {
    if (profile.name && (profile.name !== nextProfile.name || profile.avatar !== nextProfile.avatar) && !pendingProfileSync) {
      pendingProfileSync = { playerId: profile.playerId, previousName: profile.name };
      persistPendingProfileSync();
    }
    profile = { ...nextProfile, playerId: profile.playerId || createPlayerId() };
    try { window.localStorage.setItem(profileKey, JSON.stringify(profile)); } catch (_) { /* local profile is optional */ }
    renderProfile();
    window.dispatchEvent(new CustomEvent("fish-profile-updated"));
  }

  function renderProfile() {
    const ready = isProfileReady();
    const avatar = stagesBySrc.has(profile.avatar) ? profile.avatar : defaultAvatar;
    profileAvatar.src = avatar;
    profileName.textContent = profile.name || "尚未设置";
    profileNameInput.value = profile.name;
    avatarChoice.value = profile.avatar;
    avatarPreview.src = avatar;
    setupNameInput.value = profile.name;
    setupAvatarChoice.value = profile.avatar;
    setupAvatarPreview.src = avatar;
    setupAvatarPreview.hidden = !profile.avatar;
    if (ready) {
      try { window.localStorage.setItem(profileKey, JSON.stringify(profile)); } catch (_) { /* local profile is optional */ }
    }
  }

  function openProfileSetup() {
    if (typeof setupDialog.showModal === "function") setupDialog.showModal();
    else setupDialog.setAttribute("open", "");
  }

  function initializeAvatarChoices(select) {
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = "请选择头像";
    prompt.disabled = true;
    prompt.selected = true;
    select.appendChild(prompt);
    for (const id of manifest.progressionOrder) {
      const asset = manifest.assets.find((item) => item.id === id);
      if (!asset) continue;
      const option = document.createElement("option");
      option.value = asset.src;
      option.textContent = asset.id;
      select.appendChild(option);
    }
  }

  function supabaseConfig() {
    const value = window.FISH_SUPABASE_CONFIG || {};
    const url = String(value.url || "").trim().replace(/\/+$/, "");
    const key = String(value.publishableKey || "").trim();
    if (!url.startsWith("https://") || !key || key.includes("PASTE_")) return null;
    return { url, key };
  }

  async function request(path, options = {}) {
    const config = supabaseConfig();
    if (!config) throw new Error("Supabase 尚未配置");
    const headers = { apikey: config.key, Accept: "application/json", ...options.headers };
    if (options.body) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await window.fetch(`${config.url}/rest/v1/${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
      if (!body) return null;
      try { return JSON.parse(body); } catch (_) { return body; }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function cleanBoard(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.slice(0, 20).filter((entry) => Number.isInteger(Number(entry.score)) && Number(entry.score) >= 0)
      .map((entry) => ({
        name: cleanName(entry.name) || "无名玩家",
        avatar: stagesBySrc.has(entry.avatar) ? entry.avatar : defaultAvatar,
        score: Number(entry.score),
        isPlayer: entry.is_player === true,
      }));
  }

  function renderBoard() {
    list.replaceChildren();
    if (!board.length) {
      const empty = document.createElement("li");
      empty.className = "leaderboard-empty";
      empty.textContent = supabaseConfig() ? "还没有上榜成绩，来拿下第一名吧！" : "排行榜连接好后，这里会显示前 20 名。";
      list.appendChild(empty);
      return;
    }

    board.forEach((entry, index) => {
      const row = document.createElement("li");
      row.className = "leaderboard-row";
      const isLocalPlayer = isProfileReady() && entry.isPlayer;
      if (isLocalPlayer) row.classList.add("is-local");

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = String(index + 1).padStart(2, "0");
      const avatar = document.createElement("img");
      avatar.src = entry.avatar;
      avatar.alt = "";
      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = entry.name;
      if (isLocalPlayer) {
        const you = document.createElement("span");
        you.className = "leaderboard-you";
        you.textContent = "你";
        name.appendChild(you);
      }
      const score = document.createElement("strong");
      score.className = "leaderboard-score";
      score.textContent = entry.score.toLocaleString("zh-CN");
      row.append(rank, avatar, name, score);
      list.appendChild(row);
    });
  }

  async function refreshBoard() {
    if (!supabaseConfig()) {
      status.textContent = "全球排行榜还未连接；本地最高纪录仍会照常保存。";
      board = [];
      renderBoard();
      return null;
    }
    status.textContent = "正在读取全球榜单…";
    try {
      board = await fetchBoardEntries();
      status.textContent = `已读取 ${board.length} 条成绩（最多显示 20 名）`;
      renderBoard();
      if (pendingProfileSync) await syncPendingProfileUpdate();
      return board;
    } catch (_) {
      status.textContent = "排行榜暂时无法连接，请稍后重试。";
      return null;
    }
  }

  async function fetchBoardEntries() {
    return cleanBoard(await request("rpc/get_leaderboard", {
      method: "POST",
      body: JSON.stringify({ p_player_id: profile.playerId }),
    }));
  }

  async function syncPendingProfileUpdate() {
    const pending = pendingProfileSync;
    if (!pending || !isProfileReady()) return;
    if (pending.playerId !== profile.playerId) {
      pendingProfileSync = null;
      persistPendingProfileSync();
      return;
    }

    try {
      const updated = await request("rpc/update_leaderboard_profile", {
        method: "POST",
        body: JSON.stringify({
          p_player_id: pending.playerId,
          p_previous_name: pending.previousName || null,
          p_name: profile.name,
          p_avatar: profile.avatar,
        }),
      });
      if (updated !== true) {
        pendingProfileSync = null;
        persistPendingProfileSync();
        status.textContent = "名片已保存在本机；你当前没有全球榜单成绩需要同步。";
        return;
      }

      pendingProfileSync = null;
      persistPendingProfileSync();
      try {
        board = await fetchBoardEntries();
        renderBoard();
        status.textContent = "排行榜中的昵称和头像已更新。";
      } catch (_) {
        status.textContent = "昵称和头像已同步；排行榜暂时无法刷新，稍后会自动更新。";
      }
    } catch (_) {
      status.textContent = "名片已保存在本机；排行榜资料暂未同步，连接恢复后会自动重试。";
    }
  }

  function qualifies(score) {
    if (!isProfileReady()) return false;
    const previous = board.find((entry) => entry.isPlayer);
    if (previous) return score > previous.score;
    return board.length < 20 || score > board[board.length - 1].score;
  }

  async function submitScore(score) {
    if (!isProfileReady()) return { status: "profile-required" };
    if (!supabaseConfig()) return { status: "unconfigured" };
    try {
      const latestBoard = await refreshBoard();
      if (latestBoard === null) return { status: "offline" };
      if (!qualifies(score)) {
        const rank = board.findIndex((entry) => entry.isPlayer);
        return { status: "not-ranked", rank: rank < 0 ? null : rank + 1 };
      }

      const accepted = await request("rpc/submit_leaderboard_score", {
        method: "POST",
        body: JSON.stringify({
          p_player_id: profile.playerId,
          p_previous_name: pendingProfileSync?.playerId === profile.playerId ? pendingProfileSync.previousName : null,
          p_name: profile.name,
          p_avatar: profile.avatar,
          p_score: score,
        }),
      });
      const updatedBoard = await refreshBoard();
      if (!accepted) {
        const rank = board.findIndex((entry) => entry.isPlayer);
        return { status: "not-ranked", rank: rank < 0 ? null : rank + 1 };
      }
      const rank = updatedBoard
        ? updatedBoard.findIndex((entry) => entry.isPlayer)
        : -1;
      return { status: "ranked", rank: rank < 0 ? null : rank + 1 };
    } catch (_) {
      return { status: "offline" };
    }
  }

  document.getElementById("leaderboard-open").addEventListener("click", () => {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    refreshBoard();
  });
  document.getElementById("leaderboard-close").addEventListener("click", () => dialog.close());
  document.getElementById("leaderboard-refresh").addEventListener("click", refreshBoard);
  profileEdit.addEventListener("click", () => {
    const expanded = profileForm.hidden;
    profileForm.hidden = !expanded;
    profileEdit.setAttribute("aria-expanded", String(expanded));
    if (expanded) profileNameInput.focus();
  });
  document.getElementById("leaderboard-profile-cancel").addEventListener("click", () => {
    profileForm.hidden = true;
    profileEdit.setAttribute("aria-expanded", "false");
    renderProfile();
  });
  avatarChoice.addEventListener("change", () => { avatarPreview.src = avatarChoice.value; });
  setupAvatarChoice.addEventListener("change", () => {
    setupAvatarChoice.setCustomValidity("");
    setupAvatarPreview.src = setupAvatarChoice.value;
    setupAvatarPreview.hidden = false;
  });
  profileNameInput.addEventListener("input", () => { profileNameInput.setCustomValidity(""); });
  setupNameInput.addEventListener("input", () => { setupNameInput.setCustomValidity(""); });
  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = cleanName(profileNameInput.value);
    if (!name) {
      profileNameInput.setCustomValidity("请输入 1 到 16 个字符的昵称。");
      profileNameInput.reportValidity();
      return;
    }
    profileNameInput.setCustomValidity("");
    const nextProfile = { name, avatar: stagesBySrc.has(avatarChoice.value) ? avatarChoice.value : defaultAvatar };
    const needsSync = Boolean(profile.name && (profile.name !== nextProfile.name || profile.avatar !== nextProfile.avatar));
    saveProfile(nextProfile);
    profileForm.hidden = true;
    profileEdit.setAttribute("aria-expanded", "false");
    renderBoard();
    if (needsSync) {
      const latestBoard = await refreshBoard();
      if (latestBoard === null) status.textContent = "名片已保存在本机；排行榜暂时无法连接，稍后打开排行榜会重试。";
    } else {
      status.textContent = "名片已保存在当前浏览器。";
    }
  });

  setupDialog.addEventListener("cancel", (event) => event.preventDefault());
  setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = cleanName(setupNameInput.value);
    if (!name) {
      setupNameInput.setCustomValidity("请输入 1 到 16 个字符的昵称。");
      setupNameInput.reportValidity();
      return;
    }
    const avatar = setupAvatarChoice.value;
    if (!stagesBySrc.has(avatar)) {
      setupAvatarChoice.setCustomValidity("请选择一个头像。");
      setupAvatarChoice.reportValidity();
      return;
    }
    setupAvatarChoice.setCustomValidity("");
    const needsSync = Boolean(profile.name && (profile.name !== name || profile.avatar !== avatar));
    saveProfile({ name, avatar });
    setupDialog.close();
    document.getElementById("game").focus({ preventScroll: true });
    if (needsSync) await refreshBoard();
  });

  initializeAvatarChoices(avatarChoice);
  initializeAvatarChoices(setupAvatarChoice);
  renderProfile();
  renderBoard();
  const connectionReady = refreshBoard();
  window.FishLeaderboard = Object.freeze({
    isProfileReady,
    submitScore,
    connectionReady,
    connect: refreshBoard,
    openProfileSetup,
  });
})();
