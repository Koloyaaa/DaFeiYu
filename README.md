# 合成大肥鱼

一个可离线运行的浏览器小游戏。打开 `index.html` 就能开始玩，不需要安装前端框架或启动服务。游戏里的角色都是 AI 娘；“大肥鱼”是 DeepSeek 的代称。

## 怎么玩

- 在游戏区域移动鼠标或手指，选择角色落下的位置；每次放下一位后，需等它碰到其他角色或池底才能继续放置。
- 可以用键盘左右方向键移动，空格放下角色，`R` 重新开始。
- 开局与后续待合成角色从豆包、Mistral、Gemini、MuseSpark、GLM 中按 40%、25%、16%、11%、8% 的概率抽取。
- 角色会弹跳并互相挤动；只有碰撞时才会按撞击位置轻微转动，并很快减速停下。右侧预览会显示角色当前阶段的大小。
- 两个同阶段的角色碰在一起时会合成进化。连续合成，目标是解锁 DeepSeek（大肥鱼）。
- 角色越过上方结束线并稳定停留一小段时间，本局才会结束；落下、弹跳或合成时短暂越线不会误报。
- 右侧图鉴按 豆包 → Mistral → Gemini → MuseSpark → GLM → Qwen → Kimi → Grok → Claude → ChatGPT → DeepSeek 排列。

## 图片与碰撞范围

- `Assets/images/` 保存原图，游戏使用 `Assets/processed/` 中的透明 PNG。
- `Assets/processed/manifest.json` 记录透明像素边界和由人物轮廓简化得到的不规则多边形碰撞箱，每个角色最多 32 个顶点，边缘紧贴抠图轮廓。角色旋转时多边形也会同步旋转。
- 游戏按多边形边缘求交，并用横向扫掠提前排除相距较远的角色；角色位置没变化时会复用已计算的轮廓，降低碰撞计算量。
- 要重新处理原图，可运行 `python scripts/preprocess_assets.py`。处理脚本需要 Pillow、NumPy 和 SciPy。

## GitHub Pages

- 游戏运行时只需要 HTML、CSS、JavaScript、处理后的 PNG 和清单文件。
- Python 脚本只在本地重新抠图和生成碰撞多边形时使用；`Assets/processed/` 中的产物已经随项目保存，GitHub Pages 不需要运行 Python，也不需要安装这些 Python 依赖。
