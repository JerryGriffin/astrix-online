// ============================================================================
// data/factions.js —— 通用势力表（v0.4.8 新增）
//
// 为什么需要这个文件
//   行星战区地图（core/theater.js）原本直接吃 `data/hoi1936.js` 的
//   HOI_MAIN_NATIONS —— 于是**只有「风暴前夜」剧本才有敌方势力**，
//   其他开局（初登星球 / 漫溯深空）打开战区页要么被门禁挡掉，
//   要么生成一张「玩家 vs 11 个二战列强」的错乱版图。
//
//   但战争系统（core/war.js）从设计之初就是**剧本无关**的
//   （其文件头注释明确写着「它服务于所有剧本，不只 1936」）。
//   地图也应该如此：把「地图上有哪些势力」这件事从具体剧本里抽出来。
//
// 本表提供**非 1936 剧本**使用的势力；1936 剧本继续用真实列强数据。
// 势力 id 统一带 `fac_` 前缀，与 1936 的国家 id（'ger'/'fra'…）天然隔离，
// 避免两套数据在同一个存档里混用导致 id 撞车。
// ============================================================================

/**
 * 通用势力定义。
 * divisions / ic 沿用 1936 表的口径（供 theater 生成领土面积），
 * 但取值只用于「相对强弱」，不需要史实精确。
 */
export const GENERIC_FACTIONS = [
  {
    id: 'fac_rim', nameCn: '边缘自治领', nameEn: 'Rim Compact', flag: '🟠',
    divisions: 22, ic: 34,
    desc: '占据行星边缘地带的松散联盟，装备精良但兵力分散。',
  },
  {
    id: 'fac_corp', nameCn: '矿业联合体', nameEn: 'Mining Combine', flag: '🟡',
    divisions: 30, ic: 46,
    desc: '把整条矿脉据为己有的企业武装，产能极高，防线薄弱。',
  },
  {
    id: 'fac_colony', nameCn: '殖民穹顶群', nameEn: 'Colony Domes', flag: '🟢',
    divisions: 16, ic: 28,
    desc: '以穹顶都市为核心的研究型势力，防御坚固、外力薄弱。',
  },
  {
    id: 'fac_maraud', nameCn: '掠夺者团伙', nameEn: 'Raider Bands', flag: '🔴',
    divisions: 26, ic: 18,
    desc: '来去如风的掠夺者，兵力不弱但补给线脆弱。',
  },
  {
    id: 'fac_charter', nameCn: '特许自治邦', nameEn: 'Charter Worlds', flag: '🔵',
    divisions: 34, ic: 52,
    desc: '持特许状的企业邦联，工业最强，野心也最大。',
  },
  {
    id: 'fac_synd', nameCn: '矿业公社', nameEn: 'Mining Communes', flag: '🟣',
    divisions: 20, ic: 38,
    desc: '由矿工组成的公社联盟，人力充足，装备老旧。',
  },
];

/** 通用势力 id 前缀（与 1936 国家 id 隔离） */
export const FAC_PREFIX = 'fac_';

/** id → 势力定义（仅通用势力） */
export const GENERIC_FACTION_BY_ID = Object.fromEntries(
  GENERIC_FACTIONS.map((f) => [f.id, f]),
);

/** 判断一个 owner id 是否属于通用势力 */
export function isGenericFaction(id) {
  return String(id || '').indexOf(FAC_PREFIX) === 0;
}

/**
 * 任意 owner id → 势力名。
 * 同时认识 1936 国家与通用势力，供 UI 在两种剧本下都能显示战区归属。
 * 查不到时返回兜底名（而不是 undefined，避免 UI 出现「undefined」字样）。
 *
 * @param {string} id owner id（如 'ger' / 'fac_rim' / 'player'）
 * @param {object} hoiById 1936 国家表（可选，传入可解析国家名）
 * @param {object} opts { playerName } 玩家自己的势力名（默认「我方」）
 */
export function factionNameCn(id, hoiById, opts) {
  const key = String(id || '');
  const o = opts || {};
  if (o.playerName && (key === o.playerId || (!o.playerId && key === 'player'))) return o.playerName;
  const g = GENERIC_FACTION_BY_ID[key];
  if (g) return g.nameCn;
  if (key === 'player') return '我方';
  if (hoiById && hoiById[key] && hoiById[key].nameCn) return hoiById[key].nameCn;
  if (!key) return '中立';
  return '未知势力';
}

/** 任意 owner id → 旗帜（无则空串） */
export function factionFlag(id, hoiById) {
  const key = String(id || '');
  const g = GENERIC_FACTION_BY_ID[key];
  if (g) return g.flag || '';
  if (hoiById && hoiById[key] && hoiById[key].flag) return hoiById[key].flag;
  return '';
}

/** 任意 owner id → 势力描述 */
export function factionDesc(id, hoiById) {
  const key = String(id || '');
  const g = GENERIC_FACTION_BY_ID[key];
  if (g) return g.desc || '';
  if (hoiById && hoiById[key] && hoiById[key].desc) return hoiById[key].desc || '';
  return '';
}

/** 任意 owner id → 实力（用于地图上的势力强度显示 / AI 目标价值） */
export function factionPower(id, hoiById) {
  const key = String(id || '');
  const g = GENERIC_FACTION_BY_ID[key];
  if (g) return { divisions: Number(g.divisions) || 0, ic: Number(g.ic) || 0 };
  const n = hoiById && hoiById[key];
  if (n) return { divisions: Number(n.divisions) || 0, ic: Number(n.ic) || 0 };
  return { divisions: 0, ic: 0 };
}
