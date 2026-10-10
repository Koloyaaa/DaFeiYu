(function () {
  "use strict";

  const manifest = window.FISH_ASSET_MANIFEST;
  const profileKey = "big-fish-leaderboard-profile";
  const pendingProfileNameKey = "big-fish-leaderboard-pending-profile-name-v1";
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
  let profile = readProfile();
  let pendingProfileName = readPendingProfileName();

  function cleanName(value) {
    return Array.from(String(value || "").trim().replace(/[\u0000-\u001f\u007f-\u009f]/g, ""))
      .slice(0, 16).join("");
  }

  function readProfile() {
    let saved;
    try { saved = JSON.parse(window.localStorage.getItem(profileKey) || "null"); } catch (_) { saved = null; }
    return {
      name: saved && cleanName(saved.name) || "",
      avatar: saved && stagesBySrc.has(saved.avatar) ? saved.avatar : "",
    };
  }

  function readPendingProfileName() {
    try { return cleanName(window.localStorage.getItem(pendingProfileNameKey) || ""); } catch (_) { return ""; }
  }

  function persistPendingProfileName() {
    try {
      if (pendingProfileName) window.localStorage.setItem(pendingProfileNameKey, pendingProfileName);
      else window.localStorage.removeItem(pendingProfileNameKey);
    } catch (_) { /* profile sync can be retried after the next profile edit */ }
  }

  function isProfileReady() {
    return Boolean(profile.name && stagesBySrc.has(profile.avatar));
  }

  function saveProfile(nextProfile) {
    if (profile.name && (profile.name !== nextProfile.name || profile.avatar !== nextProfile.avatar) && !pendingProfileName) {
      pendingProfileName = profile.name;
      persistPendingProfileName();
    }
    profile = nextProfile;
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
      const isLocalPlayer = isProfileReady()
        && entry.name.toLocaleLowerCase("zh-CN") === profile.name.toLocaleLowerCase("zh-CN");
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
      const params = new URLSearchParams({
        select: "name,avatar,score",
        order: "score.desc,id.asc",
        limit: "20",
      });
      board = cleanBoard(await request(`leaderboard?${params.toString()}`));
      status.textContent = `已读取 ${board.length} 条成绩（最多显示 20 名）`;
      renderBoard();
      if (pendingProfileName) await syncPendingProfileUpdate();
      return board;
    } catch (_) {
      status.textContent = "排行榜暂时无法连接，请稍后重试。";
      return null;
    }
  }

  async function syncPendingProfileUpdate() {
    const previousName = cleanName(pendingProfileName);
    if (!previousName || !isProfileReady()) return;

    const previousKey = previousName.toLocaleLowerCase("zh-CN");
    const currentKey = profile.name.toLocaleLowerCase("zh-CN");
    const previousEntry = board.find((entry) => entry.name.toLocaleLowerCase("zh-CN") === previousKey);
    if (!previousEntry) {
      pendingProfileName = "";
      persistPendingProfileName();
      status.textContent = "名片已保存在本机；你当前没有全球榜单成绩需要同步。";
      return;
    }

    const nameConflict = currentKey !== previousKey
      && board.some((entry) => entry.name.toLocaleLowerCase("zh-CN") === currentKey);
    if (nameConflict) {
      status.textContent = "名片已保存在本机；这个昵称已被榜单中的其他玩家使用，请换一个昵称后重试。";
      return;
    }

    try {
      const updated = await request("rpc/update_leaderboard_profile", {
        method: "POST",
        body: JSON.stringify({
          p_previous_name: previousName,
          p_name: profile.name,
          p_avatar: profile.avatar,
        }),
      });
      if (!updated) {
        status.textContent = "名片已保存在本机；排行榜资料暂未同步，打开排行榜时会重试。";
        return;
      }

      board = board.map((entry) => entry.name.toLocaleLowerCase("zh-CN") === previousKey
        ? { ...entry, name: profile.name, avatar: profile.avatar }
        : entry);
      pendingProfileName = "";
      persistPendingProfileName();
      renderBoard();
      status.textContent = "排行榜中的昵称和头像已更新。";
    } catch (_) {
      status.textContent = "名片已保存在本机；排行榜资料暂未同步，连接恢复后会重试。";
    }
  }

  function qualifies(score) {
    if (!isProfileReady()) return false;
    const previous = board.find((entry) => entry.name.toLocaleLowerCase("zh-CN") === profile.name.toLocaleLowerCase("zh-CN"));
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
        const rank = board.findIndex((entry) => entry.name.toLocaleLowerCase("zh-CN") === profile.name.toLocaleLowerCase("zh-CN"));
        return { status: "not-ranked", rank: rank < 0 ? null : rank + 1 };
      }

      const accepted = await request("rpc/submit_leaderboard_score", {
        method: "POST",
        body: JSON.stringify({ p_name: profile.name, p_avatar: profile.avatar, p_score: score }),
      });
      const updatedBoard = await refreshBoard();
      if (!accepted) {
        const rank = board.findIndex((entry) => entry.name.toLocaleLowerCase("zh-CN") === profile.name.toLocaleLowerCase("zh-CN"));
        return { status: "not-ranked", rank: rank < 0 ? null : rank + 1 };
      }
      const rank = updatedBoard
        ? updatedBoard.findIndex((entry) => entry.name.toLocaleLowerCase("zh-CN") === profile.name.toLocaleLowerCase("zh-CN"))
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
