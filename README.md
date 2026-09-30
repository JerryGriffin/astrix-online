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

> **联机怎么跑（rev17 起）**：站点是纯静态的，公网联机**不需要服务器**——
> 浏览器直连公共实时消息代理，由在线玩家共同维护同一份全服世界（在线集市、星区公频、
> 真实玩家名录、被真人进攻时的实时战报与免战力场）。**免费、无需账号、无需注册**。
> 实现与边界见 `docs/ONLINE_RELAY.md`。
> 本地与局域网仍走自带权威服务端 `server.mjs`（重启不丢世界），
> 客户端会**自动选路**，两条链路对 UI 完全一致。
>
> **为什么这里仍是 `static` 而不是 `docker`（2026-09-30 实测）**：
> HuggingFace 已不再为**免费账号**提供 cpu-basic 计算配额——把它改成 `docker` 后
> Space 立即报 `Quota exceeded for flavor cpu-basic (requested=1): current=0, limit=0`
> 并进入 `PAUSED`，整站 503。官方论坛工作人员原话：
> 「Creating a Space that runs on compute (Gradio or Docker) requires a paid plan.
> This includes converting an existing Static Space to Gradio or Docker.」
> 所以公网上不存在能执行 `server.mjs` 的运行时，联机改由中继承担。
> 若日后升级到能跑 Node 的容器主机，`server.mjs` 可零改动接管（同源托管静态资源与 API）。
> 相关文档：`docs/ONLINE_RELAY.md`（公网中继联机）、`docs/HF_ONLINE_FEASIBILITY.md`（可行性实测）、
> `docs/HF_STATE_PERSISTENCE.md`（全服状态持久化）、`docs/SERVER_HARDENING.md`（暴露面收敛）。
