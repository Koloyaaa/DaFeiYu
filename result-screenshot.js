(() => {
  const button = document.getElementById("save-result-screenshot");
  const buttonLabel = document.getElementById("save-result-screenshot-label");
  const status = document.getElementById("screenshot-status");

  if (!button || !buttonLabel || !status) return;

  const SCREENSHOT_LIBRARY_TIMEOUT_MS = 10000;
  const SCREENSHOT_RENDER_TIMEOUT_MS = 30000;
  const SCREENSHOT_ENCODE_TIMEOUT_MS = 10000;
  let html2canvasPromise = null;

  function withTimeout(promise, milliseconds, message) {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]).finally(() => window.clearTimeout(timer));
  }

  function loadHtml2Canvas() {
    if (typeof window.html2canvas === "function") return Promise.resolve(window.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;

    html2canvasPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else if (typeof window.html2canvas === "function") {
          resolve(window.html2canvas);
        } else {
          script.remove();
          reject(new Error("本地截图组件未能启动。"));
        }
      };
      const timeout = window.setTimeout(
        () => finish(new Error("截图组件加载超时，请刷新页面后重试。")),
        SCREENSHOT_LIBRARY_TIMEOUT_MS,
      );
      script.async = true;
      script.src = new URL("./vendor/html2canvas.min.js", document.baseURI).href;
      script.onload = () => finish();
      script.onerror = () => finish(new Error("本地截图组件加载失败，请刷新页面后重试。"));
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
        else reject(new Error("PNG 编码失败。"));
      }, "image/png");
    });
  }

  button.addEventListener("click", async () => {
    if (button.disabled) return;

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    buttonLabel.textContent = "正在生成截图…";
    status.hidden = false;
    status.textContent = "正在准备截图组件…";

    try {
      const renderHtml = await loadHtml2Canvas();
      status.textContent = "正在整理整页战绩图…";
      const pageWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const maxCanvasPixels = 3_000_000;
      const scale = Math.min(
        window.devicePixelRatio || 1,
        1.5,
        Math.sqrt(maxCanvasPixels / (pageWidth * pageHeight)),
      );
      const canvas = await withTimeout(renderHtml(document.body, {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--page").trim() || "#f1f6f9",
        scale,
        width: pageWidth,
        height: pageHeight,
        windowWidth: pageWidth,
        windowHeight: pageHeight,
        scrollX: 0,
        scrollY: 0,
        imageTimeout: 6000,
        logging: false,
        useCORS: true,
        ignoreElements(element) {
          return element.id === "fontawesome-css";
        },
        onclone(clonedDocument) {
          clonedDocument.getElementById("game-over-dialog")?.remove();
          clonedDocument.getElementById("fontawesome-css")?.remove();
          const clonedMessage = clonedDocument.getElementById("topbar-message-text");
          if (clonedMessage?.dataset.fullText) clonedMessage.textContent = clonedMessage.dataset.fullText;
          clonedDocument.querySelector(".topbar-message-caret")?.remove();
        },
      }), SCREENSHOT_RENDER_TIMEOUT_MS, "整页截图生成超时，请稍后重试。");

      status.textContent = "正在导出 PNG 图片…";
      const blob = await withTimeout(canvasToBlob(canvas), SCREENSHOT_ENCODE_TIMEOUT_MS, "PNG 图片导出超时，请稍后重试。");
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
        ? `${error.message} 按钮已恢复，可以重试。`
        : "截图失败。按钮已恢复，可以重试。";
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      buttonLabel.textContent = "保存战绩截图";
    }
  });
})();
