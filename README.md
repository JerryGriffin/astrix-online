---
title: Astrix Space Odyssey
emoji: 🚀
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Astrix Space Odyssey
Hardcore Sci-Fi Real-time Multiplayer Space Strategy Game.

> `sdk: docker` 是**有意**选择：游戏的公网真联机依赖 `server.mjs` 提供 `/api/online/*`，
> `sdk: static` 只做文件分发、不执行 Node 进程，会让在线模式静默降级为单机 + NPC 星系。
> 容器监听 7860（见 `Dockerfile` 的 `ENV PORT=7860`）。
> 全服状态的持久化见 `docs/HF_STATE_PERSISTENCE.md`。
