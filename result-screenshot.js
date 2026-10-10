(() => {
  const button = document.getElementById("save-result-screenshot");
  const buttonLabel = document.getElementById("save-result-screenshot-label");
  const status = document.getElementById("screenshot-status");

  if (!button || !buttonLabel || !status) return;

  let html2canvasPromise = null;

  function loadHtml2Canvas() {
    if (typeof window.html2canvas === "function") return Promise.resolve(window.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;

    html2canvasPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      script.async = true;
      script.onload = () => {
        if (typeof window.html2canvas === "function") resolve(window.html2canvas);
        else reject(new Error("截图组件未能启动。"));
      };
      script.onerror = () => reject(new Error("截图组件加载失败，请检查网络后重试。"));
      document.head.append(script);
    }).catch((error) => {
      html2canvasPromise = null;
      throw error;
    });

    return html2canvasPromise;
  }

  function makeFilename() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
    return `合成大肥鱼-战绩-${timestamp}.png`;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== "function") {
        reject(new Error("当前浏览器无法生成 PNG 文件。"));
        return;
      }
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("截图生成失败，请再试一次。"));
      }, "image/png");
    });
  }

  button.addEventListener("click", async () => {
    if (button.disabled) return;

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    buttonLabel.textContent = "正在生成截图…";
    status.hidden = false;
    status.textContent = "正在准备整页战绩图，请稍候。";

    try {
      const renderHtml = await loadHtml2Canvas();
      const pageColor = getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
      const canvas = await renderHtml(document.body, {
        backgroundColor: pageColor || "#f1f6f9",
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true,
        onclone(clonedDocument) {
          clonedDocument.getElementById("game-over-dialog")?.remove();
          const clonedMessage = clonedDocument.getElementById("topbar-message-text");
          if (clonedMessage?.dataset.fullText) clonedMessage.textContent = clonedMessage.dataset.fullText;
          clonedDocument.querySelector(".topbar-message-caret")?.remove();
        },
      });
      const blob = await canvasToBlob(canvas);
      const downloadUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement("a");
      downloadLink.href = downloadUrl;
      downloadLink.download = makeFilename();
      downloadLink.hidden = true;
      document.body.append(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      status.textContent = "战绩截图已保存到下载文件夹。";
    } catch (error) {
      status.textContent = error instanceof Error
        ? `${error.message} 请重试。`
        : "截图失败，请检查网络后重试。";
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      buttonLabel.textContent = "保存战绩截图";
    }
  });
})();
