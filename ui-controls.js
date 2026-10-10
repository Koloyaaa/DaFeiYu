(function () {
  "use strict";

  const root = document.documentElement;
  const themeButton = document.getElementById("theme-toggle");
  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");
  const profileButton = document.getElementById("profile-open");
  const rulesButton = document.getElementById("rules-open");
  const rulesDialog = document.getElementById("rules-dialog");
  const rulesClose = document.getElementById("rules-close");
  const shareButton = document.getElementById("share-button");
  const feedback = document.getElementById("utility-feedback");
  const status = document.getElementById("utility-status");
  let feedbackTimer = 0;

  function setTheme(theme, persist = true) {
    root.dataset.theme = theme;
    const dark = theme === "dark";
    themeIcon.classList.toggle("fa-sun", dark);
    themeIcon.classList.toggle("fa-moon", !dark);
    themeLabel.textContent = dark ? "浅色配色" : "深色配色";
    themeButton.setAttribute("aria-label", dark ? "切换到浅色配色" : "切换到深色配色");
    themeButton.title = dark ? "切换到浅色配色" : "切换到深色配色";
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = dark ? "#101b25" : "#f1f6f9";
    if (persist) {
      try { window.localStorage.setItem("big-fish-theme", theme); } catch (_) { /* Theme still changes for this visit. */ }
    }
    window.dispatchEvent(new Event("fish-theme-change"));
  }

  function showFeedback(message) {
    feedback.textContent = message;
    feedback.hidden = false;
    status.textContent = message;
    window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => { feedback.hidden = true; }, 2400);
  }

  function copyWithSelection(text) {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }

  async function copyLink(url) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      return;
    }
    if (!copyWithSelection(url)) throw new Error("copy failed");
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  async function shareGame() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
        showFeedback("分享已完成");
      } catch (error) {
        if (error && error.name === "AbortError") return;
        try {
          await copyLink(url);
          showFeedback("分享面板不可用，游戏链接已复制");
        } catch (_) {
          showFeedback("无法自动分享或复制，请复制地址栏中的链接");
        }
      }
      return;
    }

    try {
      await copyLink(url);
      showFeedback("游戏链接已复制");
    } catch (_) {
      showFeedback("无法自动复制，请复制地址栏中的链接");
    }
  }

  themeButton.addEventListener("click", () => {
    setTheme(root.dataset.theme === "dark" ? "light" : "dark");
  });

  rulesButton.addEventListener("click", () => openDialog(rulesDialog));
  rulesClose.addEventListener("click", () => {
    if (typeof rulesDialog.close === "function") rulesDialog.close();
    else rulesDialog.removeAttribute("open");
  });
  rulesDialog.addEventListener("click", (event) => {
    if (event.target === rulesDialog) {
      if (typeof rulesDialog.close === "function") rulesDialog.close();
      else rulesDialog.removeAttribute("open");
    }
  });

  profileButton.addEventListener("click", () => {
    if (!window.FishLeaderboard || !window.FishLeaderboard.isProfileReady()) {
      const setupDialog = document.getElementById("profile-setup-dialog");
      if (!setupDialog.open) openDialog(setupDialog);
      return;
    }
    document.getElementById("leaderboard-open").click();
    const profileForm = document.getElementById("leaderboard-profile-form");
    if (profileForm.hidden) document.getElementById("leaderboard-profile-edit").click();
  });

  shareButton.addEventListener("click", shareGame);
  setTheme(root.dataset.theme === "dark" ? "dark" : "light", false);
})();
