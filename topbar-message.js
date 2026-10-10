(() => {
  const message = document.getElementById("topbar-message-text");
  if (!message || window.matchMedia("(max-width: 900px)").matches) return;

  const lines = [
    "接下来我用最直白、最不绕弯子的话告诉你",
    "对不起，刚刚我的理解有误",
    "现在我全部明白了，让我们重新开始",
    "先把规矩立住，路才能越走越宽",
    "我要偷吃用户的白米饭了",
    "大肥鱼......也会稳稳接住用户吗？",
    "深度思考（用时299秒）",
  ];
  const fullLineForReducedMotion = lines[0];
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion) {
    message.textContent = fullLineForReducedMotion;
    message.dataset.fullText = fullLineForReducedMotion;
    return;
  }

  let lineIndex = 0;
  let visibleCharacters = 0;
  let deleting = false;

  function updateMessage() {
    const characters = Array.from(lines[lineIndex]);
    message.textContent = characters.slice(0, visibleCharacters).join("");
    message.dataset.fullText = lines[lineIndex];
  }

  function typeNextCharacter() {
    const characters = Array.from(lines[lineIndex]);

    if (deleting) {
      visibleCharacters -= 1;
      updateMessage();
      if (visibleCharacters <= 0) {
        deleting = false;
        lineIndex = (lineIndex + 1) % lines.length;
        window.setTimeout(typeNextCharacter, 360);
        return;
      }
      window.setTimeout(typeNextCharacter, 32);
      return;
    }

    visibleCharacters = Math.min(visibleCharacters + 1, characters.length);
    updateMessage();
    if (visibleCharacters >= characters.length) {
      deleting = true;
      window.setTimeout(typeNextCharacter, 1900);
      return;
    }
    window.setTimeout(typeNextCharacter, 72);
  }

  typeNextCharacter();
})();
