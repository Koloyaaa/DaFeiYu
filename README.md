# 合成大肥鱼

> **版本：V2.2** · **[🎮 在线体验：开始游戏](https://koloyaaa.github.io/DaFeiYu/)** · 无需下载，打开即玩

一款无需安装依赖、可在浏览器中运行的合成小游戏。让十一位 AI 娘相遇、进化，最终解锁 DeepSeek（大肥鱼）。

[游戏仓库](https://github.com/Koloyaaa/DaFeiYu) · [反馈问题](https://github.com/Koloyaaa/DaFeiYu/issues)

## 游戏截图

<p align="center">
  <img src="docs/gameplay-screenshot.png" alt="合成大肥鱼游戏画面" width="960">
</p>

> 注：截图展示的是较早的触屏按钮界面；当前触屏支持轻点落子，也可按住拖动、松手落子。

## 玩法

将相同阶段的角色合成，逐步解锁下一位 AI 娘。角色会受重力、碰撞和摩擦影响弹跳与旋转；当角色在结束线以上稳定停留一段时间，本局结束。连续合成到最后一阶即可解锁 DeepSeek（大肥鱼）。

新角色从前六阶中按概率抽取，概率由低阶到高阶递减：豆包 35%、Mistral 24%、Gemini 16%、MuseSpark 11%、GLM 8%、Qwen 6%。

## 操作方式

| 设备 | 操作 |
| --- | --- |
| 鼠标 | 移动选择位置，点击棋盘放下角色；每 0.35 秒最多放下一个。 |
| 触屏 | 轻点即可放下；也可按住拖动调整位置，松手放下。每 0.35 秒最多放下一个。 |
| 键盘 | `←` / `→` 移动，`Space` 放置，`R` 重新开始。 |

放下一位角色后，需等它碰到其他角色或池底，才能继续放置。两个相同阶段的角色相遇时会自动合成。

## 进化顺序

豆包 → Mistral → Gemini → MuseSpark → GLM → Qwen → Kimi → Grok → Claude → ChatGPT → DeepSeek

只有 DeepSeek 是“大肥鱼”；它是 DeepSeek 的昵称。游戏里的其他角色均为 AI 娘。

## 开始游戏

现在就可以在 [GitHub Pages 在线体验](https://koloyaaa.github.io/DaFeiYu/)。无需构建或安装前端依赖；下载或克隆仓库后，也可以在浏览器中打开 `index.html` 游玩。

```bash
git clone https://github.com/Koloyaaa/DaFeiYu.git
cd DaFeiYu
```

## 项目结构

```text
.
├── Assets/
│   ├── images/                 # 原始角色图片
│   ├── illustrations/          # 插画原图与轻量 WebP
│   └── processed/             # 去背景图片、碰撞多边形清单
├── docs/
│   └── gameplay-screenshot.png
├── scripts/
│   └── preprocess_assets.py   # 图片预处理与碰撞轮廓生成
├── game.js                    # 游戏逻辑与物理模拟
├── index.html
└── styles.css
```

## 图片与碰撞轮廓

游戏使用 `Assets/processed/` 中已去除背景的 PNG。`manifest.json` 和 `manifest.js` 保存每个角色的不规则多边形碰撞轮廓；运行游戏不需要 Python。

加载页使用 `Assets/illustrations/big-fish-eating-rice.webp` 作为透明背景插画；较高分辨率的 PNG 同目录保留。

如需从原图重新生成处理素材，可运行：

```bash
python -m pip install Pillow numpy scipy
python scripts/preprocess_assets.py
```

预处理脚本需要 Pillow、NumPy 和 SciPy。该步骤只用于生成素材，不参与游戏运行或 GitHub Pages 部署。

## 同类开源项目致谢

- [YHSome/BigNaiWa](https://github.com/YHSome/BigNaiWa)
- [bullhe4d/bigwatermelon](https://github.com/bullhe4d/bigwatermelon)
- [liyupi/daxigua](https://github.com/liyupi/daxigua)
- [O2Team](https://github.com/o2team/o2team.github.io)

作者：DornGames @LéoWEE · [Koloyaaa on GitHub](https://github.com/Koloyaaa)

## 许可证

本项目按 MIT License 授权，详见 [LICENSE](LICENSE)。分发项目时，请保留版权声明与许可文本。
