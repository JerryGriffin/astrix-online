// 星际舰队战术交战模拟引擎（Astrix v0.2.0）
// 负责舰队对战的回合/实时推演、多舰种定位、兵种协同、护盾与装甲吸收、战术指令冷却与结算。
// 纯原生 ES 模块，无任何外部构建依赖。

import { fmtNum } from './format.js?v=21.8';

let _combatSeq = 0;
function genShipUid() {
  _combatSeq = (_combatSeq + 1) % 100000;
  return 'cship_' + Date.now().toString(36) + '_' + _combatSeq;
}

/**
 * 5 大太空战斗舰种定位
 */
export const SHIP_ROLES = {
  interceptor: {
    id: 'interceptor',
    name: '突击截击舰',
    icon: '🚀',
    desc: '高机动高速度，基础闪避率提升 20%，擅长突袭轻型目标。',
    dodgeBonus: 0.2,
    critRateBonus: 0.05,
    critMul: 1.75,
  },
  destroyer: {
    id: 'destroyer',
    name: '破盾驱逐舰',
    icon: '🛡️',
    desc: '装备高频等离子脉冲炮，对敌方护盾具有 150% 额外破坏力。',
    shieldMul: 1.5,
    critMul: 1.8,
  },
  cruiser: {
    id: 'cruiser',
    name: '导弹巡洋舰',
    icon: '⚡',
    desc: '均衡主力战舰核心，搭载全向反舰飞弹与激光阵列，火力持续而稳固。',
    critMul: 1.9,
  },
  battleship: {
    id: 'battleship',
    name: '重装战列舰',
    icon: '💥',
    desc: '重装甲与巨型轴基磁轨主炮，对护盾附带 25% 真实贯穿伤害，暴击倍率高达 2.3 倍！',
    pierceRate: 0.25,
    critMul: 2.3,
  },
  carrier: {
    id: 'carrier',
    name: '空天蜂群母舰',
    icon: '🛸',
    desc: '搭载舰载无人机与轰炸机联队，持续出动机群突袭，为全舰队提供战术充能增益。',
    energyRegenBonus: 2.0,
    critMul: 1.8,
  },
};

/**
 * 钢铁雄心式战略学说 (HOI4 Military Doctrines)
 * 影响整支舰队在交火中的战术偏向与属性修正
 */
export const BATTLE_DOCTRINES = {
  blitzkrieg: {
    id: 'blitzkrieg',
    name: '闪电突穿学说',
    icon: '⚡',
    desc: '装甲突击与高速穿插：全舰队攻击力 +20%，初始战术电容 +25，闪避率 +10%，受到伤害 +10%。',
    atkMul: 1.20,
    dmgTakenMul: 1.10,
    dodgeBonus: 0.10,
    initialEnergyBonus: 25,
  },
  superior_firepower: {
    id: 'superior_firepower',
    name: '优势火力学说',
    icon: '🎯',
    desc: '全域重炮与饱和打击：暴击率提升至常驻 35%，暴击伤害额外提升 30%，战术回能速度 +20%。',
    critRateBonus: 0.20,
    critMulBonus: 0.30,
    energyRegenMul: 1.20,
  },
  grand_battleplan: {
    id: 'grand_battleplan',
    name: '大纵深防御学说',
    icon: '🛡️',
    desc: '要塞纵深与防线弹性：全舰护盾与装甲上限 +35%，全域受击伤害减免 15%，护盾自回速度翻倍。',
    hullMul: 1.35,
    shieldMul: 1.35,
    dmgTakenMul: 0.85,
    shieldRegenMul: 2.0,
  },
  guerilla_warfare: {
    id: 'guerilla_warfare',
    name: '狼群机动破袭',
    icon: '🐺',
    desc: '分散破交与游击袭扰：全舰航速 +30%，真实护盾贯穿率 +20%，无人机与鱼雷指令消耗 -10 能量。',
    speedMul: 1.30,
    pierceBonus: 0.20,
    energyDiscount: 10,
  },
};

/**
 * 根据船名与属性智能推导战舰职能
 */
export function detectShipRole(ship) {
  const name = String(ship.name || ship.className || '');
  const mass = Number(ship.dryMass) || 300;
  if (name.includes('母舰') || name.includes('航母') || name.includes('载机') || name.includes('Carrier')) {
    return 'carrier';
  }
  if (name.includes('战列') || name.includes('无畏') || mass >= 800 || name.includes('Battleship')) {
    return 'battleship';
  }
  if (name.includes('巡洋') || (mass >= 450 && mass < 800) || name.includes('Cruiser')) {
    return 'cruiser';
  }
  if (name.includes('驱逐') || (mass >= 320 && mass < 450) || name.includes('Destroyer')) {
    return 'destroyer';
  }
  return 'interceptor';
}

/**
 * 将一艘基础飞船转换为战斗单元数据结构
 */
export function toCombatShip(ship, side = 'player') {
  const name = ship.name || ship.className || (side === 'player' ? '己方战舰' : '敌方主力舰');
  const roleId = ship.roleId || ship.role || detectShipRole(ship);
  const role = SHIP_ROLES[roleId] || SHIP_ROLES.interceptor;
  const dryMass = Number(ship.dryMass) || (roleId === 'battleship' ? 950 : roleId === 'cruiser' ? 520 : 300);
  const thrust = Number(ship.thrust) || (roleId === 'interceptor' ? 380 : 250);
  const stats = ship.stats || {};

  // 基础战力推导属性
  let maxHull = Math.max(120, Math.round(dryMass * 1.6 + (stats.mass || 100)));
  let maxShield = Math.max(80, Math.round(thrust * 1.3));
  let baseAtk = Math.max(18, Math.round((thrust * 0.38 + dryMass * 0.16)));
  let speed = Math.max(10, Math.min(65, Math.round(thrust / (dryMass * 0.045 + 1))));

  // 舰种专精修正
  if (roleId === 'interceptor') {
    speed = Math.round(speed * 1.35);
  } else if (roleId === 'battleship') {
    maxHull = Math.round(maxHull * 1.5);
    baseAtk = Math.round(baseAtk * 1.45);
    speed = Math.max(8, Math.round(speed * 0.7));
  } else if (roleId === 'destroyer') {
    maxShield = Math.round(maxShield * 1.25);
  } else if (roleId === 'carrier') {
    maxHull = Math.round(maxHull * 1.2);
    baseAtk = Math.round(baseAtk * 0.9);
  }

  return {
    id: ship.id || genShipUid(),
    name,
    type: ship.type || ship.className || role.name,
    roleId,
    roleName: role.name,
    roleIcon: role.icon,
    side, // 'player' | 'enemy'
    hull: maxHull,
    hullMax: maxHull,
    shield: maxShield,
    shieldMax: maxShield,
    shieldRegen: Math.max(2, Math.round(maxShield * 0.05)), // 每秒/回合回盾
    atk: baseAtk,
    speed,
    critRate: (roleId === 'cruiser' ? 0.18 : 0.12) + (role.critRateBonus || 0),
    critMul: role.critMul || 1.8,
    alive: true,
    damageDealt: 0,
    damageTaken: 0,
    shieldAbsorbed: 0,
    kills: 0,
    targetId: null,
  };
}

/**
 * 战术指令配置列表（扩充至 7 种多样化战术体系）
 */
export const TACTICAL_COMMANDS = {
  focus: {
    id: 'focus',
    name: '主炮集火',
    icon: '🎯',
    costEnergy: 25,
    cooldown: 8,
    desc: '全员主炮锁定指定敌舰或残血目标，暴击率暴增至 65%，且攻击破甲深度大幅提升！',
  },
  shield: {
    id: 'shield',
    name: '护盾过载',
    icon: '🛡️',
    costEnergy: 30,
    cooldown: 12,
    desc: '向护盾偏转线圈注入高能等离子流，瞬时充能 45% 护盾，并获得 4 秒 50% 伤害减免！',
  },
  torpedo: {
    id: 'torpedo',
    name: '反舰鱼雷',
    icon: '🚀',
    costEnergy: 35,
    cooldown: 10,
    desc: '发射穿甲高爆磁轨鱼雷，无视敌方护盾偏转力场，直接造成高额装甲贯穿真实伤害！',
  },
  drones: {
    id: 'drones',
    name: '蜂群无人机',
    icon: '🛰️',
    costEnergy: 20,
    cooldown: 6,
    desc: '弹射全自动战术无人机编队，穿梭敌阵持续扫射，压制敌方自动回盾系统！',
  },
  emp: {
    id: 'emp',
    name: '磁暴脉冲',
    icon: '⚡',
    costEnergy: 30,
    cooldown: 11,
    desc: '释放大范围电磁过载冲击波，瞬间烧毁敌方全员 35% 护盾，并瘫痪其主炮武器 3 秒！',
  },
  boarding: {
    id: 'boarding',
    name: '跳帮强袭',
    icon: '🪂',
    costEnergy: 35,
    cooldown: 14,
    desc: '空降陆战队跳帮穿梭机直扑敌方最强战舰，引爆内部能源室并造成致命破损！',
  },
  warp: {
    id: 'warp',
    name: '战术跃迁',
    icon: '🌌',
    costEnergy: 40,
    cooldown: 15,
    desc: '启动曲率跃迁引擎紧急机动拉脱，使全舰队闪避大幅提升至 80%！',
  },
  orbital_bombard: {
    id: 'orbital_bombard',
    name: '天基湮灭轰炸',
    icon: '☄️',
    costEnergy: 45,
    cooldown: 16,
    desc: '引导轨道高能聚能等离子光束群进行全图饱和地毯式轰炸，对敌方全舰队造成毁灭性真实面杀伤！',
  },
  overclock_repair: {
    id: 'overclock_repair',
    name: '纳米战地抢修',
    icon: '🔧',
    costEnergy: 30,
    cooldown: 12,
    desc: '释放数以亿计的战地纳米工程机械虫群，紧急重构我方所有存活舰艇的装甲与受损龙骨（修复 35% 船体）！',
  },
};

/**
 * 初始化一场战斗会话
 */
export function createBattleSession(playerFleetShips = [], enemyShips = [], options = {}) {
  const pShips = playerFleetShips.map((s) => toCombatShip(s, 'player'));
  const eShips = enemyShips.map((s) => toCombatShip(s, 'enemy'));

  if (pShips.length === 0) {
    pShips.push(toCombatShip({ name: '先锋截击舰·刺猬号', dryMass: 350, thrust: 400, role: 'interceptor' }, 'player'));
    pShips.push(toCombatShip({ name: '重装突击巡洋舰', dryMass: 600, thrust: 320, role: 'cruiser' }, 'player'));
  }
  if (eShips.length === 0) {
    eShips.push(toCombatShip({ name: '星盗破盾驱逐舰', dryMass: 420, thrust: 280, role: 'destroyer' }, 'enemy'));
    eShips.push(toCombatShip({ name: '星盗要塞旗舰', dryMass: 900, thrust: 240, role: 'battleship' }, 'enemy'));
  }

  // 战略学说加成初始化 (HOI4 Doctrine)
  const doctrineId = options.doctrine || 'blitzkrieg';
  const doctrine = BATTLE_DOCTRINES[doctrineId] || BATTLE_DOCTRINES.blitzkrieg;

  // 根据战略学说调整己方舰艇基础属性
  for (const s of pShips) {
    if (doctrine.hullMul) {
      s.hullMax = Math.round(s.hullMax * doctrine.hullMul);
      s.hull = s.hullMax;
    }
    if (doctrine.shieldMul) {
      s.shieldMax = Math.round(s.shieldMax * doctrine.shieldMul);
      s.shield = s.shieldMax;
    }
    if (doctrine.atkMul) s.atk = Math.round(s.atk * doctrine.atkMul);
    if (doctrine.speedMul) s.speed = Math.round(s.speed * doctrine.speedMul);
    if (doctrine.critRateBonus) s.critRate = Math.min(0.85, s.critRate + doctrine.critRateBonus);
    if (doctrine.critMulBonus) s.critMul += doctrine.critMulBonus;
    if (doctrine.dodgeBonus) s.dodgeBonus = (s.dodgeBonus || 0) + doctrine.dodgeBonus;
  }

  // 统计母舰提供的能量恢复光环
  let carrierBonus = 0;
  for (const s of pShips) {
    if (s.roleId === 'carrier') carrierBonus += SHIP_ROLES.carrier.energyRegenBonus;
  }

  let baseRegen = 5 + carrierBonus;
  if (doctrine.energyRegenMul) baseRegen *= doctrine.energyRegenMul;

  const initEnergy = Math.min(100, 50 + (doctrine.initialEnergyBonus || 0));

  const cds = {};
  for (const k in TACTICAL_COMMANDS) cds[k] = 0;

  return {
    id: 'battle_' + Date.now().toString(36),
    title: options.title || '深空遭遇战',
    doctrine: doctrineId,
    doctrineInfo: doctrine,
    playerShips: pShips,
    enemyShips: eShips,
    designatedTargetId: null, // 玩家手动指定集火目标
    round: 1,
    timeSec: 0,
    energy: initEnergy,
    energyMax: 100,
    energyRegen: baseRegen, // 每秒回能
    activeBuffs: {
      focusActive: 0,
      shieldBuff: 0,
      warpActive: 0,
      droneActive: 0,
      empParalyze: 0,
    },
    logs: [
      { text: `战备警报！舰队已切入交火航线，战场雷达已捕获 ${eShips.length} 艘敌对舰艇！`, type: 'info' }
    ],
    ended: false,
    winner: null, // 'player' | 'enemy' | 'draw'
    cooldowns: cds,
  };
}

/**
 * 执行一次单向单舰开火攻击
 */
export function fireShip(attacker, defender, buffs = {}) {
  if (!attacker.alive || !defender.alive) return null;

  const isFocus = (buffs.focusActive || 0) > 0;
  const isWarp = (buffs.warpActive || 0) > 0;
  const isShieldBuff = (buffs.shieldBuff || 0) > 0;
  const isEmpParalyzed = (buffs.empParalyze || 0) > 0 && attacker.side === 'enemy';

  if (isEmpParalyzed) {
    return {
      attacker, defender, hit: false, paralyzed: true,
      msg: `⚡ ${attacker.name} 武器系统被 EMP 磁暴脉冲瘫痪中，本轮无法开火！`
    };
  }

  // 闪避计算（受速度比与舰种加成影响）
  let dodgeChance = Math.max(0.05, Math.min(0.75, (defender.speed - attacker.speed) * 0.015));
  if (defender.side === 'player' && isWarp) dodgeChance = 0.8;
  const isDodge = Math.random() < dodgeChance;

  if (isDodge) {
    return {
      attacker, defender, hit: false, dodge: true,
      msg: `${attacker.name} 锁定开火，但被 ${defender.name} 依靠高速机动战术规避闪过！`
    };
  }

  // 暴击判定
  const critRate = isFocus && attacker.side === 'player' ? 0.65 : attacker.critRate;
  const isCrit = Math.random() < critRate;
  let dmg = attacker.atk * (0.85 + Math.random() * 0.3);
  if (isCrit) dmg *= attacker.critMul;

  if (defender.side === 'player' && isShieldBuff) {
    dmg *= 0.5; // 护盾过载伤害减免
  }

  // 舰种特性：驱逐舰对护盾 1.5 倍加成，战列舰 25% 护盾穿透
  const role = SHIP_ROLES[attacker.roleId] || {};
  let pierceDmg = 0;
  if (role.pierceRate && defender.shield > 0) {
    pierceDmg = Math.round(dmg * role.pierceRate);
    dmg -= pierceDmg;
  }
  if (role.shieldMul && defender.shield > 0) {
    dmg = Math.round(dmg * role.shieldMul);
  }

  dmg = Math.round(dmg);

  // 护盾吸收与船体损耗
  let shieldDmg = 0;
  let hullDmg = pierceDmg;
  if (defender.shield > 0) {
    if (defender.shield >= dmg) {
      defender.shield -= dmg;
      shieldDmg = dmg;
    } else {
      shieldDmg = defender.shield;
      hullDmg += (dmg - defender.shield);
      defender.shield = 0;
    }
  } else {
    hullDmg += dmg;
  }

  defender.hull = Math.max(0, defender.hull - hullDmg);

  // 统计累加
  const totalDmg = shieldDmg + hullDmg;
  attacker.damageDealt = (attacker.damageDealt || 0) + totalDmg;
  defender.damageTaken = (defender.damageTaken || 0) + totalDmg;
  defender.shieldAbsorbed = (defender.shieldAbsorbed || 0) + shieldDmg;

  let destroyed = false;
  if (defender.hull <= 0) {
    defender.alive = false;
    destroyed = true;
    attacker.kills = (attacker.kills || 0) + 1;
  }

  return {
    attacker, defender, hit: true, isCrit,
    dmg: totalDmg, shieldDmg, hullDmg, destroyed,
    msg: `${attacker.roleIcon || '🚀'}${attacker.name} 发动主炮齐射！${isCrit ? '💥【致命暴击】' : ''}击中 ${defender.name}，造成 ${totalDmg} 伤害（护盾偏转 ${shieldDmg}，装甲船损 ${hullDmg}）${destroyed ? '💥【目标发生灾难性殉爆，已被摧毁！】' : ''}`
  };
}

/**
 * 推进战斗一轮或一秒
 */
export function tickBattle(session, dt = 1.0) {
  if (session.ended) return session;

  session.timeSec += dt;

  // 1. 战术能量与指令冷却刷新
  session.energy = Math.min(session.energyMax, session.energy + session.energyRegen * dt);
  for (const cmd in session.cooldowns) {
    if (session.cooldowns[cmd] > 0) {
      session.cooldowns[cmd] = Math.max(0, session.cooldowns[cmd] - dt);
    }
  }
  for (const b in session.activeBuffs) {
    if (session.activeBuffs[b] > 0) {
      session.activeBuffs[b] = Math.max(0, session.activeBuffs[b] - dt);
    }
  }

  // 2. 存活战舰护盾微量充能（处于无人机压制下护盾无法回复）
  const alivePlayer = session.playerShips.filter((s) => s.alive);
  const aliveEnemy = session.enemyShips.filter((s) => s.alive);

  for (const s of alivePlayer) {
    if (s.shield < s.shieldMax) s.shield = Math.min(s.shieldMax, s.shield + s.shieldRegen * dt);
  }
  // 敌舰只有在无人机未压制时回盾
  if (session.activeBuffs.droneActive <= 0) {
    for (const s of aliveEnemy) {
      if (s.shield < s.shieldMax) s.shield = Math.min(s.shieldMax, s.shield + s.shieldRegen * dt);
    }
  }

  // 3. 蜂群无人机持续对敌扫射
  if (session.activeBuffs.droneActive > 0 && aliveEnemy.length > 0) {
    const target = aliveEnemy[Math.floor(Math.random() * aliveEnemy.length)];
    const droneDmg = Math.round(18 + Math.random() * 18);
    target.hull = Math.max(0, target.hull - droneDmg);
    if (target.hull <= 0) target.alive = false;
    session.logs.unshift({
      text: `🛰️ 友军无人机蜂群对 ${target.name} 实施超低空掠地撕扯，造成 ${droneDmg} 装甲结构损伤！`,
      type: 'drone'
    });
  }

  // 4. 双方自动交火射击
  // 己方舰艇攻击（优先指定集火目标）
  for (const p of alivePlayer) {
    const targets = session.enemyShips.filter((s) => s.alive);
    if (!targets.length) break;

    // 若有玩家指定的集火目标且存活，则优先攻击
    let target = null;
    if (session.designatedTargetId) {
      target = targets.find((t) => t.id === session.designatedTargetId);
    }
    if (!target) {
      // 否则优先攻击最残血目标或随机
      target = targets[Math.floor(Math.random() * targets.length)];
    }

    const res = fireShip(p, target, session.activeBuffs);
    if (res) {
      session.logs.unshift({ text: res.msg, type: res.isCrit ? 'crit' : 'fire' });
    }
  }

  // 敌方舰艇反击
  for (const e of aliveEnemy) {
    const targets = session.playerShips.filter((s) => s.alive);
    if (!targets.length) break;
    const target = targets[Math.floor(Math.random() * targets.length)];
    const res = fireShip(e, target, session.activeBuffs);
    if (res) {
      session.logs.unshift({ text: res.msg, type: res.paralyzed ? 'emp' : 'enemy-fire' });
    }
  }

  // 限制日志条数
  if (session.logs.length > 60) session.logs.length = 60;

  // 5. 胜负终局裁决
  const pCount = session.playerShips.filter((s) => s.alive).length;
  const eCount = session.enemyShips.filter((s) => s.alive).length;

  if (eCount === 0 && pCount > 0) {
    session.ended = true;
    session.winner = 'player';
    session.logs.unshift({ text: '🏆 战斗大捷！敌对舰队全军覆没，交火空域已肃清！', type: 'win' });
  } else if (pCount === 0 && eCount > 0) {
    session.ended = true;
    session.winner = 'enemy';
    session.logs.unshift({ text: '⚠️ 编队全损或失去战力，被迫脱离接触紧急撤退！', type: 'loss' });
  } else if (pCount === 0 && eCount === 0) {
    session.ended = true;
    session.winner = 'draw';
    session.logs.unshift({ text: '双方战损严重，均已脱离战场。', type: 'draw' });
  }

  return session;
}

/**
 * 玩家释放战术指令技能
 */
export function executeTacticalCommand(session, cmdId) {
  if (session.ended) return { ok: false, reason: '战斗已结束' };
  const cmd = TACTICAL_COMMANDS[cmdId];
  if (!cmd) return { ok: false, reason: '未知的战术指令' };

  if (session.cooldowns[cmdId] > 0) {
    return { ok: false, reason: `指令冷却中，还需等待 ${session.cooldowns[cmdId].toFixed(1)} 秒` };
  }
  if (session.energy < cmd.costEnergy) {
    return { ok: false, reason: `战术能量不足（需要 ${cmd.costEnergy}，当前 ${Math.floor(session.energy)}）` };
  }

  session.energy -= cmd.costEnergy;
  session.cooldowns[cmdId] = cmd.cooldown;

  const aliveEnemy = session.enemyShips.filter((s) => s.alive);
  const alivePlayer = session.playerShips.filter((s) => s.alive);

  switch (cmdId) {
    case 'focus': {
      session.activeBuffs.focusActive = 6.0; // 持续 6 秒
      session.logs.unshift({ text: '🎯【战术激活】指挥官下达【全舰主炮集火】！全舰暴击率大幅跃升至 65%！', type: 'skill' });
      break;
    }
    case 'shield': {
      session.activeBuffs.shieldBuff = 4.0;
      for (const s of alivePlayer) {
        s.shield = Math.min(s.shieldMax, s.shield + Math.round(s.shieldMax * 0.45));
      }
      session.logs.unshift({ text: '🛡️【战术激活】等离子偏转护盾已紧急过载充能！全编队获得 50% 伤害减免！', type: 'skill' });
      break;
    }
    case 'torpedo': {
      if (aliveEnemy.length > 0) {
        // 优先攻击玩家手动指定的敌舰，否则攻击最前方的敌舰
        const target = (session.designatedTargetId && aliveEnemy.find((t) => t.id === session.designatedTargetId)) || aliveEnemy[0];
        const torpDmg = Math.round(110 + Math.random() * 90);
        target.hull = Math.max(0, target.hull - torpDmg);
        let killed = false;
        if (target.hull <= 0) {
          target.alive = false;
          killed = true;
        }
        session.logs.unshift({
          text: `🚀【战术激活】重型反舰高爆鱼雷直接穿透 ${target.name} 装甲，重创 ${torpDmg} 船体！${killed ? '💥目标爆炸解体！' : ''}`,
          type: 'skill'
        });
      }
      break;
    }
    case 'drones': {
      session.activeBuffs.droneActive = 8.0;
      session.logs.unshift({ text: '🛰️【战术激活】无人战斗机群全数弹射离舱，展开全域机动压制，阻断敌方护盾恢复！', type: 'skill' });
      break;
    }
    case 'emp': {
      session.activeBuffs.empParalyze = 3.0;
      for (const e of aliveEnemy) {
        e.shield = Math.max(0, Math.round(e.shield * 0.65));
      }
      session.logs.unshift({ text: '⚡【战术激活】高能电磁脉冲（EMP）引爆！烧毁敌全员 35% 护盾，并致盲瘫痪敌舰 3 秒！', type: 'skill' });
      break;
    }
    case 'boarding': {
      if (aliveEnemy.length > 0) {
        // 挑选敌方当前最强单位执行跳帮突击
        const sorted = aliveEnemy.slice().sort((a, b) => (b.hull + b.shield) - (a.hull + a.shield));
        const target = sorted[0];
        const boardDmg = Math.round(150 + Math.random() * 100);
        target.hull = Math.max(0, target.hull - boardDmg);
        let killed = false;
        if (target.hull <= 0) {
          target.alive = false;
          killed = true;
        }
        session.logs.unshift({
          text: `🪂【战术激活】轨道空降突击队完成强行跳帮！渗透突入 ${target.name}，引爆动力室并重创 ${boardDmg} 点装甲结构！${killed ? '💥敌舰已被彻底瘫痪！' : ''}`,
          type: 'skill'
        });
      }
      break;
    }
    case 'warp': {
      session.activeBuffs.warpActive = 5.0;
      session.logs.unshift({ text: '🌌【战术激活】紧急跃迁与矢量回避启动！全舰队闪避大幅提升至 80%！', type: 'skill' });
      break;
    }
    case 'orbital_bombard': {
      if (aliveEnemy.length > 0) {
        let totalBombDmg = 0;
        let killedCount = 0;
        for (const e of aliveEnemy) {
          const dmg = Math.round(90 + Math.random() * 70);
          e.hull = Math.max(0, e.hull - dmg);
          totalBombDmg += dmg;
          if (e.hull <= 0) {
            e.alive = false;
            killedCount++;
          }
        }
        session.logs.unshift({
          text: `☄️【战术激活】轨道战备舰队下达【天基湮灭轰炸】！高能等离子流地毯式倾泻，对敌方全舰队造成 ${totalBombDmg} 点毁灭性面杀伤！${killedCount > 0 ? `💥当场击沉 ${killedCount} 艘敌舰！` : ''}`,
          type: 'skill'
        });
      }
      break;
    }
    case 'overclock_repair': {
      let totalHealed = 0;
      for (const p of alivePlayer) {
        const heal = Math.round(p.hullMax * 0.35);
        p.hull = Math.min(p.hullMax, p.hull + heal);
        totalHealed += heal;
      }
      session.logs.unshift({
        text: `🔧【战术激活】纳米战地工程机械虫群全域部署！战地修复完成，为我方各战舰共计抢修抢固 ${totalHealed} 点装甲船体结构！`,
        type: 'skill'
      });
      break;
    }
  }

  return { ok: true, msg: `指令「${cmd.name}」已下达！` };
}

/**
 * 获取战斗结算详细评估战报（包含 MVP 战舰与评级）
 */
export function getBattleReport(session) {
  let mvp = session.playerShips[0] || null;
  for (const s of session.playerShips) {
    if ((s.damageDealt || 0) > ((mvp && mvp.damageDealt) || 0)) {
      mvp = s;
    }
  }
  const playerDmg = session.playerShips.reduce((acc, s) => acc + (s.damageDealt || 0), 0);
  const enemyKilled = session.enemyShips.filter((s) => !s.alive).length;
  const playerLost = session.playerShips.filter((s) => !s.alive).length;

  let rank = 'B';
  if (session.winner === 'player') {
    if (playerLost === 0) rank = 'S';
    else if (playerLost <= 1) rank = 'A';
    else rank = 'B';
  } else {
    rank = enemyKilled > 0 ? 'C' : 'D';
  }

  return {
    winner: session.winner,
    rank,
    mvp,
    playerDmg,
    enemyKilled,
    playerLost,
    timeSec: Math.floor(session.timeSec),
  };
}
