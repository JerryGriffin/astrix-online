// 全局状态管理、多存档位（离线）与适配器抽象层（Astrix）
// 离线模式存档在 localStorage；在线模式共用同一结构，读写走 adapter，便于后续接云服务。
//
// ============================================================================
// v0.0.5 关键改动
// ============================================================================
// 1. 采集产出必须**从星球储藏里扣**：每个物品条目新增 remaining（剩余储量），
//    采多少扣多少，采尽则增速归零。此前是「凭空虚增」，与星球数据脱节。
// 2. 采集速率改由**分配的人力**驱动（露天采集工→地表；浅层/深层矿井工→地下；
//    地心矿井工→地核；大气收集器工→气体），不再用「可用人力」近似。
//    这落实了设计者定的规则：没人工作的资源不凭空产生。
// 3. 营养代谢扩为 3 消耗 + 3 产出：
//    每人每秒消耗 氧气/有机质/水 各 0.01，产出 二氧化碳 0.01、甲烷 5e-4、氨气 5e-4。
// 4. 星球实例新增 buildings（{建筑id: 座数}）与 buildQueue（施工队列）；
//    开局自带 1 座建筑工厂（设计者：「开局有一个建筑工厂」）。
// 5. 施工队列由 tick 推进：速度 = 建筑工有效人力（受建筑工厂工位限制），无人则为 0。

import { PLANETS } from '../data/planets.js?v=21.6';
import { BUILDING_BY_ID, buildingCost } from '../data/buildings.js?v=21.6';
import { TECH_BY_ID, canResearch, missingPrereqs } from '../data/techs.js?v=21.6';
import { UPGRADES, upgradeCost } from '../data/upgrades.js?v=21.6';
import {
  createPopulation, tickPopulation, getAvailable, gatherLaborByLayer, jobsOfBuilding, getIntensity,
  consumptionPerSec, jobOutput,
  JOBS, freeSlots,
} from './population.js?v=21.6';
import { buildRateOf, buildBlockReason } from './construction.js?v=21.6';
import { tickShip, defaultBlueprints, createShip, shipBuildTick } from './shipyard.js?v=21.6';
import { tickArmyBuildLines, armyStatsOf } from './army.js?v=21.6';
// v0.0.6：电力系统与配方生产。
// 注意这两个模块**不反向 import 本文件**（否则形成循环依赖），
// 它们只从传入的 inst 上读 buildings / pop / inventory / recipes。
import { energyOf, computePower, tickPower } from './power.js?v=21.6';
// v0.0.91：efficiencyBonus 由 production.js 导出（建筑总座数效率乘数），
//   这里沿用既有的 state→production 单向边引入，不反向让 production import state，避免循环依赖。
import { tickProduction, productionRates, ensureLines, lineWorkersTotal, efficiencyBonus, ensureEntry, addLine as addProductionLine, lineSlotInfo } from './production.js?v=21.6';
// v0.0.92：星际航行与殖民（管理模式 / 独立倾向 / 随机星球）
import { tickIndependence, outputMulOf, happinessDeltaOf, ensureDiscoveredDefaults, discoverPlanet, purgeShopColonies, tickManagedColonies, SHOP_PLANET_CODE } from './planetgen.js?v=21.6';
// v0.1.2（需求 18/19）：永久升级的「效果」改乘方，唯一实现在 data/upgrades.js#upgradeMul
// （UI 的 research.js 也用它，别在别处再写一套公式）。
// 此前 upg_collect/refine/power/labor/research/build 六项付了钱却没有任何效果。
import { upgradeMul } from '../data/upgrades.js?v=21.6';
import { tickFleetMissions, ensureFleets } from './fleet.js?v=21.6';
// v0.1.0：电脑账号（离线存档里的 NPC 势力）与其交易池联动。
//   注意 npc.js 是叶子模块（只 import 数据表），shop.js 与 state.js 互为函数级引用、无顶层副作用。
import { ensureNpcs, tickNpcs } from './npc.js?v=21.6';
import {
  priceOf as shopPriceOf, suggestPriceOf as shopSuggestPriceOf,
  npcListOnMarket, npcTakeFromMarket, tickShop as shopTick,
  tickListings as shopTickListings,
} from './shop.js?v=21.6';

const SAVE_PREFIX = 'astrix.save.';
const INDEX_KEY = SAVE_PREFIX + 'index';
const PLANETS_KEY = SAVE_PREFIX + 'planets.';   // 每个账号的星球实例存档前缀
export const AUTOSAVE_INTERVAL = 10;            // 自动存档间隔（秒）

// 适配器抽象：当前实现为 localStorage，后续可整体替换为云端实现
let adapter = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 配额或隐私模式忽略 */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
};

// 注入新的适配器（如云端适配器），game 启动时调用
export function setAdapter(a) { adapter = a; }

// 全局可变状态
export const STATE = {
  mode: 'offline',          // 'offline' | 'online'
  accounts: [],             // 离线多存档位数组
  currentAccountId: null,
  planets: [],              // 运行时星球实例
  ui: {},                   // UI 临时状态（预留）
};

function genId() {
  return 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 默认账号结构（与在线账号保持一致，方便迁移）
function defaultAccount(name) {
  return {
    id: genId(),
    name: name || '深空旅人',
    createdAt: Date.now(),
    homePlanetCode: 'syl',
    planetsOwned: ['syl1'],
    resources: {},          // 资源拥有量：{ 资源名: 数量 }
    tech: [],               // 已研究科技 id 数组
    researchPoints: 0,      // 研究点
    upgrades: {},           // 永久升级等级 { upgId: level }
    buildings: [],          // 旧版字段（保留兼容）；v0.0.5 起建筑计数在星球实例上
    ships: [],              // 舰船实例数组
    blueprint: null,        // 船坞蓝图（惰性初始化为 emptyBlueprint()）
    armies: [],             // 陆战部队编制实例数组（v0.2.0）
    armyBuildLines: [],     // 部队整编产线数组（v0.2.0）
    stats: { playTimeSec: 0, planetsCaptured: 0, resourcesCollected: 0 },
  };
}

// 从适配器载入全部存档到 STATE
export function loadState() {
  try {
    const raw = adapter.get(INDEX_KEY);
    if (!raw) {
      STATE.accounts = [];
      STATE.currentAccountId = null;
      return STATE;
    }
    const idx = JSON.parse(raw);
    STATE.mode = idx.mode || 'offline';
    STATE.currentAccountId = idx.currentAccountId || null;
    STATE.accounts = (idx.ids || [])
      .map((id) => {
        const a = adapter.get(SAVE_PREFIX + id);
        try { return a ? JSON.parse(a) : null; } catch (e) { return null; }
      })
      .filter(Boolean);
    if (!STATE.accounts.find((a) => a.id === STATE.currentAccountId)) {
      STATE.currentAccountId = STATE.accounts[0] ? STATE.accounts[0].id : null;
    }
    // 星球实例（含物品栏与产出）按账号分别持久化，刷新后进度不丢
    STATE.planets = loadPlanets(STATE.currentAccountId);
  } catch (e) {
    STATE.accounts = [];
    STATE.currentAccountId = null;
    STATE.planets = [];
  }
  return STATE;
}

// 读取指定账号的星球实例数组（解析失败返回空数组）
function loadPlanets(accountId) {
  if (!accountId) return [];
  try {
    const arr = JSON.parse(adapter.get(PLANETS_KEY + accountId) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

// 把 STATE 中的账号与索引写回适配器
export function saveState() {
  const idx = {
    mode: STATE.mode,
    currentAccountId: STATE.currentAccountId,
    ids: STATE.accounts.map((a) => a.id),
  };
  adapter.set(INDEX_KEY, JSON.stringify(idx));
  STATE.accounts.forEach((a) => {
    // v0.0.8：每次落盘把当前时间戳记到账号上，供离线收益结算（settleOffline）算离线时长。
    // 用 acc.stats.lastSeen 而非新建顶层字段，老存档（没有该字段）读不到就按「不结算」处理，兼容安全。
    if (!a.stats || typeof a.stats !== 'object') a.stats = {};
    // v0.1.1（需求 23）：只给**当前账号**刷 lastSeen。此前给所有账号刷，导致未登录账号
    // 的离线时长在每次自动存档时都被清零，离线结算永远算不出它们的离线时间。
    if (a.id === STATE.currentAccountId) a.stats.lastSeen = Date.now();
    adapter.set(SAVE_PREFIX + a.id, JSON.stringify(a));
  });
  // 星球实例按当前账号持久化（此前只存账号不存星球，导致刷新后进度归零）
  if (STATE.currentAccountId) {
    adapter.set(PLANETS_KEY + STATE.currentAccountId, JSON.stringify(STATE.planets));
  }
}

// 新建账号并切换为当前账号
// mode（v0.1.0）：'fresh'（初登星球，默认）/ 'deep'（漫溯深空，中期开局）
export function createAccount(name, mode) {
  const acc = defaultAccount(name);
  STATE.accounts.push(acc);
  STATE.currentAccountId = acc.id;
  // v0.0.51：新存档必须**从零开始**。
  // 此前不清空 STATE.planets，于是下一个新账号的 getPlanetInstance('syl')
  // 会直接命中上一个账号留下的同名星球实例，新档开局就带着旧档的全部进度。
  STATE.planets = [];
  saveState();
  // v0.1.0：「漫溯深空」开局 —— 建立母星实例后一次性铺科技/建筑/物资/飞船
  if (mode === 'deep') {
    try {
      const inst = getPlanetInstance(acc.homePlanetCode);
      applyDeepStart(acc, inst);
    } catch (e) { /* 失败也要保证基础存档可用 */ }
  }
  return acc;
}

// 切换到指定账号
export function switchAccount(id) {
  if (STATE.accounts.find((a) => a.id === id)) {
    saveState();                      // 先落盘旧账号的进度
    STATE.currentAccountId = id;
    STATE.planets = loadPlanets(id);  // 再载入新账号的进度，避免存档串数据
    saveState();
  }
}

// 删除账号（同时清掉其 localStorage 条目）
export function deleteAccount(id) {
  STATE.accounts = STATE.accounts.filter((a) => a.id !== id);
  if (STATE.currentAccountId === id) {
    STATE.currentAccountId = STATE.accounts[0] ? STATE.accounts[0].id : null;
    // v0.0.51 修复数据串档：删掉的若是当前账号，STATE.planets 里装的还是它的星球实例，
    // 紧接着的 saveState() 会把这些旧数据写进**新 currentAccountId（另一个存档）**名下，
    // 于是「删 A」反而把 A 的进度灌进了 B。这里与 switchAccount 一样重载一次目标存档。
    STATE.planets = loadPlanets(STATE.currentAccountId);
  }
  adapter.del(SAVE_PREFIX + id);
  adapter.del(PLANETS_KEY + id);
  saveState();
}

// 取当前账号对象
export function currentAccount() {
  return STATE.accounts.find((a) => a.id === STATE.currentAccountId) || null;
}

// ============================================================================
// 物品栏模型
// 条目结构 { mat, layer, owned, rate, reserve, remaining, abundance, locked }
//   owned      玩家在本星球实际持有的数量
//   rate       当前每秒增速（由分配人力 × 丰度算出）
//   reserve    原始总储量（静态，用于显示比例）
//   remaining  剩余可采储量（动态，被采集扣减）
// ============================================================================

// 每人每秒基础采集量（v0.0.5 保留原口径，后续版本会重做）
// v0.0.52：由 0.001 提到 0.1（100 倍）。
//   旧值下 400 人采石头只有 **0.05/秒**（= 1 × 400/8 × 0.001），
//   UI 上的增速被压成「+0.1/s」，玩家以为「开局采集完全没有增速」。
//   新值：400 人采石头 5/秒（1 分钟 300 个），能明显看到数量在涨。
//   v0.1.2（需求 16）：0.1 → 0.5（再 ×5）。与生产线侧的 V012_LINE_RATE_MUL=5 同步，
//   保证「人采」和「机器造」的提速幅度一致，不会出现某条路突然碾压另一条。
//   新值：400 人采石头 25/秒。
export const BASE_COLLECT_RATE = 0.5;

// v0.1.3（需求 3）：气体层（大气收集器工）采集倍率。玩家要求「大气收集器的效率大幅上调」，
//   取 ×5（与 v0.1.2 的整体 ×5 档位一致）。只乘在气体层的 e.rate 上，别处勿用。
export const GAS_COLLECT_RATE_MUL = 5;

// 资源归类顺序：去重时高优先级优先（同名资源只出现一次，保留所属层）
// v0.0.91：原「underground」拆成「浅层(underground)」与「深层(deep)」两层，
//   储量各自独立（浅层矿井/深层矿井分别开采），故顺序里补入 'deep'。
const LAYER_ORDER = ['surface', 'underground', 'deep', 'core', 'gas'];

// 把任意输入夹取成合法的电力降速比 [0,1]（NaN / 缺省一律当 1）
function clampRatio(r) {
  const v = Number(r);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

// ============================================================================
// 大气层（v0.0.6，需求 R11）
// ============================================================================
// 此前人口代谢产生的二氧化碳 / 甲烷 / 氨气**直接加进 inventory 的 owned**，
// 等于「人呼吸出来的气凭空出现在你的仓库里」——既反直觉，也让大气收集器失去意义。
// 现在这些气体排进 `inst.atmosphere`（惰性初始化自星球 gases，各项从 0 起算）：
//   * 大气收集器采集时**优先**从 atmosphere 取，取完再采原生 `remaining` → 排气可被回收，
//     「呼出 CO₂ → 大气收集器回收 → 农田拿去产有机质」形成闭环；
//   * 「星球储藏」栏显示的气体剩余量也会把它算进去（见 gasAvailable）。
export function atmosphereOf(inst) {
  if (!inst) return {};
  if (!inst.atmosphere || typeof inst.atmosphere !== 'object' || Array.isArray(inst.atmosphere)) {
    const prev = (inst.atmosphere && typeof inst.atmosphere === 'object') ? inst.atmosphere : {};
    const next = {};
    for (const g of (inst.gases || [])) next[g.name] = Number(prev[g.name]) || 0;
    // 旧存档里 atmosphere 里可能已经记了不在 gases 里的气体（例如星球本无氨气），一并保留
    for (const k in prev) if (!(k in next)) next[k] = Number(prev[k]) || 0;
    inst.atmosphere = next;
  }
  return inst.atmosphere;
}

// 某气体当前可采总量 = 原生剩余储量 + 玩家排放累积
// v0.0.61：只统计**气体层**的条目（不再去重后，同一材料可能有多层条目），
//   氧气/氢气这类材料只存在于气体层，但也可能被配方产出成 refined 条目，不能混算。
export function gasAvailable(inst, matName) {
  let base = 0;
  for (const e of (inst.inventory || [])) {
    if (e && e.mat === matName && e.layer === 'gas') base += Math.max(0, Number(e.remaining) || 0);
  }
  return base + (Number(atmosphereOf(inst)[matName]) || 0);
}

// 从星球某气体的「剩余储量 + 大气层累积」里扣掉 amt（先扣原生剩余储量，再扣大气层）
// v0.0.61（需求 3）：人口呼吸的氧气走这里，而不是从物品栏库存里扣。
export function consumeGas(inst, matName, amt) {
  let need = Number(amt) || 0;
  if (!(need > 0)) return 0;
  const atm = atmosphereOf(inst);
  const e = (inst.inventory || []).find((x) => x && x.mat === matName && x.layer === 'gas');
  let taken = 0;
  if (e) {
    const have = Math.max(0, Number(e.remaining) || 0);
    const use = Math.min(have, need);
    e.remaining = have - use;
    taken += use;
    need -= use;
  }
  if (need > 0) {
    const have = Number(atm[matName]) || 0;
    const use = Math.min(have, need);
    atm[matName] = have - use;
    taken += use;
  }
  return taken;
}

// 占领新星球时给的启动物资：{ 资源名, 数量 }（有就给，没有跳过）
// v0.0.6（需求 R2）：**大幅调低**。
//   旧值（有机质/水/氧气 各 1e5）是按开局 1000 人给的，v0.0.6 开局只有 100 人，
//   而那些量足够躺平几十小时，开局完全没有采集压力。
//   新值按 100 人 × 0.002/秒 = 0.2/秒 算，500 可撑约 42 分钟，够摸清系统、必须动手采集。
//
// v0.0.61（需求 3）：**不再给氧气**。氧气改为直接从星球的气体储量里扣，
//   所以它不需要（也不应该）有开局库存。
// v0.1.0（设计者「前期节奏需要大幅加快」）：开局物资大幅增加。
//   旧值 泥土200/石头200/有机质500/水500 —— 前期光采集就要卡很久。
const STARTING_ITEMS = [
  ['泥土', 2000],
  ['石头', 3000],
  ['有机质', 4000],
  ['水', 4000],
  ['石墨', 500],
  ['粘土', 800],
];

// 开局自带的建筑：设计者要求「开局有一个建筑工厂」，否则没有人能施工（死锁）
// v0.0.51：开局自带 1 座建筑工厂 + 5 座房屋。
// v0.0.6：开局人口改为 100 人（需求 R15），5 座房屋共 500 庇护 → 庇护覆盖率 1.0，
//   不再像 1000 人那样一开局就住不下；住房压力改成「人口涨起来之后」才出现。
// v0.0.8：设计者选择「保留耗电，开局多送一座人力发电厂」——
//   人力发电厂每工位 10 电（满员 24 工位可产 240 电），足以撑起建筑工厂(25)
//   加若干生产/采集建筑，避免开局彻底没电的死锁；配合房屋按座数发 12 电×5=60，
//   形成双保险，保证开局即有电可用，玩家能正常施工、采集、推进。
const STARTING_BUILDINGS = { workshop: 1, house: 5, manual_power: 1 };

// 施工队列上限（同时推进的工程数）
export const BUILD_QUEUE_MAX = 5;

// 由星球静态数据生成 inventory 条目
//
// v0.0.61（需求 1）：**不再按名字去重**。
//   此前同名资源只保留「第一个所属层」（按 LAYER_ORDER 优先级），于是所有 7 个星球的
//   「石头」都只留下地表那条 —— 地下的 1e12 与地核的 2e6 被**整个丢掉，根本采不到**。
//   粗银 / 粗金（地下 + 地核）以及各星球地表与地下都有的矿石也有同样的问题。
//   现在每个「(资源, 层)」各成一条，储量分开记录、分开显示、也都能被采。
//
//   条目新增 `key`（= `层:资源名`）作为唯一标识；`mat` 仍是纯资源名，
//   凡是「按材料算总量」的地方（建造扣料、人口代谢、加工配方）都要走
//   ownedOf() / spendOwned() 做跨层聚合，不要直接 find(e => e.mat === name)。
export function buildPlanetInventory(planet) {
  const out = [];
  const seen = new Set();
  for (const layer of LAYER_ORDER) {
    const src = layer === 'gas' ? (planet.gases || []) : (planet.layers?.[layer] || []);
    for (const r of src) {
      const name = r.name;
      const key = layer + ':' + name;
      if (seen.has(key)) continue;
      seen.add(key);
      const amount = Number(r.amount) || 0;
      out.push({
        key,
        mat: name,
        layer,                       // 所属层（surface/underground/core/gas）
        owned: 0,                    // 从**这一层**采到的量（同一材料跨层会各有各的 owned）
        rate: 0,                     // 增速（个/秒），由 tick 计算
        reserve: amount,             // 该层的原始储量
        remaining: amount,           // 该层的剩余储量（采集会扣）
        abundance: r.abundance ?? 0, // 丰度
        locked: layer !== 'surface', // 未投产的层先标记为锁定
      });
    }
  }
  return out;
}

// ============================================================================
// 跨层聚合（v0.0.61，需求 1 的配套）
// ============================================================================
// 同一材料可能同时存在地表 / 地下 / 地核三条条目。
// 「玩家一共有多少石头」应该是三者之和；花掉时也要从多处一起扣。

// 某材料的所有条目（按层序：地表 → 地下 → 地核 → 气体）
export function entriesOf(inst, matName) {
  if (!inst || !Array.isArray(inst.inventory)) return [];
  return inst.inventory.filter((e) => e && e.mat === matName);
}

// 某材料的总持有量（跨层求和）
export function ownedOf(inst, matName) {
  let s = 0;
  for (const e of entriesOf(inst, matName)) s += Number(e.owned) || 0;
  return s;
}

// 花掉某材料 amt 个：从**持有最多**的条目开始扣，扣够为止。
// 返回实际扣掉的量（不足时就是「有多少扣多少」，调用方应先用自己的 hasMaterials 校验）。
export function spendOwned(inst, matName, amt) {
  let need = Number(amt) || 0;
  if (!(need > 0)) return 0;
  const list = entriesOf(inst, matName).sort((a, b) => (Number(b.owned) || 0) - (Number(a.owned) || 0));
  let taken = 0;
  for (const e of list) {
    if (need <= 1e-12) break;
    const have = Math.max(0, Number(e.owned) || 0);
    const use = Math.min(have, need);
    e.owned = have - use;
    taken += use;
    need -= use;
  }
  return taken;
}

// 某材料的总增速（跨层求和）
export function rateOf(inst, matName) {
  let s = 0;
  for (const e of entriesOf(inst, matName)) s += Number(e.rate) || 0;
  return s;
}

// 给星球实例写入初始物资（占领时调用，有同名资源才给；这是殖民补给，不扣星球储藏）
export function applyStartingItems(inst) {
  for (const [name, qty] of STARTING_ITEMS) {
    const e = inst.inventory.find((x) => x.mat === name);
    if (e) e.owned = Math.min(e.reserve, e.owned + qty);
  }
}

// 某层是否已解锁（有对应建筑才能开采）
// v0.0.91：原 underground 拆为「浅层(underground)」与「深层(deep)」两层、各自独立解锁：
//   浅层 → 需要 mine_shallow；深层 → 需要 mine_deep。core / gas 维持原建筑。
//   老存档若仍按旧结构（只有 mine_shallow 的矿井覆盖全 underground）也能正常跑——只是 deep 层无建筑则 locked。
export function layerUnlocked(layer, counts) {
  const has = (id) => Number(counts?.[id] || 0) > 0;
  if (layer === 'surface') return true;              // 露天采集：不需要建筑
  if (layer === 'underground') return has('mine_shallow');
  if (layer === 'deep') return has('mine_deep');     // v0.0.91：深层独立解锁
  if (layer === 'core') return has('mine_core');
  if (layer === 'gas') return has('gas_collector');
  return false;
}

// ============================================================================
// 露天采集的科技门槛（v0.0.7 修复）
// ============================================================================
// 设计者：「在点出深度采集之前只能采集有机质、石头、水、泥土」。
// 此前 recalcRates 给地表**全部**资源算增速，于是石墨/粘土/孔雀石/二氧化硅
// （首次可获得层级为 T1，需要 A1 深度采集）开局就能白嫖 —— 这是 bug。
// 现在：A1 未研究时，地表层只有这 4 种 T0 材料可采，其余条目保持 locked：
// 物品栏/储藏仍能看到它们（灰显），但增速恒为 0，研究出 A1 后立刻可采。
const SURFACE_T0 = new Set(['有机质', '泥土', '石头', '水']);
const DEEP_GATHER_TECH = 't_a1';
function deepGatherUnlocked() {
  const acc = currentAccount();
  const tech = (acc && Array.isArray(acc.tech)) ? acc.tech : [];
  return tech.includes(DEEP_GATHER_TECH);
}

// v0.0.91：本地 5 层采集人力分布。
// population.gatherLaborByLayer 仍把 mine_deep_worker 算进 'underground'（历史口径），
// 而 v0.0.91 需要 deep 层独立计人力，故这里按建筑单独映射成 5 层：
//   surface_gatherer → surface，mine_shallow_worker → underground，
//   mine_deep_worker → deep，mine_core_worker → core，gas_collector_worker → gas。
// 注意：效率乘数 efficiencyBonus 只在下方 recalcRates 的增速公式里乘一次（需求 4），
//   这里返回「裸」有效人力，避免重复叠加。
function gatherLaborByLayerLocal(inst) {
  const pop = inst.pop;
  if (!pop) return { surface: 0, underground: 0, deep: 0, core: 0, gas: 0 };
  return {
    surface:     jobOutput(pop, 'surface_gatherer'),
    underground: jobOutput(pop, 'mine_shallow_worker'),
    deep:        jobOutput(pop, 'mine_deep_worker'),
    core:        jobOutput(pop, 'mine_core_worker'),
    gas:         jobOutput(pop, 'gas_collector_worker'),
  };
}

// 重算每个条目的增速（不推进 owned）：
// 该层有效人力（人数 × 强度产出倍率）按丰度加权均摊到该层资源上；无建筑/采尽则为 0。
function recalcRates(inst) {
  const counts = inst.buildings || {};
  const labor = inst.pop ? gatherLaborByLayerLocal(inst) : { surface: 0, underground: 0, deep: 0, core: 0, gas: 0 };
  const atm = atmosphereOf(inst);
  const layerTotal = {};
  for (const e of inst.inventory) layerTotal[e.layer] = (layerTotal[e.layer] || 0) + 1;

  const deep = deepGatherUnlocked();
  for (const e of inst.inventory) {
    const unlocked = layerUnlocked(e.layer, counts);
    if (!unlocked) { e.locked = true; e.rate = 0; continue; }
    // v0.0.7：地表层的非 T0 材料在 A1 深度采集研究出来之前不可采（见上方注释）
    if (e.layer === 'surface' && !deep && !SURFACE_T0.has(e.mat)) {
      e.locked = true; e.rate = 0; continue;
    }
    e.locked = false;
    // v0.0.6（R11）：气体层的「可采量」要把玩家排放进大气的那份算上，
    //   否则一条原生储量已采尽的气体条目会直接停产，连呼吸出来的都白排了。
    const stock = Math.max(0, Number(e.remaining) || 0)
      + (e.layer === 'gas' ? (Number(atm[e.mat]) || 0) : 0);
    if (stock <= 0) { e.rate = 0; continue; }        // 已采尽
    const share = (labor[e.layer] || 0) / (layerTotal[e.layer] || 1);
    // v0.0.91：乘上建筑总座数效率乘数 efficiencyBonus(inst)（需求 4，只在此处乘一次）
    // v0.1.2（需求 19）：接上「采集效率」永久升级（乘方效果，见 core/upgradefx.js）。
    //   此前这项买了不加成——付了研究点却看不到任何变化。
    const upgCollect = upgradeMul(currentAccount(), 'upg_collect');
    e.rate = e.abundance * share * BASE_COLLECT_RATE * efficiencyBonus(inst) * outputMulOf(inst) * upgCollect;
    // v0.1.3（需求 3）：大气收集器效率大幅上调 —— 气体层采集统一再 ×GAS_COLLECT_RATE_MUL。
    //   只作用气体层（大气收集器工），露天/矿井/地核不受影响。
    if (e.layer === 'gas') e.rate *= GAS_COLLECT_RATE_MUL;
  }
}

// 推进一段时长（秒）的产出：先重算增速，再累加 owned 并**从星球储藏里扣掉 remaining**
//
// v0.0.6（需求 R8）：缺电时按比例降速——但**只在耗电的采集层**生效。
//
// ⚠ 为什么露天采集不能吃电力降速（这是开局死锁的坑）：
//   开局只有 1 座建筑工厂（powerDraw 25）、发电量为 0，降速比 ratio = 0。
//   如果把 ratio 一视同仁地套到所有采集上，玩家就采不到石头→造不了东西→
//   造不出第一座人力发电厂→永远没有电。游戏从第一秒就死了。
//   露天采集本来是**纯手工劳动**（不需要任何建筑），不该吃电力这一刀。
//   地下 / 地核 / 气体则确实要靠耗电的矿井与大气收集器，照旧吃降速。
// v0.0.91：deep（深层）与 underground 一样靠耗电的深层矿井，照旧吃电力降速
const POWERED_GATHER_LAYERS = { underground: true, deep: true, core: true, gas: true };
function advanceProduction(inst, dt, powerRatio = 1) {
  recalcRates(inst);
  const globalRatio = clampRatio(powerRatio);
  const atm = atmosphereOf(inst);
  for (const e of inst.inventory) {
    if (!(e.rate > 0)) continue;
    const r = POWERED_GATHER_LAYERS[e.layer] ? globalRatio : 1;
    if (!(r > 0)) continue;                    // 该层耗电且完全没电 → 停产
    const atmAmt = e.layer === 'gas' ? (Number(atm[e.mat]) || 0) : 0;
    const avail = Math.max(0, Number(e.remaining) || 0) + atmAmt;
    if (avail <= 0) { e.rate = 0; continue; }
    const gain = Math.min(e.rate * r * dt, avail);
    if (gain <= 0) continue;
    e.owned += gain;
    if (atmAmt > 0) {
      // 气体：先扣「玩家排放进大气」的那份，再扣原生剩余储量（排放的气可被回收）
      const fromAtm = Math.min(atmAmt, gain);
      atm[e.mat] = atmAmt - fromAtm;
      e.remaining = Math.max(0, (Number(e.remaining) || 0) - (gain - fromAtm));
    } else {
      e.remaining = Math.max(0, (Number(e.remaining) || 0) - gain);
    }
    if (e.remaining <= 1e-9) e.remaining = 0;
    if (e.remaining + (Number(atm[e.mat]) || 0) <= 1e-9) e.rate = 0;
  }
}

// ============================================================================
// 建筑与施工队列（v0.0.5）
// ============================================================================

// 取某个星球实例的建筑计数表 { buildingId: 座数 }
export function getBuildingCounts(inst) {
  if (!inst) return {};
  if (!inst.buildings || typeof inst.buildings !== 'object') inst.buildings = {};
  return inst.buildings;
}

export function buildingCount(inst, buildingId) {
  return Number(getBuildingCounts(inst)[buildingId] || 0);
}

// ============================================================================
// 庇护（v0.0.51）
// ============================================================================
// 总庇护 = Σ(建筑座数 × 该建筑每栋的 shelter)，目前只有「房屋」提供（100/栋）。
// 庇护覆盖率 C = 总庇护 / 总人数，夹取到 [0,1]；1 表示人人有得住。
// 它会作为 computeHappiness 的 shelter 参数参与幸福度计算：
// 住房不足 → C 下降 → 幸福度下降 → 人口增长放缓甚至倒退。
export function totalShelter(inst) {
  const counts = getBuildingCounts(inst);
  let n = 0;
  for (const id in counts) {
    const b = BUILDING_BY_ID[id];
    if (b && b.shelter) n += (Number(counts[id]) || 0) * b.shelter;
  }
  return n;
}

export function shelterRatio(inst) {
  const total = inst && inst.pop ? Math.floor(inst.pop.total) : 0;
  if (total <= 0) return 1;              // 没人住就不存在住房压力
  return Math.min(1, totalShelter(inst) / total);
}

// 某建筑「第 n+1 座」的造价（n = 已有座数）
export function costOfNext(inst, buildingId) {
  const b = BUILDING_BY_ID[buildingId];
  if (!b) return {};
  return buildingCost(b, buildingCount(inst, buildingId));
}

// 材料是否够（v0.0.61：按**跨层总量**判定，同一材料可能分散在地表/地下/地核多条条目里）
export function hasMaterials(inst, cost) {
  for (const name in cost) {
    if (ownedOf(inst, name) + 1e-9 < cost[name]) return false;
  }
  return true;
}

// 扣材料；不够则整体不扣并返回 false
export function payMaterials(inst, cost) {
  if (!hasMaterials(inst, cost)) return false;
  for (const name in cost) spendOwned(inst, name, cost[name]);
  return true;
}

// 列出「差哪些材料」，UI 用
export function missingMaterials(inst, cost) {
  const miss = [];
  for (const name in cost) {
    const have = ownedOf(inst, name);
    if (have + 1e-9 < cost[name]) miss.push({ name, need: cost[name], have });
  }
  return miss;
}

// 该建筑是否已解锁（默认解锁 或 对应科技已研究）
export function isBuildingUnlocked(inst, buildingId, acc) {
  const b = BUILDING_BY_ID[buildingId];
  if (!b) return false;
  if (!b.unlockTech) return true;
  return !!acc && Array.isArray(acc.tech) && acc.tech.includes(b.unlockTech);
}

// 施工队列（惰性初始化）
export function buildQueueOf(inst) {
  if (!inst) return [];
  if (!Array.isArray(inst.buildQueue)) inst.buildQueue = [];
  return inst.buildQueue;
}

// 开始建造：三重校验（科技已解锁 → 施工条件满足 → 材料够），通过则扣材料并入队
export function startBuild(inst, buildingId, acc) {
  const b = BUILDING_BY_ID[buildingId];
  if (!b) return { ok: false, reason: '建筑不存在。' };
  if (!isBuildingUnlocked(inst, buildingId, acc)) {
    return { ok: false, reason: '该建筑尚未解锁：需要先研究「' + (b.unlockTech || '') + '」。' };
  }
  const queue = buildQueueOf(inst);
  if (queue.length >= BUILD_QUEUE_MAX) {
    return { ok: false, reason: '施工队列已满（上限 ' + BUILD_QUEUE_MAX + ' 项）。' };
  }
  const block = buildBlockReason(inst.pop, getBuildingCounts(inst));
  if (block) return { ok: false, reason: block };
  const cost = costOfNext(inst, buildingId);
  if (!hasMaterials(inst, cost)) {
    const miss = missingMaterials(inst, cost)
      .map((m) => m.name + ' 缺 ' + Math.ceil(m.need - m.have))
      .join('、');
    return { ok: false, reason: '材料不足：' + miss };
  }
  payMaterials(inst, cost);
  queue.push({ buildingId, nameCn: b.nameCn, work: b.work, progress: 0, paid: cost });
  return { ok: true, cost };
}

// 取消施工：全额退还材料
export function cancelBuild(inst, index) {
  const queue = buildQueueOf(inst);
  const item = queue[index];
  if (!item) return false;
  for (const name in (item.paid || {})) {
    const e = inst.inventory.find((x) => x.mat === name);
    if (e) e.owned += item.paid[name];
  }
  queue.splice(index, 1);
  return true;
}

// 推进施工队列 dt 秒：全部施工速度先投给队首工程（完成后自动接下一项）
function advanceConstruction(inst, dt) {
  const queue = buildQueueOf(inst);
  if (!queue.length) return;
  // ⚠ v0.0.6 的重要决定：**施工不吃电力降速**。
  //   施工的瓶颈本来就是设计者定的硬门槛——“必须有人在建筑工厂当建筑工”，
  //   再叠一层电力门槛会直接造成开局硬死锁：
  //     开局发电为 0 → 建筑工厂耗 25 电 → 降速比 0 → 施工停摆
  //     → 造不出第一座人力发电厂 → 永远没有电。
  //   施工是建筑工的体力劳动，建筑工厂那 25 电是照明与工具用电，不该决定工程能不能开工。
  // v0.1.2（需求 19）：第三个参数带上账号，才能吃到「建筑施工」永久升级的提速。
  const rate = buildRateOf(inst.pop, getBuildingCounts(inst), currentAccount());
  if (!(rate > 0)) return;                    // 没人施工 → 完全停摆（硬门槛）
  let budget = rate * dt;
  while (budget > 0 && queue.length) {
    const job = queue[0];
    const remain = Math.max(0, job.work - job.progress);
    const use = Math.min(budget, remain);
    job.progress += use;
    budget -= use;
    if (job.progress + 1e-9 >= job.work) {
      const counts = getBuildingCounts(inst);
      counts[job.buildingId] = (counts[job.buildingId] || 0) + 1;
      queue.shift();
    } else break;
  }
  // 施工会改变建筑数量（进而改变工位与采集），立刻重算一次增速
  recalcRates(inst);
}

// ============================================================================
// 人口与代谢
// ============================================================================

// 推进星球人口 dt 秒：扣三条营养（氧气/有机质/水）、回填三条代谢产物（二氧化碳/甲烷/氨气）
//
// v0.0.61（需求 3）：**氧气不再吃物品栏库存，直接扣星球的气体储量**。
//   设计者原话：「开局物品栏不给氧气，氧气直接扣星球储量里面的」。
//   于是氧气成了一种「环境资源」——人口呼吸直接从星球大气/储量里取，
//   玩家用大气收集器抽出来的氧气仍然进物品栏（那是他自己抽出来的存货）。
//   有机质与水仍旧是仓储品，走物品栏，并按**跨层总量**判定、从持有最多的条目开始扣。
function advancePopulation(inst, dt) {
  if (!inst.pop) return;

  const supply = {
    oxygen: gasAvailable(inst, '氧气'),   // 需求 3：来自星球气体储量，不是物品栏
    organic: ownedOf(inst, '有机质'),
    water: ownedOf(inst, '水'),
  };

  // v0.0.51：把「庇护覆盖率」接进幸福度。此前这里不传 shelter，
  // population.js 里庇护项 C 就一直取默认值 1（永远满庇护），
  // 于是房屋这类提供庇护的建筑完全不起作用。现在住房不足会真真切切拉低幸福度。
  // v0.0.91：除了封顶到 1 的 shelter（给幸福度用），还要把**未封顶**的庇护富余信息传进去——
  //   population.js 会用「庇护总量 / 人口」的比值给人口增速加成（庇护远大于人数时长得更快）。
  //   注意不能只传 `shelter`：它已经被 min(1, …) 夹住，富余信息就丢了，加成永远不触发。
  const r = tickPopulation(inst.pop, dt, supply, {
    shelter: shelterRatio(inst),
    shelterCounts: inst.buildings || {},
    // v0.0.94：母星的幸福度基本不参与波动（见 population.js 的 homePlanet 分支）
    homePlanet: !!inst.isHome,
  });
  // v0.0.92：管理模式对幸福度的持续压力/红利（剥削 -0.12、自由 +0.03 …）
  const hd = happinessDeltaOf(inst);
  if (hd && inst.pop) {
    inst.pop.happiness = Math.max(0, Math.min(1, inst.pop.happiness + hd * dt));
  }

  consumeGas(inst, '氧气', r.consumed.oxygen);        // 氧气：扣星球储量
  spendOwned(inst, '有机质', r.consumed.organic);     // 有机质 / 水：扣物品栏（跨层聚合）
  spendOwned(inst, '水', r.consumed.water);

  // v0.0.6（需求 R11）：呼吸产物**排进大气**，不再直接堆进物品栏。
  //   此前二氧化碳 / 甲烷 / 氨气直接加到 inventory 的 owned 上，等于「人呼出来的气
  //   凭空出现在你的仓库里」——既不符合直觉，也让大气收集器失去意义。
  //   现在记到 inst.atmosphere 上，大气收集器采集时优先从这里取，
  //   于是「人呼出的 CO₂ → 大气收集器回收 → 农田拿去产有机质」形成闭环。
  //   注意：吃不饱时按进食比例少排，这个口径不变。
  const out = { '二氧化碳': r.produced.co2, '甲烷': r.produced.methane, '氨气': r.produced.ammonia };
  const atm = atmosphereOf(inst);
  for (const name in out) {
    if (out[name] > 0) atm[name] = (Number(atm[name]) || 0) + out[name];
  }

  // 回写静态字段，供顶栏显示
  inst.population = {
    total: Math.floor(inst.pop.total),
    // v0.0.7：生产线占用的人力也要从可用人里扣掉（岗位 + 产线 共同占用）
    available: Math.max(0, Math.floor(getAvailable(inst.pop)) - lineWorkersTotal(inst)),
  };
  inst.happiness = inst.pop.happiness;
}

// 科研：科研人员产出研究点
// v0.0.6（需求 R5）：效率改为原来的 **1/20**。
//   旧值：每工位 1 点/秒（且完全不看工作强度），产得飞快，科技树几十分钟就点完。
//   新值：RESEARCH_UNIT × 强度产出倍率。标准强度 = 0.02 × 2.5 = **0.05 点/秒**，
//         正好是旧值的 1/20；拉高工作强度可以多产（与 R12 的强度体系一致）。
//   注：设计者明确要求**科技与升级的研究点花费不动**，所以解锁节奏会明显拉长。
//   缺电时同样按 powerRatio 降速。
export const RESEARCH_UNIT = 0.02;
function advanceResearch(inst, dt, powerRatio = 1) {
  const acc = currentAccount();
  if (!acc || !inst.pop) return;
  let labor = 0;
  for (const j of jobsOfBuilding('lab')) {
    const a = inst.pop.assignments[j.id];
    if (a && a.count > 0) labor += a.count * getIntensity(a.intensityId).outputMul;
  }
  if (labor <= 0) return;
  // v0.1.2（需求 19）：接上「研究效率」永久升级（乘方效果）。此前买了不加成。
  acc.researchPoints = (Number(acc.researchPoints) || 0)
    + labor * RESEARCH_UNIT * clampRatio(powerRatio) * dt * upgradeMul(acc, 'upg_research');
}

// ============================================================================
// 研究点消耗（v0.0.52：研究终于会真正扣点了）
// ============================================================================
// 此前 advanceResearch 只管产点，点「研究」不扣点，科研面板等于空转。
// 现在两套消耗都在这里结算，UI 只负责调用与展示结果。

// 研究一项科技。返回 { ok, reason }。
export function researchTech(techId) {
  const acc = currentAccount();
  if (!acc) return { ok: false, reason: '没有当前账号。' };
  const t = TECH_BY_ID[techId];
  if (!t) return { ok: false, reason: '科技不存在：' + techId };
  if (!Array.isArray(acc.tech)) acc.tech = [];
  if (acc.tech.includes(techId)) return { ok: false, reason: '已经研究过了。' };

  const done = new Set(acc.tech);
  if (!canResearch(techId, done)) {
    const miss = missingPrereqs(techId, done)
      .map((id) => (TECH_BY_ID[id] ? TECH_BY_ID[id].code + ' ' + TECH_BY_ID[id].nameCn : id));
    return { ok: false, reason: '前置科技未完成：' + miss.join('、') };
  }
  const points = Number(acc.researchPoints) || 0;
  if (points < t.cost) {
    return { ok: false, reason: `研究点不足：需要 ${t.cost}，现有 ${Math.floor(points)}。` };
  }
  acc.researchPoints = points - t.cost;
  acc.tech.push(techId);
  saveState();
  return { ok: true, tech: t, spent: t.cost };
}

// 购买一级永久升级。返回 { ok, reason, level }。
export function buyUpgrade(upgradeId) {
  const acc = currentAccount();
  if (!acc) return { ok: false, reason: '没有当前账号。' };
  const u = UPGRADES.find((x) => x.id === upgradeId);
  if (!u) return { ok: false, reason: '升级不存在：' + upgradeId };
  if (!acc.upgrades || typeof acc.upgrades !== 'object') acc.upgrades = {};

  const lv = Number(acc.upgrades[upgradeId]) || 0;
  if (lv >= u.maxLevel) return { ok: false, reason: '已满级。' };
  const cost = upgradeCost(u, lv);
  const points = Number(acc.researchPoints) || 0;
  if (points < cost) {
    return { ok: false, reason: `研究点不足：需要 ${cost}，现有 ${Math.floor(points)}。` };
  }
  acc.researchPoints = points - cost;
  acc.upgrades[upgradeId] = lv + 1;
  saveState();
  return { ok: true, level: lv + 1, spent: cost };
}

// 取/建星球实例（按 code，如 'syl' 或 'syl1'）；首次访问自动建实例并写入初始物资
export function getPlanetInstance(code) {
  if (!code) return null;
  let inst = STATE.planets.find((p) => p.code === code || p.planetId === code);
  if (!inst && typeof code === 'string' && /\d+$/.test(code)) {
    const base = code.replace(/\d+$/, '');
    inst = STATE.planets.find((p) => p.code === base || p.planetId === base);
  }
  if (!inst) {
    // v0.0.92：探索占领的星球（含随机生成的）存在账号的 capturedPlanets 里，优先从那里取数据
    const acc0 = currentAccount();
    const baseCode = typeof code === 'string' ? code.replace(/\d+$/, '') : code;
    const cap = acc0 && Array.isArray(acc0.capturedPlanets)
      ? acc0.capturedPlanets.find((c) => c && (c.code === code || c.code === baseCode)) : null;
    const sp0 = (cap && cap.planet) || PLANETS.find((p) => p.code === code || p.id === code || p.code === baseCode || p.id === baseCode);
    // v0.1.1（需求 2/5）：探索「发现」的星球（还没殖民）定义在 acc.discovered 里，也要能实例化
    let sp = sp0;
    if (!sp) {
      const accD = currentAccount();
      const disc = accD && Array.isArray(accD.discovered)
        ? accD.discovered.find((p) => p && (p.code === code || p.id === code || p.code === baseCode || p.id === baseCode))
        : null;
      if (disc) sp = disc;
    }
    if (!sp) return null;
    inst = {
      ...sp,
      planetId: sp.code + '1', // 占领编号，如 syl1，与账号 planetsOwned 对应
      code: sp.code,
      inventory: buildPlanetInventory(sp),
    };
    applyStartingItems(inst);
    inst.buildings = Object.assign({}, STARTING_BUILDINGS); // 开局自带 1 座建筑工厂
    inst.buildQueue = [];
    // v0.0.92：母星标记（母星独立倾向恒 0、不参与殖民管理）+ 新占领星球的默认管理模式
    const acc1 = currentAccount();
    inst.isHome = !!(acc1 && (acc1.homePlanetCode === sp.code || acc1.homePlanetCode === baseCode));
    if (!inst.management && !inst.isHome) inst.management = 'colonial';
    inst.independence = inst.isHome ? 0 : (Number(inst.independence) || 0);
    STATE.planets.push(inst);
  }
  // 人口对象常驻在星球实例上（旧存档没有时惰性补建）
  if (!inst.pop) {
    inst.pop = createPopulation((inst.population && Number(inst.population.total)) || 0);
    inst.happiness = inst.pop.happiness;
  }
  // v0.0.6：电力与配方生产的运行时字段（旧存档惰性补建）
  energyOf(inst);                                        // { total, max, stored }
  atmosphereOf(inst);                                    // 大气层（人口呼吸的排放地）
  if (!inst.facilities || typeof inst.facilities !== 'object') inst.facilities = {};
  if (!inst.recipes || typeof inst.recipes !== 'object') inst.recipes = {};
  // v0.0.7：生产线（inst.lines）惰性初始化 + 老存档的 inst.recipes 迁移
  ensureLines(inst);
  // v0.0.7：装备库存（制造车间产出的外壳 / 引擎 / 武器 / 船上设施），形状由 core/shipyard.js 维护
  if (!inst.equipment || typeof inst.equipment !== 'object') inst.equipment = {};
  // v0.0.61：净增长表（需求 2），tick 前先给空对象，UI 不需要写 null 容错
  if (!inst.netRates || typeof inst.netRates !== 'object') inst.netRates = {};
  // 先算一次电力，保证 UI 在第一次 tick 之前就能读到有效值（否则要写一堆 null 容错）
  if (!inst.powerInfo) inst.powerInfo = computePower(inst, currentAccount());
  // 旧存档补字段（v0.0.5 新增两个）
  if (!inst.buildings || typeof inst.buildings !== 'object') {
    inst.buildings = Object.assign({}, STARTING_BUILDINGS);
  }
  if (!Array.isArray(inst.buildQueue)) inst.buildQueue = [];
  // v0.0.91：把气体双来源（物品栏 + 大气层）的扣取/查询挂在实例上，
  //   供 production.js 投料时调用（熔炉家族 / bio_factory 气体先扣物品栏再扣大气）。
  //   用实例方法而非全局函数，便于临时脚本与老存档（无此法时退化为只扣物品栏）。
  inst._consumeGas = (matName, amt) => consumeGas(inst, matName, amt);
  inst._gasAvailable = (matName) => gasAvailable(inst, matName);
  // 旧存档的条目补 remaining（v0.0.5 新增）
  for (const e of inst.inventory) {
    if (!Number.isFinite(e.remaining)) {
      e.remaining = Math.max(0, (Number(e.reserve) || 0) - (Number(e.owned) || 0));
    }
  }
  recalcRates(inst);
  return inst;
}

// ============================================================================
// 净增长（v0.0.61，需求 2）
// ============================================================================
// 设计者要求「物品栏界面显示各资源的净增长，- 用红色，+ 用绿色」。
// 净增长 = 产出 − 消耗，由三部分合成：
//   ① 采集：各层条目的 rate 之和（露天采集不吃电力降速，地下/地核/气体吃）
//   ② 加工：选中配方的产出为正、投料为负（未选配方的建筑不算，它本来就不运转）
//   ③ 人口代谢：氧气 / 有机质 / 水 为负
//      （呼吸排出的二氧化碳/甲烷/氨气不算「增长」——它们进的是大气层，不占物品栏）
// 结果挂在 inst.netRates 上给 UI 读，UI 按正负上色。
function computeNetRates(inst, ratio) {
  const net = {};
  const add = (mat, v) => {
    if (!mat || !Number.isFinite(v) || v === 0) return;
    net[mat] = (net[mat] || 0) + v;
  };

  // ① 采集
  for (const e of (inst.inventory || [])) {
    if (!e || !(e.rate > 0)) continue;
    const r = POWERED_GATHER_LAYERS[e.layer] ? ratio : 1;
    add(e.mat, e.rate * r);
  }

  // ② 加工
  const rates = productionRates(inst, ratio, currentAccount());
  for (const bid in rates) {
    const info = rates[bid];
    if (!info || !info.active) continue;
    for (const k in (info.outputs || {})) add(k, info.outputs[k]);
    for (const k in (info.inputs || {})) add(k, -info.inputs[k]);
  }

  // ③ 人口代谢消耗
  // v0.1.2（需求 2）：**呼吸消耗的氧气不再计入净增长**。
  //   呼吸走 consumeGas（见本文件 723 行 → 262/272），扣的是星球大气层的
  //   remaining + atmosphere，压根不碰物品栏；把它算进 netRates 会在物品栏
  //   里凭空显示一笔负增长，玩家看到「氧气 -x/s」却怎么补都补不平。
  //   食物（有机质）与水是真的从物品栏扣的，保留。
  if (inst.pop) {
    const cons = consumptionPerSec(inst.pop);
    add('有机质', -cons.organic);
    add('水', -cons.water);
  }

  return net;
}

// 推进全部星球实例的产出、人口与施工（全局心跳每秒调用一次，dt 默认 1 秒）
//
// v0.0.6 新增电力与配方生产，tick 顺序**已冻结**（详见 docs/TODO_v0.0.6.md 第 1.5 节）：
//   ① tickPower        —— 太阳辐射回充星球能量池、清洁能源扣减、储能充放
//   ② computePower     —— 算出总发电/总耗电/降速比 ratio
//   ③ inst.powerInfo   —— 结算结果挂到实例上给 UI 读
//   ④ advanceProduction—— 采集（也吃电力降速）
//   ⑤ tickProduction   —— 加工生产（未选工作内容的建筑不运转）
//   ⑥ advancePopulation—— 人口与代谢（呼吸产物排进大气）
//   ⑦ advanceConstruction—— 施工
//   ⑧ advanceResearch  —— 科研
//
// ⚠ 字段命名铁律：`inst.power` 是星球**静态数据**（totalEnergy/hydro/wind/solar），
//   绝对不要覆写；结算结果一律放 `inst.powerInfo`，能量池一律放 `inst.energy`。
let _sinceSave = 0;
// v0.1.1：每账号每会话只跑一次的初始化标记（不落存档，重开页面会重跑——purge 与 discovered 均幂等）
const _v011Inited = new Set();

// v0.1.1 需求 20：托管殖民地贡品入库母星。
// payload = { 材料名: 数量, ... , __equipment?: { partId, material, count } }；
// 返回 false 时 planetgen.settleTribute 会把贡品暂存回殖民地（下轮重试），不会丢货。
function deliverTributeToHome(a, fromCode, payload) {
  const home = getPlanetInstance(a && a.homePlanetCode ? a.homePlanetCode : 'syl');
  if (!home || !payload || typeof payload !== 'object') return false;
  let any = false;
  for (const mat in payload) {
    if (mat === '__equipment') continue;
    const amt = Number(payload[mat]) || 0;
    if (!(amt > 0)) continue;
    const e = ensureEntry(home, mat, 'refined');
    if (e) { e.owned = (Number(e.owned) || 0) + amt; any = true; }
  }
  const eq = payload.__equipment;
  if (eq && eq.partId) {
    if (!home.equipment || typeof home.equipment !== 'object') home.equipment = {};
    const key = eq.partId + '@' + (eq.material == null ? '' : eq.material);
    const cur = home.equipment[key];
    if (cur && typeof cur === 'object') {
      cur.count = (Number(cur.count) || 0) + (Number(eq.count) || 1);
    } else {
      home.equipment[key] = {
        partId: eq.partId,
        material: eq.material == null ? null : eq.material,
        count: Number(eq.count) || 1,
      };
    }
    any = true;
  }
  return any;
}

// v0.1.1（需求 3）：dock 造船线推进。production.js#tickProduction 显式跳过 dock
// （造船由 shipyard.js#shipBuildTick 结算），这里作为 tick 管线统一入口：
//   labor 口径对齐 lineRateOf 的 dock 分支 = workers × 强度倍率（不乘建筑效率/殖民倍率）；
//   电力降速与其它生产线一致（powerInfo.ratio）；进度满 1 由 shipBuildTick 校验并下水。
function advanceShipLines(inst, dt, acc) {
  if (!inst || !Array.isArray(inst.lines)) return;
  const ratio = Number((inst.powerInfo && inst.powerInfo.ratio) ?? 1);
  if (!(ratio > 0)) return;
  for (const line of inst.lines) {
    if (!line || line.buildingId !== 'dock' || !line.blueprintId) continue;
    const workers = Number(line.workers) || 0;
    if (!(workers > 0)) continue;
    const intensityId = line.intensityId != null ? line.intensityId
      : (inst.pop ? inst.pop.intensityId : null);
    const gi = getIntensity(intensityId);
    const mul = (gi && Number(gi.outputMul)) || 0;
    if (!(mul > 0)) continue;
    try { shipBuildTick(inst, line.blueprintId, workers * mul, dt, ratio, acc); }
    catch (e) { /* 单线异常不断全局 */ }
  }
}

export function tick(dt = 1) {
  const acc = currentAccount();
  for (const inst of STATE.planets) {
    tickPower(inst, dt, acc);                  // ①
    const pw = computePower(inst, acc);        // ②
    inst.powerInfo = pw;                       // ③
    advanceProduction(inst, dt, pw.ratio);     // ④
    tickProduction(inst, dt, pw.ratio, acc);    // ⑤
    // ⑤b v0.1.1（需求 3）：dock 造船线推进（tickProduction 显式跳过 dock，由 shipBuildTick 结算）
    advanceShipLines(inst, dt, acc);
    // ⑤c v0.2.0：军队整编产线推进
    if (acc) {
      try { tickArmyBuildLines(acc, inst, dt, pw.ratio); } catch (e) {}
    }
    advancePopulation(inst, dt);               // ⑥
    advanceConstruction(inst, dt);             // ⑦（不吃电力降速，防开局死锁）
    advanceResearch(inst, dt, pw.ratio);       // ⑧
    // ⑧b v0.0.92：独立倾向与领土同化（由幸福度驱动，母星恒 0）
    tickIndependence(inst, dt);
    // ⑨ 净增长（需求 2）**必须放在最后算**：采集速率是在 ④ advanceProduction 里
    //    才重算的，若放在前面就会读到上一 tick 的旧速率——
    //    「刚派人去采集」的那一帧会算出「石头净增长 = 无」这种假结果。
    inst.netRates = computeNetRates(inst, pw.ratio);
    // v0.1.0：把「极限工作强化」升级等级写到人口对象上，population.js 的 getIntensity 会读它
    if (inst.pop) inst.pop.extremeWorkLevel = upgradeLevelOf(acc, 'extreme_work');
  }
  // v0.1.0：电脑账号（NPC 势力）随时间发展、挂单、买入 —— 他们会推高 Ast1 的价格
  if (acc) {
    ensureNpcs(acc);
    try {
      tickNpcs(acc, dt, {
        priceOf: (mat) => shopPriceOf(acc, mat),
        suggestPriceOf: (mat) => shopSuggestPriceOf(acc, mat, null),
        listOnMarket: (npc, mat, qty, price) => npcListOnMarket(acc, npc, mat, qty, price),
        takeFromMarket: (npc) => npcTakeFromMarket(acc, npc, null),
      });
    } catch (e) { /* 单个 NPC 的异常不拖垮心跳 */ }
    try { shopTick(acc, dt); } catch (e) { /* 忽略 */ }
    // v0.1.1 需求16：挂单实时刷新与卖空清除（tickListings 此前是死代码，需每 tick 调用）
    try { shopTickListings(acc, dt); } catch (e) { /* 忽略 */ }
    // v0.1.1 舰队持续任务（需求 3/19）：explore/transport/patrol 计时到期结算，defense 驻留。
    // discoverPlanet 必须注入：探索发现要走 acc.discovered 新契约（fleet 内置降级是旧版直接占领）。
    ensureFleets(acc);
    try { tickFleetMissions(acc, dt, { discoverPlanet }); } catch (e) { /* 忽略 */ }
    // v0.1.1 需求 20：电脑托管殖民地——AI 岗位重排（30s 节拍）+ 贡品上缴母星（60s 节拍）。
    // 生产由本 tick 管线对全部星球实例统一结算，这里绝不能再跑一次产出（会翻倍）。
    try {
      tickManagedColonies(acc, dt, {
        getInstanceOf: (code) => getPlanetInstance(code),
        deliverToHome: deliverTributeToHome,
      });
    } catch (e) { /* 忽略 */ }
    // v0.1.1 一次性初始化（每账号每会话一次，均幂等）：
    //   ① 清理老存档误占的商店星（需求 1）；② 母星落 discovered 表（需求 2）。
    if (!_v011Inited.has(acc.id)) {
      _v011Inited.add(acc.id);
      try { purgeShopColonies(acc); } catch (e) { /* 忽略 */ }
      try { ensureDiscoveredDefaults(acc, acc.homePlanetCode); } catch (e) { /* 忽略 */ }
      // 商店星残留实例移出本会话星球列表（planetgen 不 import state.js，由调用方负责）
      STATE.planets = STATE.planets.filter((p) => p && !p.isShop && p.code !== SHOP_PLANET_CODE);
    }
  }

  // 舰船：温度、能量与船员随时间变化（温度失控会死人）
  if (acc && Array.isArray(acc.ships)) {
    for (const ship of acc.ships) {
      try { tickShip(ship, dt); } catch (e) { /* 单艘船的异常不拖垮心跳 */ }
    }
  }
  // 内置自动存档，累计到间隔就落盘一次
  _sinceSave += dt;
  if (_sinceSave >= AUTOSAVE_INTERVAL) { _sinceSave = 0; saveState(); }
}

// ============================================================================
// 离线收益结算（v0.0.8，设计者原话：「离线时获得 1/10 应有产量」）
// ============================================================================
// 设计口径（务必与 main.js 的调用方对齐）：
//   ① 1/4 折算：离线同样长的一段时间，产出正常速度的 1/4（v0.0.91 前为 1/10）。实现上就是
//      把离线秒数 × 0.25 后推进游戏（等价于「这段离线时间产出 1/4」）。
//   ② 12 小时上限：离线时长最多按 43200 秒（12h）算，超出部分一律按 12h 封顶，
//      避免玩家挂机几天回来直接爆仓（返回里带 capped:true 供 UI 提示）。
//   ③ 分块推进：离线可能折算出几千秒，若一次性 tick(几千) 会让采集/生产/人口等
//      按单一超大 dt 计算，浮点与比例折算会失真。所以按每块最多 60 秒循环调用
//      tick(60)，累计推进「offline_sec × 0.1」秒，结果与实际逐秒跑一致。
//   ④ 落盘：结算完把 lastSeen 刷新为现在并 saveState()（lastSeen 由 saveState 维护）。
//      分块过程中临时把 _sinceSave 清零，抑制 tick 内部的自动存档，避免离线结算
//      时反复落盘（最后统一落一次即可），不破坏正常心跳的自动存档逻辑。
//
// 返回：
//   null                                  —— 没有 lastSeen 或离线 ≤ 60 秒，不结算
//   { seconds, applied, capped }          —— seconds=实际离线秒数(未封顶)，
//                                            applied=实际推进的秒数(=min(秒,12h)×0.25)，
//                                            capped=是否触发 12h 封顶
// 离线收益折算系数：离线 N 秒 → 按 N × 本系数 推进（即「应有产量的 1/系数倒数」）。
//   v0.0.91 起为 0.25（1/4）；**结算面板的文案由本常量生成**，改这里即可，不要去 UI 里写死分数。
export const OFFLINE_RATIO = 0.25;

/** 永久升级的当前等级（0 表示没升过） */
export function upgradeLevelOf(acc, upgradeId) {
  if (!acc || !acc.upgrades) return 0;
  return Number(acc.upgrades[upgradeId]) || 0;
}

// v0.1.1（需求 23）：**全部存档**离线都要推进，不只当前账号。
//   实现：遍历 STATE.accounts，逐个按该账号自己的 lastSeen 计算离线时长，
//   临时把 STATE.planets 切到该账号的星球实例（loadPlanets）、跑分块 tick、
//   再把星球实例写回该账号的 PLANETS_KEY，最后恢复当前账号上下文。
//   注意：tick() 内部通过 currentAccount() 读「当前账号」，所以切换用
//   STATE.currentAccountId 而不是给 tick 传参——行为与在线心跳完全一致。
// 返回：
//   null                                        —— 没有任何账号需要结算
//   { seconds, applied, capped, accounts, perAccount, totalSeconds, totalApplied }
//     v0.1.2（需求 3）：**每个存档的离线时长原本就是各自独立算的**（各按自己的
//     lastSeen 求差），错的是返回值把各档秒数**求和**再给 UI 显示，玩家看到
//     「离开 30 小时」其实是 3 个档各 10 小时加起来的。
//     现在：seconds / applied = **当前账号自己**的离线时长与推进量；
//     perAccount = 每档明细 [ { id, name, seconds, applied, capped } ]；
//     totalSeconds / totalApplied 仅作统计保留。
export function settleOffline() {
  if (!STATE.accounts.length) return null;
  const CAP = 43200;                                              // 12 小时上限（秒），v0.0.91 不变
  let totalSeconds = 0;
  let totalApplied = 0;
  let anyCapped = false;
  let settled = 0;
  const perAccount = [];
  let ownSeconds = 0;
  let ownApplied = 0;
  let ownCapped = false;
  // v0.1.3：结算后**内存**要换成推进过的新实例。此前只把结果写回磁盘、又用 prevPlanets
  //   恢复上下文，于是 UI 读到的仍是「离线前」的旧实例——玩家看到「离线根本没推进」，
  //   而下一个心跳 saveState() 还会把旧实例写回磁盘，把离线成果直接覆盖掉。
  let settledPlanetsOfCurrent = null;

  // 结算期间暂停心跳式的自动存档（分块过程抑制，最后统一落盘一次）
  _sinceSave = 0;
  const prevCurrentId = STATE.currentAccountId;
  const prevPlanets = STATE.planets;

  for (const acc of STATE.accounts) {
    if (!acc) continue;
    const stats = (acc.stats && typeof acc.stats === 'object') ? acc.stats : null;
    const lastSeen = stats ? Number(stats.lastSeen) : NaN;
    if (!Number.isFinite(lastSeen) || lastSeen <= 0) continue;    // 老存档无 lastSeen → 不结算
    const sec = Math.floor((Date.now() - lastSeen) / 1000);
    if (sec <= 60) continue;                                      // 离线不足 1 分钟不值得结算

    const capped = sec > CAP;
    const effective = Math.min(sec, CAP);
    // 离线折算系数 0.25（1/4）+ 永久升级「离线收益提升」每级 +0.05
    const offlineRatio = OFFLINE_RATIO + 0.05 * upgradeLevelOf(acc, 'offline_ratio');
    const applied = effective * offlineRatio;

    // 切换到该账号的星球上下文，分块推进（每块最多 60 秒）
    STATE.currentAccountId = acc.id;
    let planets = loadPlanets(acc.id);
    // v0.1.3：当前账号若读盘为空（首次进入、或历史存档没写过 planets 槽），
    //   直接用内存里那份最新实例，绝不能拿空数组去 tick 再写回 —— 那会把进度清空。
    if (acc.id === prevCurrentId && (!planets || !planets.length) && prevPlanets.length) {
      planets = prevPlanets;
    }
    STATE.planets = planets;
    if (!STATE.planets.length) continue;                       // 没有实例可推进，跳过（不写回）
    // v0.1.3（离线产线恒 0 的根因）：loadPlanets 反序列化出来的是**裸实例**，
    //   没走过 getPlanetInstance 的运行时初始化（补建 pop / energy / atmosphere /
    //   ensureLines / 注入 _gasAvailable 等）。直接在裸实例上 tick 的后果是
    //   inst.pop 仍为 null → intensityMulOf 取到 0 → 生产线一点都不产出，
    //   表现为「离线回来采集涨了、施工动了，产线却纹丝不动」。
    //   这里逐个过一遍 getPlanetInstance 把运行时字段补齐（它命中已有实例只补字段）。
    for (const p of STATE.planets) {
      if (p && p.code) { try { getPlanetInstance(p.code); } catch (e) { /* 单个实例补建失败不拖垮结算 */ } }
    }
    let remaining = applied;
    while (remaining > 1e-9) {
      const chunk = Math.min(60, remaining);
      tick(chunk);
      _sinceSave = 0;                                             // 抑制分块过程自动存档
      remaining -= chunk;
    }
    // 该账号的星球实例写回它自己的存储槽
    if (acc.id) {
      try { adapter.set(PLANETS_KEY + acc.id, JSON.stringify(STATE.planets)); } catch (e) { /* 单账号写盘失败不拖垮其它账号 */ }
    }
    // v0.1.3：当前账号的实例就是推进过的这份 —— 结束时用它恢复上下文，别再用旧数组。
    if (acc.id === prevCurrentId) settledPlanetsOfCurrent = STATE.planets;
    if (!acc.stats || typeof acc.stats !== 'object') acc.stats = {};
    acc.stats.lastSeen = Date.now();

    totalSeconds += sec;
    totalApplied += applied;
    anyCapped = anyCapped || capped;
    settled++;
    perAccount.push({ id: acc.id, name: acc.name || acc.id, seconds: sec, applied, capped });
    if (acc.id === prevCurrentId) { ownSeconds = sec; ownApplied = applied; ownCapped = capped; }
  }

  // 恢复当前账号的上下文（心跳随后照常跑）
  STATE.currentAccountId = prevCurrentId;
  // v0.1.3：用**结算后**的实例替换旧的 —— 否则 UI 显示旧值，且下次存档会把成果覆盖回去。
  STATE.planets = settledPlanetsOfCurrent || prevPlanets;
  saveState();

  if (!settled) return null;
  // 本档自己没被结算（比如刚玩过、离线不足 1 分钟）时，退回显示它自己的 0 值，
  // 绝不拿别的档的时长顶替——那正是「离开时间算错」的根源。
  return {
    seconds: ownSeconds, applied: ownApplied, capped: ownCapped,
    accounts: settled, perAccount, totalSeconds, totalApplied,
  };
}

// 新游戏：建账号并建立母星实例（含初始物资）。保持既有导出 API 不变。
// 开局模式（v0.1.0，设计者 [重要] 需求）：
//   'fresh' 「初登星球」—— 标准白手起家（原行为）
//   'deep'  「漫溯深空」—— 已推进到船坞科技的中期存档：建筑成规模、物资充足、
//            随机赠送 10 艘飞船（3 张默认蓝图混编），其他方面都已到达中期水平
export const START_MODES = [
  { id: 'fresh', nameCn: '初登星球', desc: '标准开局：一座建筑工厂 + 少量物资，从零开始。' },
  { id: 'deep',  nameCn: '漫溯深空', desc: '中期开局：已解锁到船坞科技，建筑成规模、物资充足，并随机获得 10 艘飞船。' },
];

// 「漫溯深空」开局：把科技、建筑、物资、飞船一次性铺到位
function applyDeepStart(acc, inst) {
  // 1) 科技：一路推到船坞（E3）及其所有前置
  //    v0.1.1（需求 11）：补齐 t_b3/t_c3/t_d1/t_d2 —— 开局授予了电解池/地心矿井/
  //    化学实验室/精细加工厂四种建筑，此前对应科技没给，建筑面板里这四类被
  //    isBuildingUnlocked 拦掉、无法重建（已建成的座数仍生效）。
  acc.tech = ['t_a1', 't_a2', 't_b8', 't_b1', 't_c1', 't_e2',
    't_b2', 't_c2', 't_e4', 't_a4', 't_b5', 't_b7', 't_e3',
    't_b3', 't_c3', 't_d1', 't_d2',
    't_m1', 't_m2', 't_m3', 't_m4', 't_m5'];
  acc.researchPoints = 60000;

  // 2) 建筑：中期规模
  inst.buildings = {
    workshop: 2, house: 14, manual_power: 3, farm: 3, gas_collector: 2,
    furnace: 3, blast_furnace: 2, electrolyzer: 1, thermal_plant: 1, clean_plant: 1,
    mine_shallow: 2, mine_deep: 2, mine_core: 1, storage_plant: 2,
    lab: 2, fabricator: 2, chem_lab: 1, refinery: 1, dock: 1, repair_bay: 1,
  };

  // 3) 物资：中期储备
  const bundle = {
    石头: 2e5, 泥土: 1e5, 有机质: 8e4, 水: 8e4, 粘土: 5e4, 石墨: 3e4, 石英: 3e4,
    铁: 4e4, 铜: 2e4, 锌: 1e4, 铝: 1e4, 钢: 1.2e4, 玻璃: 8e3, 陶瓷: 8e3,
    钛: 3e3, 银: 800, 金: 500, 铝合金: 1e3, 碳化钨: 400, 钛合金: 600, 橡胶: 800, 塑料: 800,
  };
  for (const name in bundle) {
    const e = inst.inventory.find((x) => x && x.mat === name);
    const qty = bundle[name];
    if (e) e.owned = Math.min(Number(e.reserve) || qty, (Number(e.owned) || 0) + qty);
    else {
      const ne = ensureEntry(inst, name, 'refined');
      ne.owned = qty;
    }
  }

  // 4) 电力设施库存（可以直接安装）+ 一点 Ascoin
  inst.facilityStock = Object.assign({}, inst.facilityStock, {
    battery_m: 4, solar_m: 4, wind_m: 3, thermal_m: 2,
  });
  acc.ascoin = 1e6;

  // 5) 随机赠送 10 艘飞船（3 张默认蓝图混编）
  const bps = defaultBlueprints();
  acc.blueprints = bps.slice();
  acc.blueprint = bps[0];
  acc.ships = acc.ships || [];
  const plan = [3, 3, 4];   // 护卫舰 / 运输船 / 巡洋舰 的艘数，合计 10
  for (let i = 0; i < bps.length && i < plan.length; i++) {
    for (let k = 0; k < plan[i]; k++) {
      // createShip → evaluateBlueprint 需要「已研究科技」才会放行（船坞 E3）
      const r = createShip(bps[i], {
        ships: acc.ships, account: acc, planetCode: inst.code, researched: acc.tech,
      });
      if (r && r.ok && r.ship) acc.ships.push(r.ship);
    }
  }

  // 5b) v0.1.3（需求 5）：开局给每艘船补燃料 —— 取 max(现有, 2000 mol)。
  //     一箱燃料 ≈ 1000 mol（ui/shipyard.js 加注框默认值），2000 = 2 箱，
  //     够单船一次满距离探索（360 mol）+ 一次起飞还有富余。
  for (const s of (acc.ships || [])) {
    if (s && s.state) s.state.fuelMol = Math.max(Number(s.state.fuelMol) || 0, 2000);
  }

  // 5c) v0.2.0：漫溯深空开局赠送初始驻防防卫部队与制造车间军事部件储备
  acc.armies = [
    {
      id: 'army_deep_1',
      bpId: 'ab_ranger',
      nameCn: '游骑兵第 1 营',
      planetCode: inst.code || acc.homePlanetCode || 'syl',
      stats: armyStatsOf('ab_ranger'),
      stationed: true,
      createdAt: Date.now(),
    },
    {
      id: 'army_deep_2',
      bpId: 'ab_ironwall',
      nameCn: '铁壁重装第 1 营',
      planetCode: inst.code || acc.homePlanetCode || 'syl',
      stats: armyStatsOf('ab_ironwall'),
      stationed: true,
      createdAt: Date.now(),
    },
  ];
  inst.equipment = inst.equipment || {};
  const milParts = [
    { id: 'ap_assault_rifle', mat: '钢', count: 120 },
    { id: 'ap_light_armor', mat: '钢', count: 120 },
    { id: 'ap_heavy_armor', mat: '钢', count: 60 },
    { id: 'ap_heavy_mg', mat: '钢', count: 40 },
    { id: 'ap_chassis_wheel', mat: '铝', count: 20 },
    { id: 'ap_chassis_track', mat: '钢', count: 20 },
  ];
  for (const p of milParts) {
    inst.equipment[`${p.id}@${p.mat}`] = { partId: p.id, material: p.mat, count: p.count };
  }

  // 6a) v0.1.5（需求 1）：漫溯深空开局人口设为 500（中期规模，足以喂满下方预分配岗位与生产线）。
  //     浅水开局（'fresh'）保持母星静态数据里的 100 不变；仅中期开局在此覆盖
  //     inst.pop 已由 getPlanetInstance 按母星数据建好（total 100），这里直接放大到 500。
  if (inst.pop) inst.pop.total = 500;

  // 6b) v0.1.4（需求 3）：开局预置若干条**生产线** —— 此前漫溯深空只给建筑与岗位，
  //     加工建筑全是空转（没有线就没有产出），玩家进来还得手动一条条建。
  //     这里按「中期该在运转什么」挂 6 条线；每条都受建筑工位夹取，挂不上就跳过，
  //     绝不因为某条线建不起来而让整个开局失败（外面还有 try 兜底）。
  {
    const LINES = [
      { buildingId: 'blast_furnace', recipeId: 'r_bf_iron',      workers: 12 },  // 铁
      { buildingId: 'blast_furnace', recipeId: 'r_bf_aluminum',  workers: 8 },   // 铝
      { buildingId: 'furnace',       recipeId: 'r_furnace_ceramic', workers: 10 }, // 陶瓷
      { buildingId: 'electrolyzer',  recipeId: 'r_el_water',     workers: 6 },   // 氢气 + 氧气
      { buildingId: 'chem_lab',      recipeId: 'r_chem_steel',   workers: 7 },   // 钢
      { buildingId: 'chem_lab',      recipeId: 'r_chem_plastic', workers: 5 },   // 塑料
    ];
    ensureLines(inst);
    for (const L of LINES) {
      try {
        if ((Number(inst.buildings[L.buildingId]) || 0) <= 0) continue;   // 该建筑没建成 → 跳过
        const info = lineSlotInfo(inst, L.buildingId);
        const w = Math.min(L.workers, Math.max(0, info.free));
        if (!(w > 0)) continue;                                          // 没空闲工位 → 跳过
        const r = addProductionLine(inst, L.buildingId, L.recipeId, { workers: w });
        if (!r || !r.ok) continue;
      } catch (e) { /* 单条线失败不影响开局 */ }
    }
  }

  // 7) v0.1.1（需求 11）：预分配岗位——开局「建筑与科技、工位对应」，进来就在运转。
  //    优先级：发电 > 建筑工（施工硬门槛）> 采集 > 农田 > 科研 > 船坞；留约两成人力自由。
  //    每项都受「建筑工位」与「可用人力」双重夹取，建筑/职业增删后这里不需要同步。
  if (inst.pop) {
    const PLAN = {
      manual_power_worker: 24,   // 人力发电厂 ×3
      builder: 30,               // 建筑工厂 ×2（没有建筑工施工恒为 0）
      surface_gatherer: 60,      // 露天采集（无工位限制）
      gas_collector_worker: 12,  // 大气收集器 ×2
      mine_shallow_worker: 28,   // 浅层矿井 ×2
      mine_deep_worker: 28,      // 深层矿井 ×2
      mine_core_worker: 24,      // 地心矿井 ×1
      farm_worker: 24,           // 农田 ×3（岗位驱动，不走生产线）
      researcher: 16,            // 科研所 ×2
      dock_worker: 8,            // 船坞 ×1（没有船坞工造不出船）
      repair_bay_worker: 6,      // 修理厂 ×1
    };
    for (const jobId in PLAN) {
      const job = JOBS.find((j) => j.id === jobId);
      if (!job) continue;                                        // 职业被删（如 v0.1.1 的两家电厂工）则跳过
      let count = PLAN[jobId];
      if (job.buildingId) {
        count = Math.min(count, freeSlots(inst.pop, job.buildingId, inst.buildings));
      }
      count = Math.min(count, getAvailable(inst.pop));
      if (count > 0) {
        inst.pop.assignments[jobId] = { count, intensityId: 'standard' };
      }
    }
  }
  acc.capturedPlanets = acc.capturedPlanets || [];
  const home = acc.capturedPlanets.find((c) => c && c.code === acc.homePlanetCode);
  if (!home) {
    acc.capturedPlanets.push({
      code: acc.homePlanetCode, nameCn: inst.nameCn || '希尔瓦',
      nameEn: inst.nameEn || 'Sylva', type: inst.type || '类地行星', planet: null,
    });
  }
  // v0.1.1（需求 2/5）：漫溯深空开局母星也要落 discovered 表（幂等）
  try { ensureDiscoveredDefaults(acc, acc.homePlanetCode); } catch (e) { /* 忽略 */ }
  saveState();
}

export function newGame(name, mode) {
  const acc = createAccount(name);
  const inst = getPlanetInstance(acc.homePlanetCode); // 建立母星实例并写入初始物资
  if (mode === 'deep') {
    try { applyDeepStart(acc, inst); }
    catch (e) { /* 中期开局失败也要保证基础存档可用 */ }
  }
  return acc;
}
