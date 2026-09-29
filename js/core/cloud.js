// 星际云服务与在线星系核心逻辑（Astrix v0.2.0）
// 提供指挥官云身份、星系注册表、异步贸易与远征进攻、战报收件箱系统。
// 遵循零构建原生 ES 模块规范，具备离线/断网平滑降级（自动混入 NPC 星系）。

import { currentAccount, ownedOf, spendOwned, getPlanetInstance } from './state.js?v=21.3';
import { listFleets, ensureFleets } from './fleet.js?v=21.3';
import { fmtNum } from './format.js?v=21.3';
import { ensureEntry } from './production.js?v=21.3';
import { stationedArmyPower } from './army.js?v=21.3';

export function addMaterial(inst, matName, amount) {
  const e = ensureEntry(inst, matName);
  if (e) {
    e.owned = (Number(e.owned) || 0) + Number(amount || 0);
  }
}

const CLOUD_PROFILE_KEY = 'astrix.cloud.profile';
const INBOX_KEY_PREFIX = 'astrix.cloud.inbox.';
const REGISTRY_LOCAL_KEY = 'astrix.cloud.registry.cache';

// 免战保护盾时长：12 小时（毫秒）
export const SHIELD_DURATION_MS = 12 * 3600 * 1000;

// ============================================================================
// 一、指挥官云端身份（Q1-1C: 一键生成 + 可选绑定邮箱）
// ============================================================================

function randHex(len = 6) {
  let s = '';
  while (s.length < len) {
    s += Math.floor(Math.random() * 16).toString(16).toUpperCase();
  }
  return s.slice(0, len);
}

/**
 * 确保或生成当前账号的云端指挥官身份
 */
export function ensureCloudProfile(acc) {
  if (!acc) return null;
  const storeKey = CLOUD_PROFILE_KEY + '.' + acc.id;
  let profile = null;
  try {
    const raw = localStorage.getItem(storeKey);
    if (raw) profile = JSON.parse(raw);
  } catch (e) {
    // 忽略异常
  }

  if (!profile || !profile.commanderId) {
    profile = {
      commanderId: 'CMD-' + randHex(6),
      callsign: (acc.name || '开拓者') + '·' + randHex(3),
      email: null,
      token: 'tk_' + Date.now().toString(36) + randHex(8),
      registeredAt: Date.now(),
      shieldUntil: Date.now() + 2 * 3600 * 1000, // 新晋指挥官赠送 2 小时初始保护盾
    };
    saveCloudProfile(acc, profile);
  }

  acc.cloudProfile = profile;
  return profile;
}

/**
 * 持久化云身份
 */
export function saveCloudProfile(acc, profile) {
  if (!acc || !profile) return;
  acc.cloudProfile = profile;
  try {
    localStorage.setItem(CLOUD_PROFILE_KEY + '.' + acc.id, JSON.stringify(profile));
  } catch (e) {}
}

/**
 * 绑定邮箱
 */
export function bindEmail(acc, email) {
  const profile = ensureCloudProfile(acc);
  if (!profile) return { ok: false, reason: '未找到云档案' };
  const em = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    return { ok: false, reason: '请输入有效的邮箱地址' };
  }
  profile.email = em;
  saveCloudProfile(acc, profile);
  return { ok: true, profile };
}

/**
 * 获取保护盾状态
 */
export function getShieldStatus(acc) {
  const profile = ensureCloudProfile(acc);
  if (!profile) return { active: false, remainingSec: 0, text: '未激活' };
  const now = Date.now();
  const until = Number(profile.shieldUntil) || 0;
  if (until > now) {
    const remainingSec = Math.ceil((until - now) / 1000);
    const h = Math.floor(remainingSec / 3600);
    const m = Math.floor((remainingSec % 3600) / 60);
    const s = remainingSec % 60;
    const timeText = h > 0 ? `${h}小时${m}分` : `${m}分${s}秒`;
    return { active: true, remainingSec, text: `保护中 (${timeText})`, shieldUntil: until };
  }
  return { active: false, remainingSec: 0, text: '无护盾（易受进攻）', shieldUntil: 0 };
}

// ============================================================================
// 二、NPC 势力星球预置库（Q3-A: 自动混入 NPC 星球，平滑降级杜绝断网白屏）
// ============================================================================

export const NPC_STAR_SYSTEMS = [
  {
    id: 'npc_vega4',
    isNpc: true,
    commanderId: 'NPC-VG4',
    callsign: '维加斯督军',
    faction: '泛星际商会',
    factionColor: '#7cd7ff',
    planetCode: 'vega4',
    planetNameCn: '织女四·重工枢纽',
    typeDesc: '重工精炼星',
    population: 4800,
    defensePower: 2600,
    shieldUntil: 0,
    distanceLy: 2.4, // 光年 / 相对距离
    goods: [
      { mat: '钢', nameCn: '精炼钢', priceAscoin: 85, stock: 2500 },
      { mat: '钛', nameCn: '高纯钛', priceAscoin: 320, stock: 1200 },
      { mat: '铝', nameCn: '铝板', priceAscoin: 65, stock: 3000 },
    ],
    intel: '以轨道熔炉与深坑精炼厂闻名，防空火力密集，驻扎商会巡防舰队。',
  },
  {
    id: 'npc_sirius_b',
    isNpc: true,
    commanderId: 'NPC-SRB',
    callsign: '铁胡子船长',
    faction: '深空拾荒团',
    factionColor: '#ffc46b',
    planetCode: 'sirius_b',
    planetNameCn: '天狼B·废弃矿业站',
    typeDesc: '矿物小行星',
    population: 1200,
    defensePower: 580,
    shieldUntil: 0,
    distanceLy: 1.2,
    goods: [
      { mat: '金红石', nameCn: '天然金红石', priceAscoin: 40, stock: 4500 },
      { mat: '孔雀石', nameCn: '铜矿孔雀石', priceAscoin: 28, stock: 6000 },
      { mat: '铁', nameCn: '纯铁', priceAscoin: 35, stock: 8000 },
    ],
    intel: '矿产储备丰厚但防备空虚，只有零散改装炮艇警戒，是理想的贸易或袭扰目标。',
  },
  {
    id: 'npc_centauri',
    isNpc: true,
    commanderId: 'NPC-CEN',
    callsign: '阿加莎女执政官',
    faction: '极光帝国',
    factionColor: '#b48eff',
    planetCode: 'centauri_lab',
    planetNameCn: '半人马α·科研前哨',
    typeDesc: '科研高科星',
    population: 3100,
    defensePower: 1850,
    shieldUntil: 0,
    distanceLy: 3.6,
    goods: [
      { mat: '塑料', nameCn: '高分子塑料', priceAscoin: 110, stock: 1800 },
      { mat: '硅', nameCn: '高纯硅晶', priceAscoin: 145, stock: 2200 },
      { mat: '玻璃', nameCn: '特种钢化玻璃', priceAscoin: 55, stock: 3500 },
    ],
    intel: '帝国前沿科研据点，拥有先进能量护盾与实验型合成车间。',
  },
  {
    id: 'npc_rigel',
    isNpc: true,
    commanderId: 'NPC-RGL',
    callsign: '老港督·雷诺',
    faction: '开拓者联合',
    factionColor: '#9FE1CB',
    planetCode: 'rigel_port',
    planetNameCn: '参宿七·能源补给港',
    typeDesc: '中立自贸港',
    population: 6200,
    defensePower: 3400,
    shieldUntil: 0,
    distanceLy: 4.8,
    goods: [
      { mat: '甲烷', nameCn: '液化甲烷', priceAscoin: 30, stock: 12000 },
      { mat: '有机质', nameCn: '浓缩有机物', priceAscoin: 15, stock: 15000 },
      { mat: '水', nameCn: '淡化纯净水', priceAscoin: 10, stock: 20000 },
    ],
    intel: '公立星港，免战自贸区，燃油与补给物资极其充裕。',
  },
  {
    id: 'npc_kepler',
    isNpc: true,
    commanderId: 'NPC-KPL',
    callsign: '自然之子·林',
    faction: '绿洲生态同盟',
    factionColor: '#68d391',
    planetCode: 'kepler_eden',
    planetNameCn: '开普勒-452·新伊甸',
    typeDesc: '温带温室星',
    population: 2400,
    defensePower: 920,
    shieldUntil: 0,
    distanceLy: 5.5,
    goods: [
      { mat: '有机质', nameCn: '生机培养基', priceAscoin: 18, stock: 25000 },
      { mat: '粘土', nameCn: '富硒粘土', priceAscoin: 20, stock: 9000 },
      { mat: '石头', nameCn: '地壳基石', priceAscoin: 5, stock: 50000 },
    ],
    intel: '充满植被与地表水源的宜居星球，防御轻微，农业产出极其庞大。',
  },
  {
    id: 'npc_orion',
    isNpc: true,
    commanderId: 'NPC-ORN',
    callsign: '战帅·克罗诺斯',
    faction: '铁血雇佣军',
    factionColor: '#f09595',
    planetCode: 'orion_fort',
    planetNameCn: '猎户悬臂·要塞防线',
    typeDesc: '重装要塞星',
    population: 5000,
    defensePower: 4500,
    shieldUntil: 0,
    distanceLy: 6.2,
    goods: [
      { mat: '钨', nameCn: '重合金钨', priceAscoin: 420, stock: 800 },
      { mat: '钢', nameCn: '穿甲装甲钢', priceAscoin: 95, stock: 3000 },
      { mat: '赤铁矿', nameCn: '精选铁矿石', priceAscoin: 22, stock: 10000 },
    ],
    intel: '坚不可摧的军事堡垒，装备轨道加农炮，贸然进攻极易折戟沉沙。',
  },
  {
    id: 'npc_andromeda',
    isNpc: true,
    commanderId: 'NPC-AND',
    callsign: '无影客',
    faction: '黑市掮客',
    factionColor: '#e2e8f0',
    planetCode: 'andromeda_mkt',
    planetNameCn: '仙女座边缘·黑市集市',
    typeDesc: '深空漂流集市',
    population: 1800,
    defensePower: 1400,
    shieldUntil: 0,
    distanceLy: 7.8,
    goods: [
      { mat: '粗金', nameCn: '原生态金矿', priceAscoin: 600, stock: 500 },
      { mat: '镒', nameCn: '虚构稀有镒(Ed)', priceAscoin: 99999, stock: 12 },
      { mat: '沥青铀矿', nameCn: '高能裂变原矿', priceAscoin: 1200, stock: 200 },
    ],
    intel: '游走于星系边缘的黑市，偶尔出现极度稀缺的高科技与稀土元素。',
  },
];

// ============================================================================
// 三、快照打包与星系注册表（Galaxy Registry）
// ============================================================================

/**
 * 评估本方母星的综合防御力
 */
export function evaluateDefensePower(acc, inst) {
  if (!inst) return 300;
  const pop = (inst.population && inst.population.total) || 100;
  const b = inst.buildings || {};
  // 建筑防御贡献：船坞、建筑工厂、储电站、房屋等
  let bDef = (b.dock || 0) * 400 + (b.building_factory || 0) * 150 + (b.power_station || 0) * 100 + (b.house || 0) * 10;
  // 驻泊舰船贡献
  const ships = Array.isArray(acc.ships) ? acc.ships : [];
  let shipDef = 0;
  for (const s of ships) {
    if (s.planetCode === (acc.homePlanetCode || 'syl1')) {
      shipDef += 250;
    }
  }
  const baseDef = Math.max(200, Math.round(pop * 0.5 + bDef + shipDef));
  const armyDef = stationedArmyPower(acc, acc.homePlanetCode || 'syl');
  return baseDef + armyDef;
}

/**
 * 生成本地玩家的对外公开快照
 */
export function buildLocalSnapshot(acc) {
  const profile = ensureCloudProfile(acc);
  const homeCode = acc.homePlanetCode || 'syl';
  const inst = getPlanetInstance(homeCode) || getPlanetInstance(homeCode.replace(/\d+$/, ''));
  const def = evaluateDefensePower(acc, inst);

  // 挑选 3 种本地库存较多的精炼或原矿物资作为在售特产
  const goods = [];
  const candidateMats = ['铁', '钢', '铝', '铜', '硅', '玻璃', '塑料', '水', '有机质'];
  for (const mat of candidateMats) {
    const qty = ownedOf(inst, mat);
    if (qty > 100) {
      goods.push({
        mat,
        nameCn: mat,
        priceAscoin: Math.max(10, Math.round(50 + Math.random() * 30)),
        stock: Math.min(5000, Math.floor(qty * 0.5)),
      });
      if (goods.length >= 3) break;
    }
  }
  if (goods.length === 0) {
    goods.push({ mat: '铁', nameCn: '铁', priceAscoin: 30, stock: 500 });
  }

  return {
    id: 'player_' + profile.commanderId,
    isNpc: false,
    commanderId: profile.commanderId,
    callsign: profile.callsign,
    email: profile.email,
    faction: '自由开拓同盟',
    factionColor: '#7cd7ff',
    planetCode: homeCode,
    planetNameCn: (inst && inst.nameCn) || '母星·希尔瓦',
    typeDesc: '玩家主权殖民星',
    population: (inst && inst.population && inst.population.total) || 100,
    defensePower: def,
    shieldUntil: profile.shieldUntil || 0,
    distanceLy: 0,
    goods,
    intel: '由指挥官领衔建立的初级工业殖民地，正在稳步开拓中。',
    updatedAt: Date.now(),
  };
}

/**
 * 获取星系所有星球列表（含玩家快照与 NPC 星球，支持关键词过滤）
 */
export function fetchGalaxyRegistry(acc, filterQuery = '') {
  const mySnapshot = buildLocalSnapshot(acc);
  const list = [mySnapshot, ...NPC_STAR_SYSTEMS];

  // 尝试从本地缓存读取其他玩家的快照
  try {
    const raw = localStorage.getItem(REGISTRY_LOCAL_KEY);
    if (raw) {
      const others = JSON.parse(raw);
      if (Array.isArray(others)) {
        for (const o of others) {
          if (o.commanderId !== mySnapshot.commanderId && !list.some((x) => x.commanderId === o.commanderId)) {
            list.push(o);
          }
        }
      }
    }
  } catch (e) {}

  const q = String(filterQuery || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((item) => (
    item.planetNameCn.toLowerCase().includes(q) ||
    item.commanderId.toLowerCase().includes(q) ||
    item.callsign.toLowerCase().includes(q) ||
    item.faction.toLowerCase().includes(q)
  ));
}

// ============================================================================
// 四、星际信箱（Inbox）系统（战报、贸易单、星际公报）
// ============================================================================

export function getInbox(acc) {
  if (!acc) return [];
  const key = INBOX_KEY_PREFIX + acc.id;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

export function saveInbox(acc, list) {
  if (!acc) return;
  const key = INBOX_KEY_PREFIX + acc.id;
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {}
}

export function addInboxMessage(acc, msg) {
  const list = getInbox(acc);
  const entry = {
    id: 'msg_' + Date.now().toString(36) + '_' + randHex(4),
    at: Date.now(),
    read: false,
    ...msg,
  };
  list.unshift(entry);
  if (list.length > 50) list.pop(); // 最多保留 50 条
  saveInbox(acc, list);
  return entry;
}

export function markMessageRead(acc, msgId) {
  const list = getInbox(acc);
  let changed = false;
  for (const m of list) {
    if (m.id === msgId && !m.read) {
      m.read = true;
      changed = true;
    }
  }
  if (changed) saveInbox(acc, list);
}

export function markAllMessagesRead(acc) {
  const list = getInbox(acc);
  list.forEach((m) => { m.read = true; });
  saveInbox(acc, list);
}

export function unreadCount(acc) {
  return getInbox(acc).filter((m) => !m.read).length;
}

// ============================================================================
// 五、异步星际远征与攻防裁决（Q2-A: 轻度掠夺 5~10% + 12 小时保护盾）
// ============================================================================

/**
 * 计算编队战力（推力与质量作为基准综合战斗力）
 */
export function evaluateFleetPower(acc, fleet) {
  if (!fleet || !Array.isArray(fleet.shipIds) || fleet.shipIds.length === 0) return 0;
  const ships = (acc.ships || []).filter((s) => fleet.shipIds.includes(s.id));
  let power = 0;
  for (const s of ships) {
    // 基础舰船战力评估
    const mass = s.dryMass || 200;
    const thrust = s.thrust || 150;
    power += Math.round(thrust * 1.5 + mass * 0.5);
  }
  return Math.max(100, power);
}

/**
 * 发起对目标星球的远征进攻
 */
export function sendGalaxyRaid(acc, fleetId, targetSystem, opts = {}) {
  if (!acc || !targetSystem) return { ok: false, reason: '参数缺失' };
  const homeCode = acc.homePlanetCode || 'syl';
  const inst = getPlanetInstance(homeCode) || getPlanetInstance(homeCode.replace(/\d+$/, ''));
  if (!inst) return { ok: false, reason: '母星实例未就绪' };

  // 1. 自身与目标判定
  const profile = ensureCloudProfile(acc);
  if (targetSystem.commanderId === profile.commanderId) {
    return { ok: false, reason: '无法进攻自方主权殖民地' };
  }

  // 2. 免战保护盾判定
  const now = Date.now();
  if (targetSystem.shieldUntil && targetSystem.shieldUntil > now) {
    const remSec = Math.ceil((targetSystem.shieldUntil - now) / 1000);
    const remH = (remSec / 3600).toFixed(1);
    return { ok: false, reason: `目标受星际公约免战护盾保护，剩余约 ${remH} 小时，不可发起进攻` };
  }

  // 3. 编队校验
  const fleets = listFleets(acc);
  const fleet = fleets.find((f) => f.id === fleetId);
  if (!fleet) return { ok: false, reason: '所选编队不存在' };
  if (fleet.mission) return { ok: false, reason: '该编队正在执行其他任务中' };
  if (!fleet.shipIds || fleet.shipIds.length === 0) {
    return { ok: false, reason: '所选编队为空，请先在船坞指派舰船' };
  }

  // 4. 燃料校验（按距离光年折算燃料，每光年 150 mol 燃料）
  const dist = targetSystem.distanceLy || 2.0;
  const fuelNeed = Math.round(dist * 150);
  const fuelHave = (ownedOf(inst, '甲烷') || 0) + (ownedOf(inst, '氢气') || 0);
  if (fuelHave < fuelNeed) {
    return { ok: false, reason: `编队远征需要 ${fuelNeed} 燃料（甲烷/氢气），当前库存不足（持有 ${Math.floor(fuelHave)}）` };
  }
  if (ownedOf(inst, '甲烷') >= fuelNeed) {
    spendOwned(inst, '甲烷', fuelNeed);
  } else {
    spendOwned(inst, '氢气', fuelNeed);
  }

  // 5. 战力对比与裁决
  const myPower = evaluateFleetPower(acc, fleet);
  const targetDef = targetSystem.defensePower || 1000;
  const winProbability = Math.min(0.92, Math.max(0.12, myPower / (myPower + targetDef)));
  const isWin = opts.forceWin !== undefined ? !!opts.forceWin : (Math.random() < winProbability);

  if (isWin) {
    // 胜利：掠夺 5%~10% 物资
    const lootRatio = 0.05 + Math.random() * 0.05; // 5% ~ 10%
    const loots = [];
    const goods = targetSystem.goods || [];
    for (const g of goods) {
      const lootQty = Math.max(10, Math.floor((g.stock || 500) * lootRatio));
      addMaterial(inst, g.mat, lootQty);
      loots.push(`${g.nameCn || g.mat} ×${lootQty}`);
    }

    // 目标进入 12 小时免战保护
    targetSystem.shieldUntil = Date.now() + SHIELD_DURATION_MS;

    // 记录收件箱战报
    const msg = {
      type: 'battle_win',
      title: `【战报】大捷！突袭 ${targetSystem.planetNameCn}`,
      body: `你的编队「${fleet.nameCn}」（战力 ${myPower}）成功突防敌方防御阵列（要塞防值 ${targetDef}）！`,
      details: `战后收缴战利品入库母星：\n${loots.join('、')}\n对方行星已被星际公约激活 12 小时免战护盾。`,
    };
    addInboxMessage(acc, msg);

    return {
      ok: true,
      win: true,
      myPower,
      targetDef,
      loots,
      msg: '远征取得大捷！已掠夺物资并运回母星仓储。',
    };
  } else {
    // 战败：撤退，轻度检修
    const repairCostMat = '铁';
    const repairCost = Math.min(50, ownedOf(inst, repairCostMat));
    if (repairCost > 0) spendOwned(inst, repairCostMat, repairCost);

    const msg = {
      type: 'battle_loss',
      title: `【战报】失利：突袭 ${targetSystem.planetNameCn} 受阻`,
      body: `编队「${fleet.nameCn}」（战力 ${myPower}）遭到 ${targetSystem.planetNameCn} 密集炮火拦截（要塞防值 ${targetDef}），被迫紧急跃迁返航。`,
      details: `舰队受轻度损伤，母星地勤已消耗 ${repairCost} 铁完成战损检修。建议扩充舰队规模或增强装甲部件后再行出击。`,
    };
    addInboxMessage(acc, msg);

    return {
      ok: true,
      win: false,
      myPower,
      targetDef,
      msg: '攻势受阻，编队已紧急脱离并撤回母星。',
    };
  }
}

// ============================================================================
// 六、星际贸易任务（Interstellar Trade）
// ============================================================================

export function sendGalaxyTrade(acc, fleetId, targetSystem, matName, buyQty) {
  if (!acc || !targetSystem || !matName || buyQty <= 0) {
    return { ok: false, reason: '贸易参数不全' };
  }
  const homeCode = acc.homePlanetCode || 'syl';
  const inst = getPlanetInstance(homeCode) || getPlanetInstance(homeCode.replace(/\d+$/, ''));
  if (!inst) return { ok: false, reason: '母星实例未就绪' };

  const targetGood = (targetSystem.goods || []).find((g) => g.mat === matName);
  if (!targetGood) return { ok: false, reason: '对方并未挂售该项特产' };

  const price = targetGood.priceAscoin || 50;
  const totalCost = price * buyQty;

  // 检查货币：优先使用玩家持有的 Ascoin (acc.ascoin)，不足部分使用母星储备的黄金折抵（1 金 = 1,048,576 Ascoin）
  const curAscoin = Math.max(0, Number(acc.ascoin) || 0);
  const goldOwned = ownedOf(inst, '粗金') + ownedOf(inst, '金');
  const goldAscoinEq = goldOwned * 1048576;
  const totalFunds = curAscoin + goldAscoinEq;

  if (totalFunds < totalCost) {
    const goldNeeded = (totalCost / 1048576).toFixed(4);
    return {
      ok: false,
      reason: `总货款 ${totalCost} Ascoin（折合 ${goldNeeded} 纯金），当前资产不足（持有 ${Math.floor(curAscoin)} Ascoin 及 ${goldOwned.toFixed(4)} 黄金）`,
    };
  }

  let paidAscoin = 0;
  let paidGold = 0;

  if (curAscoin >= totalCost) {
    acc.ascoin = curAscoin - totalCost;
    paidAscoin = totalCost;
  } else {
    paidAscoin = curAscoin;
    acc.ascoin = 0;
    const remainAscoin = totalCost - paidAscoin;
    paidGold = Math.max(0.0001, remainAscoin / 1048576);
    if (ownedOf(inst, '金') >= paidGold) {
      spendOwned(inst, '金', paidGold);
    } else {
      spendOwned(inst, '粗金', paidGold);
    }
  }

  // 货物直接送达母星物品栏
  addMaterial(inst, matName, buyQty);

  // 写入信箱
  const payDesc = paidGold > 0
    ? (paidAscoin > 0 ? `已付 ${paidAscoin} Ascoin + ${paidGold.toFixed(4)} 金` : `已付 ${paidGold.toFixed(4)} 金`)
    : `已付 ${paidAscoin} Ascoin`;

  const msg = {
    type: 'trade',
    title: `【贸易回执】与 ${targetSystem.planetNameCn} 完成货物交割`,
    body: `你的货运船队已从「${targetSystem.planetNameCn}」采购 ${buyQty} 份 ${targetGood.nameCn || matName}。`,
    details: `交易单价：${price} Ascoin/单位\n结算总额：${totalCost} Ascoin（${payDesc}）\n货物已稳妥入库母星物品栏。`,
  };
  addInboxMessage(acc, msg);

  return { ok: true, buyQty, matName, totalCost, msg: '贸易完成，货物已运抵母星物品栏！' };
}

// ============================================================================
// 七、全服真实在线网络联动（API 接口直连）
// ============================================================================

export async function syncOnlineServer(acc) {
  if (!acc) return null;
  const snapshot = buildLocalSnapshot(acc);
  try {
    const res = await fetch('/api/online/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function fetchRemoteGalaxyRegistry(acc, filterQuery = '') {
  try {
    const res = await fetch('/api/online/commanders');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.list) && data.list.length > 0) {
        try { localStorage.setItem(REGISTRY_LOCAL_KEY, JSON.stringify(data.list)); } catch (e) {}
        const q = String(filterQuery || '').trim().toLowerCase();
        if (!q) return data.list;
        return data.list.filter((item) => (
          (item.planetNameCn && item.planetNameCn.toLowerCase().includes(q)) ||
          (item.commanderId && item.commanderId.toLowerCase().includes(q)) ||
          (item.callsign && item.callsign.toLowerCase().includes(q)) ||
          (item.faction && item.faction.toLowerCase().includes(q))
        ));
      }
    }
  } catch (e) {}
  return fetchGalaxyRegistry(acc, filterQuery);
}

export async function fetchOnlineChatMessages() {
  try {
    const res = await fetch('/api/online/chat');
    if (res.ok) {
      const data = await res.json();
      return (data && data.messages) || [];
    }
  } catch (e) {}
  return [];
}

export async function sendOnlineChatMessage(acc, text) {
  const profile = ensureCloudProfile(acc);
  try {
    const res = await fetch('/api/online/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commanderId: profile.commanderId,
        callsign: profile.callsign,
        text,
      }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, reason: '网络连接异常' };
  }
}

export async function fetchOnlineMarketListings() {
  try {
    const res = await fetch('/api/online/market');
    if (res.ok) {
      const data = await res.json();
      return (data && data.listings) || [];
    }
  } catch (e) {}
  return [];
}

export async function listOnlineMarketItem(acc, { mat, nameCn, qty, priceAscoin }) {
  const profile = ensureCloudProfile(acc);
  try {
    const res = await fetch('/api/online/market/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellerId: profile.commanderId,
        sellerCallsign: profile.callsign,
        mat,
        nameCn,
        qty,
        priceAscoin,
      }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, reason: '网络连接异常' };
  }
}

export async function buyOnlineMarketItem(acc, listingId) {
  const profile = ensureCloudProfile(acc);
  try {
    const res = await fetch('/api/online/market/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyerId: profile.commanderId,
        buyerCallsign: profile.callsign,
        listingId,
      }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, reason: '网络连接异常' };
  }
}

export async function buyOnlineMarketListing(acc, listingId) {
  if (!acc || !listingId) return { ok: false, reason: '参数缺失' };
  const homeCode = acc.homePlanetCode || 'syl';
  const inst = getPlanetInstance(homeCode) || getPlanetInstance(homeCode.replace(/\d+$/, ''));
  if (!inst) return { ok: false, reason: '母星实例未就绪' };

  // 1. 先查验远程订单
  const listings = await fetchOnlineMarketListings();
  const listing = listings.find((item) => item.id === listingId);
  if (!listing) {
    return { ok: false, reason: '该货单不存在或已被其他指挥官抢购' };
  }

  const profile = ensureCloudProfile(acc);
  if (listing.sellerId === profile.commanderId) {
    return { ok: false, reason: '不能采购自己挂售的货单' };
  }

  const totalCost = listing.priceAscoin * listing.qty;
  const curAscoin = Math.max(0, Number(acc.ascoin) || 0);
  const goldOwned = ownedOf(inst, '粗金') + ownedOf(inst, '金');
  const goldAscoinEq = goldOwned * 1048576;
  const totalFunds = curAscoin + goldAscoinEq;

  if (totalFunds < totalCost) {
    const goldNeeded = (totalCost / 1048576).toFixed(4);
    return {
      ok: false,
      reason: `总货款 ${totalCost} Ascoin（折合 ${goldNeeded} 纯金），当前资金不足`,
    };
  }

  // 2. 向服务端发起真实交割核验
  const remoteRes = await buyOnlineMarketItem(acc, listingId);
  if (!remoteRes.ok) {
    return { ok: false, reason: remoteRes.reason || '远端交割失败' };
  }

  // 3. 扣除本地货币
  if (curAscoin >= totalCost) {
    acc.ascoin = curAscoin - totalCost;
  } else {
    acc.ascoin = 0;
    const remainAscoin = totalCost - curAscoin;
    const paidGold = Math.max(0.0001, remainAscoin / 1048576);
    if (ownedOf(inst, '金') >= paidGold) {
      spendOwned(inst, '金', paidGold);
    } else {
      spendOwned(inst, '粗金', paidGold);
    }
  }

  // 4. 物资入库
  addMaterial(inst, listing.mat, listing.qty);

  // 5. 写入本地信箱
  addInboxMessage(acc, {
    type: 'market_buy',
    title: `🛒【集市成交】成功采购 ${listing.nameCn}`,
    body: `你从星际集市成功采购了指挥官 ${listing.sellerCallsign} 挂售的 ${listing.nameCn} ×${listing.qty}。`,
    details: `交割单号：${listing.id}\n总支付款项：${totalCost} Ascoin\n物资已移交星际物流并入库母星！`,
  });

  return { ok: true, listing, totalCost, msg: `成功采购 ${listing.nameCn} ×${listing.qty}！物资已入库母星。` };
}

export async function createOnlineMarketListing(acc, { mat, nameCn, qty, priceAscoin }) {
  if (!acc || !mat || qty <= 0 || priceAscoin <= 0) {
    return { ok: false, reason: '挂售参数不全' };
  }
  const homeCode = acc.homePlanetCode || 'syl';
  const inst = getPlanetInstance(homeCode) || getPlanetInstance(homeCode.replace(/\d+$/, ''));
  if (!inst) return { ok: false, reason: '母星实例未就绪' };

  if (ownedOf(inst, mat) < qty) {
    return { ok: false, reason: `母星物资储备不足（当前拥有 ${ownedOf(inst, mat)}）` };
  }

  // 扣减本地仓储
  spendOwned(inst, mat, qty);

  const res = await listOnlineMarketItem(acc, { mat, nameCn, qty, priceAscoin });
  if (!res.ok) {
    // 恢复物资
    addMaterial(inst, mat, qty);
    return { ok: false, reason: res.reason || '远端挂售失败' };
  }

  addInboxMessage(acc, {
    type: 'market_list',
    title: `📦【货单上架】${nameCn} ×${qty} 挂售成功`,
    body: `你的 ${nameCn} ×${qty} 已成功发布至全星区跳蚤集市，单价 ${priceAscoin} Ascoin。`,
    details: `挂单编号：${res.listing.id}\n当其他指挥官采购时，结算货款将自动存入信箱。`,
  });

  return { ok: true, listing: res.listing, msg: `成功挂售 ${nameCn} ×${qty}！` };
}


