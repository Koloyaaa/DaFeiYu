# 合成大肥鱼

[在线游玩](https://koloyaaa.github.io/DaFeiYu/)

## 玩法

放下角色，合并相同角色以解锁下一阶段。角色越过顶部红线时，本局结束；合成全部阶段即可通关。

## 操作

- 鼠标：移动选择位置，点击放置。
- 触屏：拖动选择位置，松手后轻触放置。
- 键盘：`←` / `→` 移动，`Space` 放置，`R` 重新开始。

放下角色后，等它落稳再放下一个。

## 合成顺序

豆包 → Mistral → Gemini → MuseSpark → GLM → Qwen → Kimi → Grok → Claude → ChatGPT → DeepSeek

## 本地游玩

下载或克隆仓库后，在浏览器中打开 `index.html`。

## 素材处理

游戏使用 `Assets/processed/` 中的 WebP 图片和 `manifest.json` 碰撞数据。重新生成素材需要 Python、Pillow、NumPy 和 SciPy：

```bash
python -m pip install Pillow numpy scipy
python scripts/preprocess_assets.py
```

## 作者与许可

DornGames（[@LéoWEE](https://github.com/Koloyaaa)） · [仓库](https://github.com/Koloyaaa/DaFeiYu)

MIT License，详见 [LICENSE](LICENSE)。
