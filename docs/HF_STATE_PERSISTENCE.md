# 全服状态持久化（`server.mjs`）

解决什么问题：**公网联机时，全服数据在容器重启后会全部归零。**

## 前置说明：这份文档服务于"能跑 Node 的主机"，不是 HF 免费层

2026-09-30 实测确认：**HuggingFace 免费账号无法运行 Docker Space**（`cpu-basic` 配额为 0），
因此 HF 目前只能托管 `sdk: static` 的静态站点 —— 那种形态下 `server.mjs` 根本不被执行，
本文档的持久化机制也就无从谈起。

本文档适用于以下场景：

| 场景 | 后端 | 状态 |
|---|---|---|
| **本地 / 局域网**（`start_online.bat`） | `file` | ✅ **现在就能用**，重启世界不丢 |
| 任一能跑 Node 单端口 HTTP 服务的主机（自建 VPS、其他 PaaS、WorkBuddy 发布） | `file`（或配 `hf`） | ✅ 可用 |
| HuggingFace Space（付费 PRO 的 Docker Space） | `hf` | ⚠️ 需先付费解锁计算型 Space |

（HuggingFace 的 `hf` 数据集后端已实现，配置方法见第三节；若将来 HF 解锁或换到其他主机，按需启用。）

---

## 一、问题成因

`server.mjs` 的全服数据（`ONLINE_STORE`）只活在 Node 进程内存里，包含四块：

| 结构 | 内容 |
|---|---|
| `commanders` | 全服指挥官名录（呼号、母星、防御战力、免战力场到期时间） |
| `chatMessages` | 全服公频消息（上限 80 条） |
| `tradeListings` | 集市挂单 |
| `inbox` | 每位指挥官的攻防战报与贸易结算回执 |

HuggingFace 官方文档对免费层磁盘的原文是：

> Every Space comes with a small amount of disk storage. This disk space is ephemeral,
> meaning **its content will be lost if your Space restarts or is stopped**.

于是下面任一情况都会清零：

1. 免费层 **48 小时无访问自动休眠**，唤醒时容器从镜像冷启动；
2. **每次 `git push` 触发的重新构建**（本项目约定每次更新都推送，实际最常触发）；
3. 在 Space 页面手动 Restart，或平台侧维护迁移。

官方给免费层指了两条路：升级付费持久盘（$5/月起），或**用一个 Dataset 仓库当数据存储**。本项目实现后者——不花钱、不动架构。

> **注意：丢的不是玩家的游戏进度。** 玩家的星球、物资、人口、舰队、研究进度存在浏览器 localStorage 的独立存档池里，与服务器无关。清零的只是「服务器上那份公共记录」。

---

## 二、方案：三层后端，按配置自动选择

| 后端 | 触发条件 | 快照落点 | 能否跨容器重建恢复 |
|---|---|---|---|
| `hf` | `HF_TOKEN` + `HF_STATE_REPO` 均已配置 | 私有 Dataset 仓库 | **能** |
| `file` | 未配 HF 时（默认） | `data/online-state.json`（可用 `ASTRIX_STATE_FILE` 改） | 不能（容器磁盘同样临时），但本地/局域网部署是真持久 |
| `memory` | `ASTRIX_STATE_DISABLE=1` | 不落盘 | 不能（旧行为） |

**缺配置或凭据失效都不会报错**：服务照常以内存态起服，在线玩法不受影响，只是这次没持久化。失败原因如实写进 `/api/online/status` 的 `lastError`（已做令牌脱敏）。

### 落盘时机

- 变更打脏标记 → **节流合并** → 定时刷盘。`file` 后端 2.5 秒；`hf` 后端 60 秒（避免刷爆 Hub 提交历史）。
- 进程收到 `SIGINT` / `SIGTERM` 时立即刷盘（HuggingFace 休眠 / 重建前会发 `SIGTERM`，这一步保住最后一段变更）。
- `exit` 时对 `file` 后端再做一次同步刷盘兜底。
- **心跳不会触发刷盘**：心跳每 10 秒一次，但只有 `lastSeen` 在变。只有会被写进快照的字段（呼号 / 母星 / 防御战力 / 货架等）真的变了才打脏标记，否则会以心跳频率无谓刷盘。

> Windows 限制：`SIGTERM` 在 Windows 上是**无条件终止**、不执行 Node 处理器，所以「停机刷盘」在 Windows 上不生效——周期保存才是主路径。Linux（含 HF 容器）不受此限。

### 快照内容与恢复规则

快照**只存玩家产生的数据**，代码预置的内容不入快照、启动时由代码权威重建：

| 数据 | 恢复规则 |
|---|---|
| NPC 势力（4 个） | 不入快照，每次启动从代码预置 → 代码改了价格 / 防御战力立即生效 |
| 种子公频欢迎语（2 条） | 不入快照，每次启动保留 |
| NPC 常驻货架（`trade_init_1~3`） | 不入快照；但**已被买走的记录会持久化**，重启后不会复活 |
| 真实玩家指挥官 | 恢复；超过 **7 天**未上线的记录不再恢复 |
| 玩家公频 / 挂单 / 信箱 | 恢复；超过 **7 天**的条目不再恢复 |

单条上限：公频 80 条、挂单 50 条、每人信箱 30 条（与内存态一致）。

---

## 三、配置步骤（启用 `hf` 后端）

1. **准备一个访问令牌**：HuggingFace → Settings → Access Tokens → 新建一个 **Write** 权限的令牌（需要能提交 / 创建数据集仓库）。
2. **在 Space 里配置**：打开 `https://huggingface.co/spaces/Recapiut/astrix-online/settings`，在 **Secrets** 里新增：
   - `HF_TOKEN` = 上一步的令牌
   - `HF_STATE_REPO` = `Recapiut/astrix-online-state`（形如 `用户名/仓库名`；**仓库不存在时服务会自动创建为私有数据集**）
3. **重启 Space**（新增 Secret 后需重新构建 / 重启才注入环境变量）。
4. **验证**：访问 `https://recapiut-astrix-online.hf.space/api/online/status`，应看到：

```json
{
  "ok": true,
  "state": {
    "backend": "hf",
    "backendDetail": "huggingface 数据集快照 (Recapiut/astrix-online-state)",
    "restored": false,          // 首次为 false；此后重启应变为 true
    "lastSavedAt": 0,           // 有玩家活动并落盘后变为时间戳
    "lastError": ""             // 为空表示一切正常；非空即为失败原因（已脱敏）
  }
}
```

5. **确认持久化真的生效**：两名玩家互发一条公频消息 → 等 60 秒以上 → 再看 `lastSavedAt` 是否更新、`dirty` 是否为 `false`；然后在 Space 页面点 Restart，重启后再看 `restored` 是否变成 `true`、消息是否还在。

### 环境变量总表

| 变量 | 必需 | 默认 | 说明 |
|---|---|---|---|
| `PORT` | 否 | `8080` | 容器内监听端口，`Dockerfile` 里设为 `7860`（HF 契约） |
| `HF_TOKEN` | 与下一项成对 | — | HF 访问令牌，需写权限 |
| `HF_STATE_REPO` | 与上一项成对 | — | 快照数据集仓库 `用户名/仓库名` |
| `HF_ENDPOINT` | 否 | `https://huggingface.co` | 上游地址（走镜像 / 自建 Hub 时才需要） |
| `ASTRIX_STATE_FILE` | 否 | `data/online-state.json` | `file` 后端的快照路径 |
| `ASTRIX_STATE_DISABLE` | 否 | — | 置 `1` 完全关闭持久化，退回纯内存 |

---

## 四、本地与局域网部署

不需要任何配置，自动走 `file` 后端，快照写在 `data/online-state.json`（已进 `.gitignore`）。
本机 `start_online.bat` 重启后世界仍在，这就是 `file` 后端的直接收益。

```bash
# 指定快照位置
ASTRIX_STATE_FILE=/tmp/astrix-state.json PORT=8080 node server.mjs

# 完全关闭持久化（退回旧行为）
ASTRIX_STATE_DISABLE=1 node server.mjs
```

---

## 五、自检

```bash
node docs/selfcheck_online_state.mjs
```

该探针走的是**真实重启路径**，不是只测序列化函数：起服务 → 造玩家数据（注册 / 公频 / 挂单 / 攻防 / 成交）→ 等落盘 → 停机 → 用同一快照重启 → 断言全服状态已恢复（36 项断言）。它用 `ASTRIX_STATE_FILE` 指向临时文件、监听 8137 端口，不触碰真实快照、也不占用 8080。

---

## 六、已知限制

1. **`hf` 后端仍有 60 秒的落盘窗口**：容器被强行杀死（非 `SIGTERM`）时最多丢失约 60 秒的变更。对以单机种田为主、联机为点缀的玩法，这个代价可接受。
2. **不解决"账号"问题**：本方案持久化的是全服公共状态，不是玩家存档。玩家换浏览器 / 清 localStorage 仍会丢自己的进度（这是既有设计，与本文档无关）。
3. **`hf` 后端的写路径未在真实账号上端到端验证过**：请求格式取自 HuggingFace 官方 OpenAPI 规范（`POST /api/datasets/{ns}/{repo}/commit/main`，NDJSON 载荷），代码已按规范实现，并对「凭据无效 / 仓库不存在 / 网络不可达」做了降级验证；但"提交成功并能在重启后读回"这一步需要配置真实令牌后才能确认。启用后请按第三节第 5 步走一遍。
