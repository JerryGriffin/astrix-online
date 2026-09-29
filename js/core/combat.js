// 星际舰队战术交战模拟引擎（Astrix v0.2.0）
// 负责舰队对战的回合/实时推演、护盾与装甲吸收、战术指令冷却与结算。
// 纯原生 ES 模块，无任何外部构建依赖。

import { fmtNum } from './format.js?v=20.0';

let _combatSeq = 0;
function genShipUid() {
  _combatSeq = (_combatSeq + 1) % 100000;
  return 'cship_' + Date.now().toString(36) + '_' + _combatSeq;
}

/**
 * 将一艘基础飞船转换为战斗单元数据结构
 */
export function toCombatShip(ship, side = 'player') {
  const name = ship.name || ship.className || (side === 'player' ? '己方战舰' : '敌方主力舰');
  const type = ship.type || ship.className || '护卫舰';
  const dryMass = Number(ship.dryMass) || 300;
  const thrust = Number(ship.thrust) || 200;
  const stats = ship.stats || {};

  // 基础战力推导属性
  const maxHull = Math.max(100, Math.round(dryMass * 1.5 + (stats.mass || 100)));
  const maxShield = Math.max(80, Math.round(thrust * 1.2));
  const baseAtk = Math.max(15, Math.round((thrust * 0.35 + dryMass * 0.15)));
  const speed = Math.max(10, Math.min(60, Math.round(thrust / (dryMass * 0.05 + 1))));

  return {
    id: ship.id || genShipUid(),
    name,
    type,
    side, // 'player' | 'enemy'
    hull: maxHull,
    hullMax: maxHull,
    shield: maxShield,
    shieldMax: maxShield,
    shieldRegen: Math.max(2, Math.round(maxShield * 0.04)), // 每秒/回合回盾
    atk: baseAtk,
    speed,
    critRate: 0.12,
    critMul: 1.8,
    alive: true,
    targetId: null,
    cooldowns: {
      focus: 0,
      shield: 0,
      torpedo: 0,
      drones: 0,
      warp: 0,
    },
  };
}

/**
 * 战术指令配置列表
 */
export const TACTICAL_COMMANDS = {
  focus: {
    id: 'focus',
    name: '主炮集火',
    icon: '🎯',
    costEnergy: 25,
    cooldown: 8,
    desc: '锁定敌核心目标集中轰击，暴击率提升至 60%，攻击破甲伤害大幅提升！',
  },
  shield: {
    id: 'shield',
    name: '护盾过载',
    icon: '🛡️',
    costEnergy: 30,
    cooldown: 12,
    desc: '瞬间向护盾偏转线圈注入等离子能量，恢复 40% 护盾并降低 50% 所受伤害！',
  },
  torpedo: {
    id: 'torpedo',
    name: '反舰鱼雷',
    icon: '🚀',
    costEnergy: 35,
    cooldown: 10,
    desc: '发射穿甲高爆磁轨鱼雷，无视敌方护盾偏转，直接重创敌舰装甲船体！',
  },
  drones: {
    id: 'drones',
    name: '蜂群无人机',
    icon: '🛰️',
    costEnergy: 20,
    cooldown: 6,
    desc: '弹射全自动战术无人机编队，持续对敌骚扰射击并拦截敌来袭导弹！',
  },
  warp: {
    id: 'warp',
    name: '紧急跃迁',
    icon: '🌌',
    costEnergy: 40,
    cooldown: 15,
    desc: '启动曲率跃迁引擎紧急拉脱，使全舰队闪避提升至 80% 或战术脱离！',
  },
};

/**
 * 初始化一场战斗会话
 */
export function createBattleSession(playerFleetShips = [], enemyShips = [], options = {}) {
  const pShips = playerFleetShips.map((s) => toCombatShip(s, 'player'));
  const eShips = enemyShips.map((s) => toCombatShip(s, 'enemy'));

  if (pShips.length === 0) {
    pShips.push(toCombatShip({ name: '先锋突击舰·刺猬号', dryMass: 400, thrust: 350 }, 'player'));
  }
  if (eShips.length === 0) {
    eShips.push(toCombatShip({ name: '星盗掠夺舰', dryMass: 380, thrust: 300 }, 'enemy'));
    eShips.push(toCombatShip({ name: '哨戒突击艇', dryMass: 200, thrust: 220 }, 'enemy'));
  }

  return {
    id: 'battle_' + Date.now().toString(36),
    title: options.title || '深空遭遇战',
    playerShips: pShips,
    enemyShips: eShips,
    round: 1,
    timeSec: 0,
    energy: 50,
    energyMax: 100,
    energyRegen: 5, // 每秒回能
    activeBuffs: {
      focusActive: 0,
      shieldBuff: 0,
      warpActive: 0,
      droneActive: 0,
    },
    logs: [
      { text: `战备警报！舰队已切入交火航线，战场雷达已捕获 ${eShips.length} 艘敌对舰艇！`, type: 'info' }
    ],
    ended: false,
    winner: null, // 'player' | 'enemy' | 'draw'
    cooldowns: {
      focus: 0,
      shield: 0,
      torpedo: 0,
      drones: 0,
      warp: 0,
    },
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

  // 闪避计算（受速度比影响）
  let dodgeChance = Math.max(0.05, Math.min(0.75, (defender.speed - attacker.speed) * 0.015));
  if (defender.side === 'player' && isWarp) dodgeChance = 0.8;
  const isDodge = Math.random() < dodgeChance;

  if (isDodge) {
    return {
      attacker, defender, hit: false, dodge: true,
      msg: `${attacker.name} 锁定开火，但被 ${defender.name} 依靠机动战术规避闪过！`
    };
  }

  // 暴击判定
  const critRate = isFocus && attacker.side === 'player' ? 0.6 : attacker.critRate;
  const isCrit = Math.random() < critRate;
  let dmg = attacker.atk * (0.85 + Math.random() * 0.3);
  if (isCrit) dmg *= attacker.critMul;

  if (defender.side === 'player' && isShieldBuff) {
    dmg *= 0.5; // 护盾过载伤害减免
  }
  dmg = Math.round(dmg);

  // 护盾吸收
  let shieldDmg = 0;
  let hullDmg = 0;
  if (defender.shield > 0) {
    if (defender.shield >= dmg) {
      defender.shield -= dmg;
      shieldDmg = dmg;
    } else {
      shieldDmg = defender.shield;
      hullDmg = dmg - defender.shield;
      defender.shield = 0;
      defender.hull = Math.max(0, defender.hull - hullDmg);
    }
  } else {
    hullDmg = dmg;
    defender.hull = Math.max(0, defender.hull - hullDmg);
  }

  let destroyed = false;
  if (defender.hull <= 0) {
    defender.alive = false;
    destroyed = true;
  }

  return {
    attacker, defender, hit: true, isCrit,
    dmg, shieldDmg, hullDmg, destroyed,
    msg: `${attacker.name} 发动主炮齐射！${isCrit ? '💥【致命暴击】' : ''}击中 ${defender.name}，造成 ${dmg} 伤害（护盾偏转 ${shieldDmg}，装甲船损 ${hullDmg}）${destroyed ? '💥【目标发生灾难性殉爆，已被摧毁！】' : ''}`
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

  // 2. 存活战舰护盾微量充能
  const alivePlayer = session.playerShips.filter((s) => s.alive);
  const aliveEnemy = session.enemyShips.filter((s) => s.alive);

  for (const s of alivePlayer) {
    if (s.shield < s.shieldMax) s.shield = Math.min(s.shieldMax, s.shield + s.shieldRegen * dt);
  }
  for (const s of aliveEnemy) {
    if (s.shield < s.shieldMax) s.shield = Math.min(s.shieldMax, s.shield + s.shieldRegen * dt);
  }

  // 3. 蜂群无人机持续伤害
  if (session.activeBuffs.droneActive > 0 && aliveEnemy.length > 0) {
    const target = aliveEnemy[Math.floor(Math.random() * aliveEnemy.length)];
    const droneDmg = Math.round(15 + Math.random() * 15);
    target.hull = Math.max(0, target.hull - droneDmg);
    if (target.hull <= 0) target.alive = false;
    session.logs.unshift({
      text: `🛰️ 友军无人机蜂群对 ${target.name} 实施俯冲扫射，造成 ${droneDmg} 结构损伤！`,
      type: 'drone'
    });
  }

  // 4. 双方自动交火射击
  // 己方舰艇随机/集中攻击敌舰
  for (const p of alivePlayer) {
    const targets = session.enemyShips.filter((s) => s.alive);
    if (!targets.length) break;
    const target = targets[Math.floor(Math.random() * targets.length)];
    const res = fireShip(p, target, session.activeBuffs);
    if (res) {
      session.logs.unshift({ text: res.msg, type: res.isCrit ? 'crit' : 'fire' });
    }
  }

  // 敌方舰艇反击
  for (const e of session.enemyShips.filter((s) => s.alive)) {
    const targets = session.playerShips.filter((s) => s.alive);
    if (!targets.length) break;
    const target = targets[Math.floor(Math.random() * targets.length)];
    const res = fireShip(e, target, session.activeBuffs);
    if (res) {
      session.logs.unshift({ text: res.msg, type: 'enemy-fire' });
    }
  }

  // 限制日志条数
  if (session.logs.length > 50) session.logs.length = 50;

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
      session.logs.unshift({ text: '⚡【指令激活】指挥官下达【全舰主炮集火】！全舰暴击率大幅跃升！', type: 'skill' });
      break;
    }
    case 'shield': {
      session.activeBuffs.shieldBuff = 4.0;
      for (const s of alivePlayer) {
        s.shield = Math.min(s.shieldMax, s.shield + Math.round(s.shieldMax * 0.4));
      }
      session.logs.unshift({ text: '🛡️【指令激活】等离子偏转护盾已紧急过载充能！全编队获得伤害减免！', type: 'skill' });
      break;
    }
    case 'torpedo': {
      if (aliveEnemy.length > 0) {
        const target = aliveEnemy[0];
        const torpDmg = Math.round(80 + Math.random() * 80);
        target.hull = Math.max(0, target.hull - torpDmg);
        let killed = false;
        if (target.hull <= 0) {
          target.alive = false;
          killed = true;
        }
        session.logs.unshift({
          text: `🚀【指令激活】重型反舰高爆鱼雷直接穿透 ${target.name} 装甲，重创 ${torpDmg} 船体！${killed ? '💥目标爆炸解体！' : ''}`,
          type: 'skill'
        });
      }
      break;
    }
    case 'drones': {
      session.activeBuffs.droneActive = 8.0;
      session.logs.unshift({ text: '🛰️【指令激活】无人战斗机群全数弹射离舱，在敌编队上空展开密集交织打击！', type: 'skill' });
      break;
    }
    case 'warp': {
      session.activeBuffs.warpActive = 5.0;
      session.logs.unshift({ text: '🌌【指令激活】紧急跃迁与矢量回避启动！全舰大幅提高闪避机动！', type: 'skill' });
      break;
    }
  }

  return { ok: true, msg: `指令「${cmd.name}」已下达！` };
}
