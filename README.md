---
title: Astrix Space Odyssey
emoji: 🚀
colorFrom: blue
colorTo: indigo
sdk: static
pinned: false
---

# Astrix Space Odyssey
Hardcore Sci-Fi Real-time Multiplayer Space Strategy Game.

> **为什么这里是 `static` 而不是 `docker`（2026-09-30 实测）**：
> 游戏的公网真联机需要 `server.mjs` 提供 `/api/online/*`，本应由 `sdk: docker` 承载；
> 但 HuggingFace 已不再为**免费账号**提供 cpu-basic 计算配额——把它改成 `docker` 后
> Space 立即报 `Quota exceeded for flavor cpu-basic (requested=1): current=0, limit=0`
> 并进入 `PAUSED`，整站 503。官方论坛工作人员原话：
> 「Creating a Space that runs on compute (Gradio or Docker) requires a paid plan.
> This includes converting an existing Static Space to Gradio or Docker.」
> 因此在免费额度下只能维持 `static`（**单机 + NPC 星系**可玩；在线集市 / 公频 / 攻防不生效）。
> 服务器的持久化与联机能力已完整实现并自检通过，迁移到任何能跑 Node 的容器主机即可启用，
> 见 `docs/HF_ONLINE_FEASIBILITY.md` 与 `docs/HF_STATE_PERSISTENCE.md`。
