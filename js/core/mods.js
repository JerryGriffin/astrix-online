// 离线模式 mod 系统（Astrix v0.2.2）
// 允许玩家导入 JSON 格式的 mod 文件，对离线游戏数值做安全倍率调整。
// 设计原则：
//   * 只支持**白名单倍率字段**与**开局资源**，不开放任意代码/任意字段 —— 杜绝存档损坏与作弊失控；
//   * localStorage 持久化（键 astrix.mods.v1），仅离线模式生效（UI 侧保证）；
//   * 本模块**不 import 任何其它游戏模块**（避免成环），全部为纯函数 + 本地存储；
//   * 数值全部夹取到安全区间，非法输入一律拒绝并给出原因。
//
// mod JSON 格式示例：
// {
//   "name": "畅玩加速包",
//   "version": "1.0",
//   "author": "指挥官",
//   "desc": "采集/生产/科研 3 倍，开局多送物资",
//   "effects": {
//     "collectRateMul": 3,       // 采集产出倍率（0.1 ~ 100）
//     "lineRateMul": 3,          // 生产线产出倍率（0.1 ~ 100）
//     "researchRateMul": 3,      // 研究点产出倍率（0.1 ~ 100）
//     "powerOutputMul": 1.5,     // 发电倍率（0.1 ~ 100）
//     "startAscoin": 500000,     // 新档开局追加 Ascoin（0 ~ 1e9，整数）
//     "startResources": {        // 新档开局追加到母星的资源（每项 0 ~ 1e9）
//       "石头": 5000, "水": 5000, "铁": 1000
//     }
//   }
// }

const MODS_KEY = 'astrix.mods.v1';

// 倍率字段白名单与安全区间
const MUL_FIELDS = {
  collectRateMul: { label: '采集产出倍率', min: 0.1, max: 100, def: 1 },
  lineRateMul: { label: '生产线产出倍率', min: 0.1, max: 100, def: 1 },
  researchRateMul: { label: '研究点产出倍率', min: 0.1, max: 100, def: 1 },
  powerOutputMul: { label: '发电倍率', min: 0.1, max: 100, def: 1 },
};
const START_ASCOIN_MAX = 1e9;
const START_RES_MAX = 1e9;

// ---------------------------------------------------------------------------
// 本地存储（浏览器 localStorage；Node 探针环境降级为内存 Map）
// ---------------------------------------------------------------------------
let _memStore = null;   // Node 探针兜底
function storeGet() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      return localStorage.getItem(MODS_KEY);
    }
  } catch (e) { /* 隐私模式等 */ }
  return _memStore;
}
function storeSet(text) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem(MODS_KEY, text);
      return;
    }
  } catch (e) { /* ignore */ }
  _memStore = text;
}

// ---------------------------------------------------------------------------
// 读写 mod 列表
// ---------------------------------------------------------------------------
function modsRaw() {
  const text = storeGet();
  if (!text) return [];
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function modsSave(list) {
  _cache = null;   // 使效果缓存失效
  storeSet(JSON.stringify(list));
}

/** 已安装的全部 mod（含停用的） */
export function listMods() {
  return modsRaw().slice();
}

/** 生成 mod id（名称散列 + 随机后缀，同装两份不串） */
function genModId(name) {
  let h = 0;
  const s = String(name || 'mod');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'mod_' + Math.abs(h).toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// ---------------------------------------------------------------------------
// 校验与安装
// ---------------------------------------------------------------------------
function validateMod(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: '模组文件的根节点必须是一个 JSON 对象' };
  }
  const name = String(data.name || '').trim();
  if (!name) return { ok: false, reason: '缺少模组名称字段（JSON 键名应为 name）' };
  if (name.length > 40) return { ok: false, reason: '模组名称过长（不超过 40 个字）' };

  const effects = data.effects && typeof data.effects === 'object' && !Array.isArray(data.effects)
    ? data.effects : {};
  // 倍率：白名单字段、必须是有限数字、夹取安全区间；未知字段直接拒绝（防手滑写错键名不生效）
  const clean = {};
  for (const k in effects) {
    if (k === 'startAscoin' || k === 'startResources') continue;
    if (!(k in MUL_FIELDS)) {
      return { ok: false, reason: '不支持的效果字段「' + k + '」。可用字段：' + Object.keys(MUL_FIELDS).join(' / ') + ' / startAscoin（开局星币） / startResources（开局物资）' };
    }
    const v = Number(effects[k]);
    if (!Number.isFinite(v)) {
      return { ok: false, reason: MUL_FIELDS[k].label + ' 必须是数字' };
    }
    const cfg = MUL_FIELDS[k];
    clean[k] = Math.min(cfg.max, Math.max(cfg.min, v));
  }
  // 开局 Ascoin
  if (effects.startAscoin != null) {
    const v = Math.floor(Number(effects.startAscoin));
    if (!Number.isFinite(v) || v < 0) return { ok: false, reason: '开局星币（startAscoin）必须是非负整数' };
    clean.startAscoin = Math.min(START_ASCOIN_MAX, v);
  }
  // 开局资源：值为非负数字，键为任意材料名（材料名合法性由落库时 ensureEntry 保证）
  if (effects.startResources != null) {
    const res = effects.startResources;
    if (!res || typeof res !== 'object' || Array.isArray(res)) {
      return { ok: false, reason: '开局物资（startResources）必须是「材料名: 数量」形式的对象' };
    }
    const out = {};
    for (const mat in res) {
      const v = Math.floor(Number(res[mat]));
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, reason: '开局物资「' + mat + '」的数量必须是非负整数' };
      }
      if (v > 0) out[mat] = Math.min(START_RES_MAX, v);
    }
    if (Object.keys(out).length) clean.startResources = out;
  }

  return {
    ok: true,
    mod: {
      id: genModId(name),
      name,
      version: String(data.version || '1.0').slice(0, 20),
      author: String(data.author || '未知').slice(0, 30),
      desc: String(data.desc || '').slice(0, 200),
      effects: clean,
      enabled: true,
      installedAt: Date.now(),
    },
  };
}

/** 从 JSON 文本安装 mod。返回 { ok, mod?, reason? } */
export function installMod(jsonText) {
  let data;
  try {
    data = JSON.parse(String(jsonText || ''));
  } catch (e) {
    return { ok: false, reason: 'JSON 解析失败：' + (e && e.message ? e.message : e) };
  }
  const v = validateMod(data);
  if (!v.ok) return v;
  const list = modsRaw();
  list.push(v.mod);
  modsSave(list);
  return { ok: true, mod: v.mod };
}

/** 启用 / 停用 */
export function setModEnabled(id, enabled) {
  const list = modsRaw();
  const m = list.find((x) => x && x.id === id);
  if (!m) return { ok: false, reason: '未找到该 mod' };
  m.enabled = !!enabled;
  modsSave(list);
  return { ok: true };
}

/** 卸载 */
export function removeMod(id) {
  const list = modsRaw();
  const i = list.findIndex((x) => x && x.id === id);
  if (i < 0) return { ok: false, reason: '未找到该 mod' };
  list.splice(i, 1);
  modsSave(list);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 效果合成（带内存缓存：只在安装/启停/卸载时失效）
// ---------------------------------------------------------------------------
let _cache = null;

/** 全部启用 mod 的合成效果（乘法叠加）。恒返回完整字段，缺省 = 1 */
export function modEffects() {
  if (_cache) return _cache;
  const out = {};
  for (const k in MUL_FIELDS) out[k] = 1;
  out.startAscoin = 0;
  out.startResources = {};
  for (const m of modsRaw()) {
    if (!m || m.enabled === false) continue;
    const fx = m.effects || {};
    for (const k in MUL_FIELDS) {
      const v = Number(fx[k]);
      if (Number.isFinite(v) && v > 0) out[k] *= Math.min(MUL_FIELDS[k].max, Math.max(MUL_FIELDS[k].min, v));
    }
    const asc = Math.floor(Number(fx.startAscoin));
    if (Number.isFinite(asc) && asc > 0) out.startAscoin += Math.min(START_ASCOIN_MAX, asc);
    const res = fx.startResources;
    if (res && typeof res === 'object') {
      for (const mat in res) {
        const v = Math.floor(Number(res[mat]));
        if (Number.isFinite(v) && v > 0) {
          out.startResources[mat] = Math.min(START_RES_MAX, (out.startResources[mat] || 0) + v);
        }
      }
    }
  }
  _cache = out;
  return out;
}

// ---------------------------------------------------------------------------
// 新档开局加成（由 state.js 在建号 / 建母星实例时调用）
// ---------------------------------------------------------------------------

/**
 * 建号时调用：立即把 mod 的开局 Ascoin 加进账号；
 * 资源部分暂存到 acc._modStartRes，等母星实例创建时由 applyPendingStartResources 落库。
 * （建号时 STATE.planets 刚被清空、母星实例尚不存在，直接落库会丢。）
 */
export function applyStartBonus(acc) {
  if (!acc) return false;
  const fx = modEffects();
  let any = false;
  if (fx.startAscoin > 0) {
    acc.ascoin = (Number(acc.ascoin) || 0) + Math.floor(fx.startAscoin);
    any = true;
  }
  const res = fx.startResources || {};
  if (Object.keys(res).length) {
    acc._modStartRes = Object.assign({}, acc._modStartRes || {});
    for (const mat in res) {
      acc._modStartRes[mat] = (acc._modStartRes[mat] || 0) + res[mat];
    }
    any = true;
  }
  return any;
}

/**
 * 母星实例创建时调用（state.js#getPlanetInstance 的 isHome 分支）：
 * 把暂存的 mod 开局资源写进母星物品栏并清除暂存标记。
 */
export function applyPendingStartResources(acc, homeInst) {
  if (!acc || !homeInst || !acc._modStartRes) return false;
  const res = acc._modStartRes;
  let any = false;
  if (!Array.isArray(homeInst.inventory)) homeInst.inventory = [];
  for (const mat in res) {
    const qty = Math.floor(Number(res[mat])) || 0;
    if (!(qty > 0)) continue;
    let e = homeInst.inventory.find((x) => x && x.mat === mat && x.layer === 'surface');
    if (!e) {
      e = { mat, layer: 'surface', owned: 0, rate: 0, reserve: 0, remaining: 0, abundance: 0 };
      homeInst.inventory.push(e);
    }
    e.owned = (Number(e.owned) || 0) + qty;
    e.remaining = Math.max(0, (Number(e.remaining) || 0) + qty);
    e.reserve = Math.max(Number(e.reserve) || 0, e.remaining);
    any = true;
  }
  delete acc._modStartRes;
  return any;
}
