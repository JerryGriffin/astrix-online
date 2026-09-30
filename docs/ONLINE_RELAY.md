# 公网联机（无服务端广播世界）

> 目标：在 **HuggingFace 免费额度**下让公网真正可以联机 —— 不用 WorkBuddy 的发布能力、
> 不加任何付费计划、不改动已有玩法逻辑。

---

## 〇、结论摘要

| 项 | 结论 |
|---|---|
| HF 免费层能否跑 `server.mjs` | **不能**。官方政策：运行计算的 Space（Gradio / Docker）创建即需付费；本账号 `cpu-basic` 配额实测为 `0` |
| 采取的方案 | 站点保持 **纯静态**；联机改为**浏览器直连公共 MQTT 代理的广播世界**，没有服务端参与 |
| 前端改动量 | 新增 2 个模块（`js/net/mqtt.js`、`js/core/relay.js`），`cloud.js` 换传输层，`galaxy.js` 加状态条与真实名录拉取 |
| 玩法改动量 | **零**。上层业务逻辑（扣款、入库、信箱、战报）一行未动 |
| 费用 | **0 元**。无需账号、无需注册、无需 API key |
| 本地/局域网行为 | **不变**，仍走自带权威服务端 `server.mjs`（重启不丢世界） |
| 自检 | `docs/selfcheck_relay_online.mjs`（46 项）+ `docs/selfcheck_online_transport.mjs`（30 项），全绿 |

---

## 一、为什么必须换模型

HuggingFace 免费账号的 `cpu-basic` 配额为 0，官方论坛工作人员原话：

> Creating a Space that runs on compute (Gradio or Docker) requires a paid plan.
> This includes converting an existing Static Space to Gradio or Docker.

实测把 `README.md` 的 `sdk` 改成 `docker` 后，Space 运行态立即返回
`Quota exceeded for flavor cpu-basic (requested=1): current=0, limit=0`，整站 503。

因此公网上**不存在能执行 `server.mjs` 的运行时**，`/api/online/*` 永远是 404。
要把联机救回来，只能让**客户端自己**承担原来服务端的角色。

---

## 二、架构

```
                  ┌──────────────────────────────────────────┐
                  │  HuggingFace Space（sdk: static，免费）    │
                  │  index.html + js/ + css/ —— 纯静态文件分发  │
                  └───────────────────┬──────────────────────┘
                                      │ 浏览器打开即得客户端
              ┌───────────────────────┴───────────────────────┐
              │                玩家 A（浏览器）                │
              │  cloud.js ── 传输选路 ─┬─▶ 同源 REST（本地/局域网）│
              │                       └─▶ relay.js（公网）     │
              │                            │                  │
              │            ┌───────────────┴────────────┐     │
              │            │  本地物化世界 world{}       │     │
              │            │  commanders / chat /        │     │
              │            │  listings / soldIds         │     │
              │            └───────────────┬────────────┘     │
              └────────────────────────────┼──────────────────┘
                                           │ wss://（MQTT 3.1.1 over WebSocket）
                    ┌──────────────────────┴──────────────────────┐
                    │        公共 MQTT 代理（broker.emqx.io 等）    │
                    │   astrix/v022/<room>/{presence,chat,market,  │
                    │                        snapshot,raid}        │
                    │   多代理候选 + 自动重连 + 故障轮换             │
                    └──────────────────────┬──────────────────────┘
                                           │
              ┌────────────────────────────┴──────────────────┐
              │                玩家 B（浏览器）                │
              │     同一份 world{} —— 不需要任何人当服务器       │
              └───────────────────────────────────────────────┘
```

**权威性从「一台服务器」变成「一组客户端的确定性物化」**：
每个客户端把收到的事件按**同一套确定性规则**处理成本地世界，因此所有人看到同一份状态，
而不需要任何一方去「计算」它。这在服务端不可得的前提下是唯一可行的模型。

---

## 三、传输层：零依赖 MQTT 客户端

`js/net/mqtt.js` 自实现 MQTT 3.1.1 最小子集，**不引入任何依赖**（与项目「零依赖原生 ES 模块」一致）：

| 已实现 | 有意不实现 |
|---|---|
| CONNECT / CONNACK | QoS 1 / 2 与重传 |
| SUBSCRIBE / SUBACK | 遗嘱消息（Will） |
| PUBLISH（QoS 0，支持 retain） | 用户名 / 密码认证 |
| PINGREQ / PINGRESP（保活） | UNSUBSCRIBE、MQTT 5 属性 |
| DISCONNECT | |

三个要点，都是踩出来的：

1. **增量解析必须支持跨帧拼接**：代理可能把报文合并或拆分，解析器按「固定头 → varint 剩余长度 →
   `index + remaining <= 可见字节数`」判断完整性，不够就等下一次 `onmessage`。
2. **`error` 事件不一定伴随 `close`**：实测（Windows + undici）对不可达代理发起 WebSocket
   只触发 `error`、**永不触发 `close`**。若把重连只挂在 `close` 上，客户端会**永久卡在第一个代理**。
   因此所有失败路径统一收敛到一个带幂等保护的 `fail()` 出口。
3. **轮换与原地重连要分开**：连都没连上 → 轮到下一个代理；已建立后被断开 → **原地重连**。
   不同代理拥有各自独立的世界，随意轮换会把玩家打散到不同世界里。

候选代理（可扩展）：

```
wss://broker.emqx.io:8084/mqtt
wss://broker.hivemq.com:8884/mqtt
wss://test.mosquitto.org:8081/
```

---

## 四、世界层：主题、事件与不变量

主题命名：`astrix/v022/<room>/<channel>`；`<room>` 取自 `?room=xxx`，规范化到 `[a-z0-9_-]{1,24}`，默认 `main`。

| channel | 事件 | 说明 |
|---|---|---|
| `presence` | `{t:'presence', commanderId, callsign, planetNameCn, defensePower, shieldUntil, goods…}` | 在线心跳，10 秒一次 |
| `chat` | `{t:'chat', id, senderId, senderName, text, time}` | 星区公频 |
| `market` | `{t:'listing'\|'claim'\|'sold', …}` | 挂单 / 采购声明 / 成交公告 |
| `raid` | `{t:'raid', targetId, attackerId, fleetPower, win, shieldUntil, at}` | 进攻实时战报 |
| `snapshot` | `{t:'snapshot', at, commanders[], chat[], listings[], soldIds[]}` | **retained** 世界快照 |

几条必须守住的规则（都有对应断言）：

- **快照用 retained 消息发布** → 后来者一订阅就拿到世界，**不需要等任何人上线**。
  实测 `broker.emqx.io` 支持 retained。若某代理不支持，则回落到 `hello` 广播请同伴补发。
- **快照按 `at` 单调（LWW）**：只接受比本地更新的快照，避免旧快照覆盖新状态。
- **`soldIds` 防复活**：已售货单记入集合并随快照传播，**快照不会把已成交的货单复活**。
- **`shieldUntil` 单调递增**：旧事件不能把已生效的免战力场抹掉。
- **入站一律净化 + 限幅**：公共主题任何人都能发布，必须假定载荷是敌意的 ——
  走字段白名单、字符串截断（呼号 48 / 正文 200）、数量上限（指挥官 200 / 公频 80 / 挂单 50）。
- **邮箱绝不进世界**：`buildLocalSnapshot()` 含 `email`，中继侧在 `sanitizeCommander()` 里显式剔除。
  服务端链路的 `/api/online/commanders` 本来就是白名单构造，不受影响。
- **房间隔离**：不同 `<room>` 的消息互不可见（断言覆盖）。

### 集市成交的确定性仲裁

没有服务端裁判，用**固定仲裁窗口**近似「先到先得」：

1. 买家广播 `claim {listingId, claimId, at}`（同时记入本地）；
2. 等待 `CLAIM_WINDOW_MS = 1200ms`，收集同一 `listingId` 的所有声明；
3. 按 **(at, claimId) 全序**选出唯一赢家（该规则是确定性的，各端独立计算结论一致）；
4. 未中签者据此**退款**并提示「已被其他指挥官抢先采购」；中签者广播 `sold`，各端移除该货单。

---

## 五、选路：两条链路，一套接口

`cloud.js` 只做一件事：**探测同源服务端是否存在**，然后把自己分派到对应实现。

```
GET /api/online/status → 200 { ok: true }  ⇒ 'server'（本地 / 局域网 / 未来付费容器）
                        → 404 / 抛错        ⇒ 'relay' （HuggingFace 静态托管）
```

对外的 8 个函数名与返回形状**完全一致**，UI 与上层业务逻辑不感知走的是哪条：

| 函数 | 服务端链路 | 中继链路 |
|---|---|---|
| `syncOnlineServer` | `POST /api/online/heartbeat` | `publishPresence()` |
| `fetchRemoteGalaxyRegistry` | `GET /api/online/commanders` | `listPlayers()` |
| `fetchOnlineChatMessages` | `GET /api/online/chat` | `listChat()` |
| `sendOnlineChatMessage` | `POST /api/online/chat` | `sendChat()` |
| `fetchOnlineMarketListings` | `GET /api/online/market` | `listListings()` |
| `listOnlineMarketItem` | `POST /api/online/market/list` | `createListing()` |
| `buyOnlineMarketItem` | `POST /api/online/market/buy` | `claimListing()`（含仲裁） |

外加两条韧性规则：

- **服务端中途不可用 → 本次会话永久降级到中继**（`degradeToRelay()`），避免每次调用白等一次超时。
- **`resetTransport()`** 可复位探测，供自检使用，也用于「服务端稍后上线」的场景。

---

## 六、本次顺带修掉的两处既存缺陷

都不是新引入的，而是「联机看起来能用、其实没用」的真正原因：

1. **星图里从来只有 NPC**：`fetchRemoteGalaxyRegistry` 一直被 `galaxy.js` 导入却**从未被调用**，
   星图读的是本地缓存 + NPC 常量。现在进入星区时会拉取真实名录并回填缓存、重绘一次。
2. **公频列表永远是空的**：`fetchOnlineChatMessages()` 返回**裸数组**，而公频 UI 读的是
   `res.messages` 与 `m.senderId / m.senderName / m.time`；服务端产出的却是
   `{ from, commanderId, text, at }` —— 三处字段全对不上。
   现在在 `cloud.js` 里统一归一为 `{ messages: [{ id, senderId, senderName, text, time }] }`，
   **两条链路共用同一形状**。

---

## 七、已知边界（不掩饰）

| 边界 | 影响 | 缓解 |
|---|---|---|
| 公共代理无 SLA | 代理抖动/限流会导致短暂断线 | 3 个候选代理 + 自动重连 + 保活探测 |
| 主题公开 | 任何人都能订阅/发布 | 字段白名单 + 长度/数量限幅；`?room=` 提供**隔离**而非保密 |
| 世界是会话级的 | 代理不提供持久化，无人在线时世界自然消散 | 与「HF 免费层容器磁盘重启即丢」的既有结论一致，不构成回退；玩家自身存档在 localStorage，**不受影响** |
| 仲裁窗口 | 极窄窗口内理论上仍可能双买 | 业余规模可接受；如需强一致需回到真服务端 |
| 无身份认证 | 任何人可用任意 `commanderId` 发言/挂单 | 沿用原设计前提（无账号体系），属独立产品决策 |
| 中继只送达不裁判 | 进攻胜负仍由进攻方本地结算（沿用原设计） | 被攻击方会收到实时战报与 12 小时免战力场 |

---

## 八、验证方法与结果

```
node docs/selfcheck_relay_online.mjs      # 46 项：报文编解码 + 真实代理上的中继层物化
node docs/selfcheck_online_transport.mjs  # 30 项：两种部署环境的选路 + 公频契约 + 降级
```

两个探针都**真的连上公共代理收发报文**，不满足于测序列化函数。覆盖：编解码往返（含 varint、
跨帧拼接、UTF-8、retain）、代理故障切换、presence/chat/market/sold/raid/snapshot 物化、
入站净化与限幅（含邮箱不外泄）、成交仲裁双向（有竞争被拒 / 无竞争成交并广播）、
快照不复活已售货单、房间隔离、畸形载荷不影响链路、retained 快照引导、
两条链路的选路与形状一致性、服务端失败自动降级、房间号规范化。

回归：`selfcheck_v005`(1400) / `v006`(200) / `materials` / `render` / `online_state`(36) /
`server_surface`(66) 全绿；`_probe_galaxy` / `_probe_text` / `_probe_land` / `_probe_mods` /
`_probe_anomaly` / `_probe_fleet` / `_probe_army` / `_probe_inv` / `_probe_gather_lock` 全部通过。

---

## 九、运维手册

**与朋友单独开一局（避免与陌生人共用世界）**
把 `?room=<自定房间号>` 加到网址后面，例如
`https://recapiut-astrix-online.static.hf.space/?room=wo-de-xingqu`。
房间号规范化到小写字母/数字/连字符，会记进 localStorage，之后不带参数也沿用。

**判断当前走的是哪条链路**
星区界面顶部状态条：`📡 公网中继 · 已连接（N 人在线）` 或 `📡 本地服务端 · 已连接`；
离线单机显示 `📡 离线模式`。鼠标悬停可看到实际代理地址与房间号。

**换代理 / 加代理**
改 `js/core/relay.js` 顶部的 `BROKERS` 数组即可，按顺序尝试、失败自动轮换。

**排查**
- 状态条一直「连接中…」：多半是本地网络或代理被拦；先用 `js/net/mqtt.js` 的
  `createMqttClient` 手工连一个代理验证。
- 换了 `js/` 或 `css/` 任何文件后：`REVISION+1` → `node docs/bump_imports.mjs`。
  **新建了 `docs/*.mjs` 探针后也要再跑一次 `bump_imports.mjs`**，否则探针 import 的是
  无标签路径，会拿到**第二份模块实例**（两份 `world`），断言会莫名其妙地失败。
