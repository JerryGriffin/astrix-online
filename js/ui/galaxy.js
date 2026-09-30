// 星际页（Astrix v0.2.1）—— 云服务跨玩家
// 造出船坞 + 在线模式后开放。登录云账号（邮箱）后：
//   * 自动把自己的殖民地快照发布到星系 registry（galaxy_planets，公开读 / 本人写）
//   * 浏览其他玩家的星球，发起 贸易（trade_offer）或 进攻（attack）
//   * 收件箱（galaxy_incidents 异步邮箱）：对方上线后本地结算，
//     回执（battle_report / trade_result）作为新事件发回进攻/贸易发起方
// 跨玩家写不可能（RLS owner 隔离），全部交互走「事件邮箱 + 双端确定性结算」模型。
//
// v0.2.1 变化：
//   · 在线模式「星球选择」合并进本页 —— 顶部「我的殖民地」区块内嵌殖民地管理（含内联报告），
//     不再有独立的「星球选择」tab；离线模式仍保留独立的「星球选择」。
//   · UI 升级：顶部状态栏（指挥官 / 邮箱 / 防御战力 / 收件箱未读徽标 / 发布 / 退出）、
//     搜索栏、其他玩家星球的玻璃卡片网格（势力标签 / 防御战力着色 / 战略简报 / 特产标签）。

import {
  ensureReady, cloudStatus, cloudUser,
  signInWithPassword, signUpWithPassword, astrixEmailOf, signOutCloud,
  listPublicPlanets, publishMyPlanet, postIncident, fetchInbox, markIncidentResolved,
} from '../core/cloud.js?v=20.16';
import { currentAccount, getPlanetInstance, ownedOf, spendOwned } from '../core/state.js?v=20.16';
import { ensureEntry } from '../core/production.js?v=20.16';
import { listFleets, fleetPowerOf, defenseBonusOf } from '../core/fleet.js?v=20.16';
import { totalArmyPowerOf, listArmies, disbandArmy, resolveBattle } from '../core/army.js?v=20.16';
// v0.2.1：内嵌殖民地管理（含内联报告），取代在线模式独立的「星球选择」tab
import { renderColony } from './colony.js?v=20.16';
import { PLANETS } from '../data/planets.js?v=20.16';
import { fmtNum } from '../core/format.js?v=20.16';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}

function ascoinOf(acc) { return Math.floor(Number(acc && acc.ascoin) || 0); }

/** 我的防御总战力：全部舰队战力 + 全部军队战力 + 驻防加成 */
function myDefensePower(acc) {
  let ships = 0;
  for (const f of listFleets(acc)) ships += fleetPowerOf(acc, f);
  return ships + totalArmyPowerOf(acc) + defenseBonusOf(acc) * 10;
}

/** 把货单加进某星球物品栏（贸易收货 / 退货用） */
function addGoods(inst, goods) {
  const moved = {};
  for (const mat in (goods || {})) {
    const qty = Math.floor(Number(goods[mat]) || 0);
    if (!(qty > 0)) continue;
    const e = ensureEntry(inst, mat, 'refined');
    if (e) { e.owned = (Number(e.owned) || 0) + qty; moved[mat] = qty; }
  }
  return moved;
}

function goodsText(goods) {
  return Object.keys(goods || {}).map((m) => m + ' ×' + fmtNum(goods[m])).join('、') || '（无）';
}

// 快照发布节流（60s）
let _lastPublish = 0;

/** 构造并静默/手动发布我的殖民地快照 */
function buildSnapshot(acc, ctx) {
  const code = ctx.planetCode || (acc && acc.homePlanetCode) || 'syl';
  const inst = getPlanetInstance(code);
  const p = PLANETS.find((x) => x.code === code);
  // v0.2.10：在线模式星球编号全局唯一 —— 追加账号短码（交互按 owner_id，编号仅展示）
  const u = cloudUser();
  const tag = (u && u.id) ? String(u.id).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase() : '';
  return {
    ownerName: (acc && acc.name) || '深空旅人',
    planetCode: code + (tag ? '-' + tag : ''),
    planetNameCn: (p && p.nameCn) || '母星',
    faction: '殖民者',
    summary: {
      pop: Math.round((inst && inst.pop && inst.pop.total) || 0),
      buildings: Object.values((inst && inst.buildings) || {}).reduce((s, n) => s + (Number(n) || 0), 0),
      defense: myDefensePower(acc),
      armies: (acc && Array.isArray(acc.armies) ? acc.armies.length : 0),
      ships: (acc && Array.isArray(acc.ships) ? acc.ships.length : 0),
      happiness: Math.round(((inst && inst.pop && inst.pop.happiness) || 0) * 100),
    },
  };
}

export function renderGalaxy(root, ctx) {
  ctx = ctx || {};
  const acc = ctx.account || currentAccount();
  root.innerHTML = '';
  root.appendChild(el('div', 'page-title', '星际'));

  const statusEl = el('div', 'galaxy-status');
  root.appendChild(statusEl);
  const body = el('div', 'galaxy-body');
  root.appendChild(body);

  // ---- 首屏：连接云服务 ----
  statusEl.textContent = '连接云服务…';
  ensureReady().then((ok) => {
    // 守卫：SDK 懒加载可能耗时数秒，期间玩家可能已切到别的 tab（planet.js 复用
    // 同一个 contentInner）。页面标记不在了就放弃回写，避免污染其它 tab。
    const title = root.querySelector && root.querySelector('.page-title');
    if (!title || title.textContent !== '星际') return;
    statusEl.innerHTML = '';
    if (!ok) {
      statusEl.appendChild(el('span', 'army-miss', '云服务不可用：' + (cloudStatus().error || '网络异常')
        + '（离线模式不受影响）'));
      return;
    }
    renderShell(body, ctx, () => renderGalaxy(root, ctx));
  });
}

// ============================================================================
// 主体外壳：顶部状态栏 + 搜索栏 + 我的殖民地 + 收件箱 + 玩家星球网格
// ============================================================================
function renderShell(body, ctx, rerender) {
  const acc = ctx.account || currentAccount();
  ensureAllianceFields(acc);   // v0.2.10 结盟字段兜底
  const u = cloudUser();
  const myName = u ? (((u.email || '').split('@')[0]) || u.id) : '';   // v0.2.10：显示账号名而非邮箱
  body.innerHTML = '';

  // ---- 1. 顶部状态栏 ----
  const header = el('div', 'gx-header glass');
  const idBox = el('div', 'gx-id');
  const callsign = el('div', 'gx-callsign');
  callsign.appendChild(el('span', null, (acc && acc.name) || '深空旅人'));
  if (u) callsign.appendChild(el('span', 'gx-tag', '账号：' + myName));
  idBox.appendChild(callsign);
  idBox.appendChild(el('div', 'gx-email' + (u ? '' : ' unbound'),
    u ? ('账号 ' + myName) : '未登录（无法查看其他玩家星球）'));
  header.appendChild(idBox);

  const actions = el('div', 'gx-actions');
  // v0.2.10 修复：el() 的第三参是文本，传数组会渲染成 [object HTMLSpanElement]
  const defStat = el('div', 'gx-stat');
  defStat.append(el('span', 'gx-stat-k', '我的防御战力'), el('span', 'gx-stat-v', fmtNum(myDefensePower(acc))));
  actions.appendChild(defStat);

  const inboxBtn = el('button', 'btn btn-sm', '收件箱');
  inboxBtn.addEventListener('click', () => openInboxModal(ctx, rerender));
  actions.appendChild(inboxBtn);

  if (u) {
    const pubBtn = el('button', 'btn btn-sm btn-primary', '发布快照');
    pubBtn.addEventListener('click', async () => {
      pubBtn.disabled = true;
      const r = await publishMyPlanet(buildSnapshot(acc, ctx));
      pubBtn.disabled = false;
      pubBtn.textContent = r.ok ? '已发布 ✓' : '发布失败';
      setTimeout(() => { pubBtn.textContent = '发布快照'; }, 1500);
    });
    actions.appendChild(pubBtn);

    const outBtn = el('button', 'btn btn-sm', '退出');
    outBtn.addEventListener('click', async () => { await signOutCloud(); rerender(); });
    actions.appendChild(outBtn);
  } else {
    const loginBtn = el('button', 'btn btn-sm btn-primary', '登录 / 注册');
    loginBtn.addEventListener('click', () => openLoginModal(ctx, rerender));
    actions.appendChild(loginBtn);
  }
  header.appendChild(actions);
  body.appendChild(header);

  // ---- 2. 搜索栏（过滤玩家 / 电脑势力星球网格）----
  let query = '';
  const npcGrid = el('div', 'gx-grid');
  const searchWrap = el('div', 'gx-search');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = '搜索玩家星球 / 指挥官 / 星球代号…';
  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim().toLowerCase();
    renderNpcGrid(npcGrid, ctx, rerender, acc, query);
    renderPlanetGrid(planetGrid, ctx, rerender, u, acc, query);
  });
  searchWrap.appendChild(searchInput);
  body.appendChild(searchWrap);

  // ---- 3. 我的殖民地（内嵌殖民地管理 + 内联报告，取代在线模式独立「星球选择」）----
  const colSec = el('div', 'gx-section');
  colSec.appendChild(el('div', 'section-title', '我的殖民地'));
  const colBox = el('div', 'gx-colony');
  colSec.appendChild(colBox);
  body.appendChild(colSec);
  renderColony(colBox, {
    openModal: ctx.openModal, closeModal: ctx.closeModal,
    planetCode: ctx.planetCode, account: acc,
    // v0.2.1：点「进入」切到该星球（透传 planet.js 的真实路由）
    onEnterPlanet: (code) => {
      if (code && code !== ctx.planetCode && typeof ctx.onEnterPlanet === 'function') ctx.onEnterPlanet(code);
    },
  });

  // ---- 3.5 电脑势力星球（v0.2.10：独立区块 + 同步渲染，不依赖云端请求，永远可见）----
  const npcSec = el('div', 'gx-section');
  npcSec.appendChild(el('div', 'section-title', '电脑势力星球'));
  npcSec.appendChild(el('div', 'muted', '即时交易 / 进攻 / 结盟（盟友购买价 9 折、互不侵犯）。'));
  npcGrid.id = 'gx-npc-grid';
  npcSec.appendChild(npcGrid);
  body.appendChild(npcSec);
  renderNpcGrid(npcGrid, ctx, rerender, acc, '');

  // ---- 4. 我的殖民地快照说明 / 收件箱 / 玩家星球网格 ----
  const snapNote = el('div', 'muted', '说明：进入本页会自动把你的殖民地概况（人口 / 建筑 / 防御）'
    + '发布到星系，供其他旅行者查看；点「发布快照」可手动刷新。每颗殖民地的报告见上方对应星球行。');
  body.appendChild(snapNote);

  const inboxSec = el('div', 'gx-section');
  inboxSec.appendChild(el('div', 'section-title', '收件箱（贸易要约 / 进攻 / 回执）'));
  body.appendChild(inboxSec);

  const planetsSec = el('div', 'gx-section');
  planetsSec.appendChild(el('div', 'section-title', '已知玩家星球'));
  const planetGrid = el('div', 'gx-grid');
  planetsSec.appendChild(planetGrid);
  body.appendChild(planetsSec);

  if (!u) {
    inboxSec.appendChild(el('div', 'muted', '登录后可见贸易 / 进攻事件与对其他玩家星球的操作。'));
    renderPlanetGrid(planetGrid, ctx, rerender, null, acc, '');
    return;
  }

  // 收取件箱（含未读计数 → 顶栏徽标）+ 拉玩家星球网格
  fetchInbox().then((r) => {
    const title = body.querySelector && body.querySelector('.page-title');
    if (!title) return;
    if (r.ok) {
      renderInbox(inboxSec, ctx, rerender, r.items, acc);
      const unread = r.items.filter((it) => !it.resolved).length;
      if (unread > 0) inboxBtn.innerHTML = '收件箱<span class="gx-badge">' + unread + '</span>';
    } else {
      inboxSec.appendChild(el('div', 'muted', '收件箱读取失败：' + (r.reason || '')));
    }
    renderPlanetGrid(planetGrid, ctx, rerender, u, acc, query);
  });

  // 进入本页即静默发布（60s 节流）
  const now = Date.now();
  if (now - _lastPublish > 60000) {
    _lastPublish = now;
    publishMyPlanet(buildSnapshot(acc, ctx));
  }
}

// ============================================================================
// 认证：登录 / 注册模态
// ============================================================================
function openLoginModal(ctx, rerender) {
  const openModal = ctx.openModal;
  if (!openModal) return;
  const wrap = el('div');
  // v0.2.10：账号名 + 密码登录 / 注册（不强制邮箱；账号名映射为合成邮箱）
  wrap.appendChild(el('div', 'section-title', '账号登录 / 注册'));
  const f1 = el('div', 'galaxy-form');
  const name1 = document.createElement('input');
  name1.type = 'text'; name1.placeholder = '账号名';
  const pw1 = document.createElement('input');
  pw1.type = 'password'; pw1.placeholder = '密码';
  const btn1 = el('button', 'btn btn-primary', '登录 / 注册');
  const msg1 = el('div', 'muted');
  btn1.addEventListener('click', async () => {
    const n = name1.value.trim();
    if (!n) { msg1.textContent = '请输入账号名。'; return; }
    if (!pw1.value || pw1.value.length < 4) { msg1.textContent = '密码至少 4 位。'; return; }
    msg1.textContent = '登录中…';
    const email = astrixEmailOf(n);
    let r = await signInWithPassword(email, pw1.value);
    if (!r.ok) {
      msg1.textContent = '账号不存在或密码错误，尝试注册…';
      const su = await signUpWithPassword(email, pw1.value);
      if (!su.ok) { msg1.textContent = '注册失败：' + (su.reason || '未知错误'); return; }
      r = await signInWithPassword(email, pw1.value);
      if (!r.ok) { msg1.textContent = '注册成功但登录失败：' + (r.reason || ''); return; }
    }
    msg1.textContent = '欢迎，' + n + '！';
    ctx.closeModal && ctx.closeModal();
    rerender();
  });
  f1.appendChild(name1); f1.appendChild(pw1); f1.appendChild(btn1);
  wrap.appendChild(f1); wrap.appendChild(msg1);
  openModal({ title: '云账号（账号名 + 密码）', body: wrap });
}

// ============================================================================
// 收件箱（弹窗 + 内联区块共用渲染）
// ============================================================================
const INCIDENT_LABEL = {
  attack: '进攻宣告',
  trade_offer: '贸易要约',
  battle_report: '战报回执',
  trade_result: '贸易结算',
  alliance_offer: '结盟请求',
  alliance_accept: '结盟回应',
  alliance_break: '解除盟约',
};

/** v0.2.10 结盟字段兜底（老存档）：npcAllies = 盟友电脑势力名；allies = [{uid, name}] */
function ensureAllianceFields(acc) {
  if (!acc) return;
  if (!Array.isArray(acc.npcAllies)) acc.npcAllies = [];
  if (!Array.isArray(acc.allies)) acc.allies = [];
}

function isPlayerAlly(acc, uid) {
  return !!(acc && Array.isArray(acc.allies) && uid && acc.allies.some((x) => x && x.uid === uid));
}

function isNpcAlly(acc, owner) {
  return !!(acc && Array.isArray(acc.npcAllies) && owner && acc.npcAllies.includes(owner));
}

/** v0.2.10：NPC 结盟诚意金 = 驻军战力 ×5（越强的势力越贵；解除免费） */
function npcAllyCost(f) {
  return Math.max(1000, Math.round((Number(f && f.defense) || 0) * 5));
}

function renderInbox(sec, ctx, rerender, items, acc) {
  if (!items.length) {
    sec.appendChild(el('div', 'muted', '暂无待处理事件。'));
    return;
  }
  for (const it of items) {
    const pay = it.payload || {};
    const card = el('div', 'galaxy-incident');
    card.appendChild(el('b', null, INCIDENT_LABEL[it.type] || it.type));
    card.appendChild(el('div', 'muted', '来自：' + (pay.fromName || it.owner_id) + ' · ' + new Date(it.created_at).toLocaleString()));

    const act = el('div', 'galaxy-incident-actions');

    if (it.type === 'attack') {
      card.appendChild(el('div', null, '敌方发起进攻宣告（'
        + ((pay.atkArmies && pay.atkArmies.length) ? pay.atkArmies.length + ' 支部队 · ' : '')
        + '总战力 ' + fmtNum(pay.atkPower || 0) + '）。我方以全部建制军队应战：'
        + '钢铁雄心式多回合交战 —— 组织度被打空的部队撤出战斗，战斗宽度每方 3 支，'
        + '回合耗尽进攻方撤退，败方承受战损。'));
      const btn = el('button', 'btn btn-sm btn-primary', '应战（本地结算）');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        // v0.2.2：以我方全部建制军队为守方单位会战（HOI4 式多回合确定性结算）
        const defUnits = listArmiesLocal(acc).map((a) => ({
          nameCn: a.nameCn || a.id, power: a.power,
          atk: a.stats ? a.stats.atk : 0, def: a.stats ? a.stats.def : 0,
        }));
        const res = resolveBattleSafe(pay.seed,
          pay.atkArmies || (Number(pay.atkPower) || 0), defUnits);
        // 守方损失：败了按比例解散军队；被攻破还被掠夺 ascoin
        let plunder = 0;
        const lostArmies = [];
        if (res.attackerWin) {
          plunder = Math.floor(ascoinOf(acc) * res.plunderRatio);
          acc.ascoin = ascoinOf(acc) - plunder;
          const armies = listArmiesLocal(acc);
          const nLose = Math.floor(armies.length * res.defLossRatio);
          for (let i = 0; i < nLose && armies.length; i++) {
            const a = armies.splice(Math.floor(Math.random() * armies.length), 1)[0];
            lostArmies.push(a.nameCn || a.id);
            removeArmyLocal(acc, a.id);
          }
        }
        await postIncident(it.owner_id, 'battle_report', {
          attackerWin: res.attackerWin,
          plunder,
          defLossRatio: res.defLossRatio,
          atkLossRatio: res.atkLossRatio,
          rounds: res.rounds,
          battleLog: (res.logLines || []).slice(0, 10),
          defName: (acc && acc.name) || '深空旅人',
          log: (res.logLines && res.logLines[0] ? res.logLines[0] + '；' : '')
            + (res.attackerWin
              ? ('守方损失军队 ' + (lostArmies.length ? lostArmies.join('、') : '无') + '，被掠夺 ' + plunder + ' Ascoin')
              : '进攻方被击退，未得手'),
        });
        await markIncidentResolved(it.id);
        if (ctx.openModal) {
          const body = document.createElement('div');
          body.style.whiteSpace = 'pre-line';
          body.textContent = res.log + '\n\n'
            + (res.attackerWin
              ? '我方战败：损失军队 ' + (lostArmies.length ? lostArmies.join('、') : '无')
                + '，被掠夺 ' + plunder + ' Ascoin。'
              : '我方成功防守，敌军被击退。');
          ctx.openModal({ title: '战斗结算（' + res.rounds + ' 回合）', body });
        }
        rerender();
      });
      act.appendChild(btn);
    } else if (it.type === 'trade_offer') {
      card.appendChild(el('div', null, '对方出货：' + goodsText(pay.goods) + '，要价 '
        + fmtNum(pay.askAscoin || 0) + ' Ascoin。'));
      const ok = el('button', 'btn btn-sm btn-primary', '接受');
      const no = el('button', 'btn btn-sm', '拒绝');
      ok.addEventListener('click', async () => {
        ok.disabled = true; no.disabled = true;
        const cost = Math.floor(Number(pay.askAscoin) || 0);
        if (ascoinOf(acc) < cost) {
          ok.disabled = false; no.disabled = false;
          ok.textContent = 'Ascoin 不足'; return;
        }
        acc.ascoin = ascoinOf(acc) - cost;
        const inst = getPlanetInstance(ctx.planetCode || (acc && acc.homePlanetCode) || 'syl');
        const got = addGoods(inst, pay.goods);
        await postIncident(it.owner_id, 'trade_result', { accepted: true, goods: pay.goods, askAscoin: cost });
        await markIncidentResolved(it.id);
        ctx.openModal && ctx.openModal({ title: '交易完成', body: '已支付 ' + fmtNum(cost)
          + ' Ascoin，收到：' + goodsText(got) + '（入当前星球物品栏）。' });
        rerender();
      });
      no.addEventListener('click', async () => {
        ok.disabled = true; no.disabled = true;
        await postIncident(it.owner_id, 'trade_result', { accepted: false, goods: pay.goods });
        await markIncidentResolved(it.id);
        rerender();
      });
      act.appendChild(ok); act.appendChild(no);
    } else if (it.type === 'battle_report') {
      card.appendChild(el('div', null, (pay.log || '')
        + '　（我方战损比 ' + Math.round((pay.atkLossRatio || 0) * 100) + '%）'));
      // v0.2.2：钢铁雄心式逐回合战报
      if (Array.isArray(pay.battleLog) && pay.battleLog.length) {
        const bl = el('div', 'muted');
        bl.style.whiteSpace = 'pre-line';
        bl.style.fontSize = '0.8rem';
        bl.style.padding = '4px 0';
        bl.textContent = pay.battleLog.join('\n');
        card.appendChild(bl);
      }
      if (pay.attackerWin) {
        // 我（进攻方）胜利：收掠夺款 + 按战损比解散军队
        const gain = Math.floor(Number(pay.plunder) || 0);
        acc.ascoin = ascoinOf(acc) + gain;
        const armies = listArmiesLocal(acc);
        const nLose = Math.floor(armies.length * (pay.atkLossRatio || 0));
        const lost = [];
        for (let i = 0; i < nLose && armies.length; i++) {
          const a = armies.splice(Math.floor(Math.random() * armies.length), 1)[0];
          lost.push(a.nameCn || a.id);
          removeArmyLocal(acc, a.id);
        }
        card.appendChild(el('div', null, '掠夺入账 ' + fmtNum(gain) + ' Ascoin'
          + (lost.length ? '；我方损失军队 ' + lost.join('、') : '；我方无建制损失')));
      } else {
        card.appendChild(el('div', null, '进攻未得手，军队无损失（败退）。'));
      }
      const seen = el('button', 'btn btn-sm', '已阅');
      seen.addEventListener('click', async () => { await markIncidentResolved(it.id); rerender(); });
      act.appendChild(seen);
    } else if (it.type === 'trade_result') {
      if (pay.accepted) {
        const gain = Math.floor(Number(pay.askAscoin) || 0);
        acc.ascoin = ascoinOf(acc) + gain;
        card.appendChild(el('div', null, '对方接受了要约，货款 ' + fmtNum(gain) + ' Ascoin 已入账。'));
      } else {
        const inst = getPlanetInstance(ctx.planetCode || (acc && acc.homePlanetCode) || 'syl');
        const back = addGoods(inst, pay.goods);
        card.appendChild(el('div', null, '对方拒绝了要约，货已退回物品栏：' + goodsText(back) + '。'));
      }
      const seen = el('button', 'btn btn-sm', '已阅');
      seen.addEventListener('click', async () => { await markIncidentResolved(it.id); rerender(); });
      act.appendChild(seen);
    } else if (it.type === 'alliance_offer') {
      card.appendChild(el('div', null, '请求与你结盟：结盟后互不侵犯。接受后双方进入盟友列表。'));
      const yes = el('button', 'btn btn-sm btn-primary', '接受');
      const no = el('button', 'btn btn-sm', '拒绝');
      yes.addEventListener('click', async () => {
        if (!Array.isArray(acc.allies)) acc.allies = [];
        if (!acc.allies.some((x) => x && x.uid === it.owner_id)) {
          acc.allies.push({ uid: it.owner_id, name: pay.fromName || '指挥官' });
        }
        try { await postIncident(it.owner_id, 'alliance_accept', { fromName: acc.name || '指挥官' }); } catch (e) { /* 忽略 */ }
        await markIncidentResolved(it.id);
        rerender();
      });
      no.addEventListener('click', async () => { await markIncidentResolved(it.id); rerender(); });
      act.append(yes, no);
    } else if (it.type === 'alliance_accept') {
      if (!Array.isArray(acc.allies)) acc.allies = [];
      if (it.owner_id && !acc.allies.some((x) => x && x.uid === it.owner_id)) {
        acc.allies.push({ uid: it.owner_id, name: pay.fromName || '指挥官' });
      }
      card.appendChild(el('div', null, '对方接受了结盟请求，你们现在是盟友了（互不侵犯）。'));
      const seen = el('button', 'btn btn-sm', '已阅');
      seen.addEventListener('click', async () => { await markIncidentResolved(it.id); rerender(); });
      act.appendChild(seen);
    } else if (it.type === 'alliance_break') {
      acc.allies = (acc.allies || []).filter((x) => x && x.uid !== it.owner_id);
      card.appendChild(el('div', null, '对方解除了盟约。'));
      const seen = el('button', 'btn btn-sm', '已阅');
      seen.addEventListener('click', async () => { await markIncidentResolved(it.id); rerender(); });
      act.appendChild(seen);
    }
    card.appendChild(act);
    sec.appendChild(card);
  }
}

function openInboxModal(ctx, rerender) {
  const openModal = ctx.openModal;
  if (!openModal) return;
  const div = el('div');
  div.style.cssText = 'max-height:60vh;overflow-y:auto;';
  div.appendChild(el('div', 'muted', '读取中…'));
  openModal({ title: '收件箱与回执', body: div });
  fetchInbox().then((r) => {
    div.innerHTML = '';
    if (!r.ok) { div.appendChild(el('div', 'muted', '读取失败：' + (r.reason || ''))); return; }
    if (!r.items.length) { div.appendChild(el('div', 'muted', '星际信箱空空如也，暂无最新战报或回执。')); return; }
    renderInbox(div, ctx, rerender, r.items, ctx.account || currentAccount());
  });
}

// army.js 的 listArmies / disbandArmy / resolveBattle 已并入顶部导入，这里仅做本地别名
function listArmiesLocal(acc) { return listArmies(acc); }
function removeArmyLocal(acc, id) { disbandArmy(acc, id); }
function resolveBattleSafe(seed, a, d) {
  try { return resolveBattle(seed, a, d); }
  catch (e) { return { attackerWin: a >= d, atkLossRatio: 0.3, defLossRatio: 0.3, plunderRatio: 0.1, log: '战斗结算（降级）' }; }
}

// ============================================================================
// 玩家星球：搜索过滤 + 玻璃卡片网格
// ============================================================================
// ============================================================================
// 电脑势力星球（v0.2.4：在线模式常驻 NPC —— 沿用离线 NPC 势力设定）
// ============================================================================
// 不走异步邮箱：NPC 在本地即时结算。交易价已含势力偏好（售价/收价不同）；
// 进攻按钢铁雄心式多回合对 NPC 驻军，胜利掠夺其金库。
const NPC_FACTIONS = [
  { id: 'npc_pioneer', owner: '开拓者', code: 'npc-forge', nameCn: '熔炉前哨',
    defense: 500, ascoin: 9000,
    sell: { '钢': [200, 60], '玻璃': [150, 30], '塑料': [120, 50] },
    buys: { '铁': 25, '铜': 40, '铝': 30 },
    desc: '拓荒者公会的前哨站：出售基础建材，收购金属原矿。' },
  { id: 'npc_guild', owner: '商会', code: 'npc-exchange', nameCn: '商队自由港',
    defense: 1200, ascoin: 30000,
    sell: { '钛合金': [40, 500], '石墨烯': [25, 1100] },
    buys: { '钢': 45, '陶瓷': 35, '玻璃': 22 },
    desc: '星系商会的自由港：高价出售合金材料，也高价回收精炼品。' },
  { id: 'npc_scrap', owner: '拾荒团', code: 'npc-junkyard', nameCn: '废铁拆解场',
    defense: 2200, ascoin: 16000,
    sell: { '钢': [400, 35], '陶瓷': [200, 25], '橡胶': [120, 40] },
    buys: { '铁': 20, '石头': 8, '石英': 15 },
    desc: '什么都能拆的拾荒团：什么都卖也什么都收，价格被压得很低；民风彪悍，防守不弱。' },
  { id: 'npc_royal', owner: 'Royal', code: 'npc-citadel', nameCn: '皇家堡垒',
    defense: 5200, ascoin: 90000,
    sell: { '纳米碳合金': [20, 1900], '钻石': [12, 1600], '钛合金': [60, 420] },
    buys: { '石墨烯': 850, '碳化钨': 300, '钛合金': 300 },
    desc: '大后期的皇家势力：防守森严（重防星），但最讲信用——贵族价收购稀有材料。' },
];

// NPC 会话内状态（库存/金库会因交互耗减；仅内存，刷新重置）
const _npcState = {};
function npcStateOf(f) {
  if (!_npcState[f.id]) {
    const stock = {};
    for (const m in (f.sell || {})) stock[m] = f.sell[m][0];
    _npcState[f.id] = { stock, ascoin: Number(f.ascoin) || 0 };
  }
  return _npcState[f.id];
}

/** NPC 驻军：3 支合成单位，总战力 ≈ defense（钢铁雄心式接战正好占满宽度） */
function npcGarrison(f) {
  const per = Math.max(1, Math.round((Number(f.defense) || 0) / 3));
  return [0, 1, 2].map((i) => ({
    nameCn: f.owner + '驻军 ' + (i + 1) + ' 队',
    power: per, atk: Math.round(per * 0.45), def: Math.round(per * 0.55),
  }));
}

/** 电脑势力星球网格（v0.2.10：独立同步渲染，不依赖云端） */
function renderNpcGrid(grid, ctx, rerender, acc, query) {
  ensureAllianceFields(acc);
  grid.innerHTML = '';
  const npcs = NPC_FACTIONS.filter((f) => !query
    || (f.nameCn + f.owner + f.code).toLowerCase().includes(query));
  for (const f of npcs) grid.appendChild(buildNpcCard(f, ctx, rerender, acc));
  if (!npcs.length) grid.appendChild(el('div', 'muted', '没有匹配「' + query + '」的电脑势力星球。'));
}

async function renderPlanetGrid(grid, ctx, rerender, u, acc, query) {
  ensureAllianceFields(acc);   // v0.2.10 结盟字段兜底
  grid.innerHTML = '';
  // v0.2.10：电脑势力星球已拆到独立区块（renderNpcGrid），此处只渲染玩家星球
  if (!u) {
    grid.appendChild(el('div', 'muted', '登录云账号后可与其他玩家贸易 / 结盟 / 交战；电脑势力星球在上方独立区块，随时交互。'));
    return;
  }
  grid.appendChild(el('div', 'muted', '读取星系中…'));
  const r = await listPublicPlanets();
  // 守卫：期间可能已切走/重渲染
  if (!grid.isConnected) return;
  grid.innerHTML = '';
  if (!r.ok) {
    grid.appendChild(el('div', 'army-miss', '读取失败：' + (r.reason || '')));
    return;
  }
  let others = r.planets.filter((p) => p.owner_id !== u.id);
  if (query) {
    others = others.filter((p) =>
      (('' + (p.planet_name_cn || p.planet_code)).toLowerCase().includes(query)) ||
      (('' + (p.owner_name || '')).toLowerCase().includes(query)) ||
      (('' + (p.planet_code || '')).toLowerCase().includes(query)));
  }
  if (!others.length) {
    grid.appendChild(el('div', 'muted', query ? '没有匹配「' + query + '」的星球。' : '星系里暂时只有你（或还没有其他玩家发布快照）。快照在对方登录并打开「星际」页后自动发布。'));
    return;
  }
  for (const p of others) grid.appendChild(buildPlanetCard(p, ctx, rerender, acc));
}

/** 单颗玩家星球卡片（玻璃卡片 + 势力标签 + 防御着色 + 战略简报 + 贸易/进攻）*/
function buildPlanetCard(p, ctx, rerender, acc) {
  const refresh = () => { if (typeof rerender === 'function') rerender(); };
  const s = p.summary || {};
  const defense = Number(s.defense || 0);
  const defCls = defense > 2500 ? 'def-high' : 'def-ok';

  const card = el('div', 'gx-card');
  const top = el('div', 'gx-card-top');

  const line1 = el('div', 'gx-card-line1');
  const nameWrap = el('div');
  nameWrap.appendChild(el('span', 'gx-card-name', p.planet_name_cn || p.planet_code || '未知星球'));
  if (p.planet_code) nameWrap.appendChild(el('span', 'gx-card-code', p.planet_code));
  line1.appendChild(nameWrap);
  line1.appendChild(el('span', 'gx-faction', p.faction || '—'));
  top.appendChild(line1);

  const info = el('div', 'gx-card-info');
  info.innerHTML =
    '<div>指挥官：<b>' + esc(p.owner_name || '未知') + '</b>'
    + (isPlayerAlly(acc, p.owner_id) ? ' <span style="color:#9FE1CB">🤝 盟友</span>' : '') + '</div>'
    + '<div>人口 <b>' + fmtNum(s.pop || 0) + '</b> · 建筑 <b>' + fmtNum(s.buildings || 0)
    + '</b> · 幸福度 <b>' + fmtNum(s.happiness || 0) + '%</b></div>'
    + '<div>军队 <b>' + fmtNum(s.armies || 0) + '</b> 支 · 舰队 <b>' + fmtNum(s.ships || 0)
    + '</b> 艘 · 在线 ' + new Date(p.last_seen).toLocaleDateString() + '</div>'
    + '<div>要塞战力：<b class="' + defCls + '">' + fmtNum(defense) + '</b></div>';
  top.appendChild(info);

  // 战略简报（依据公开字段合成）
  const intel = el('div', 'gx-intel');
  intel.textContent = '殖民地概况：人口 ' + fmtNum(s.pop || 0) + ' · 建筑 ' + fmtNum(s.buildings || 0)
    + ' · 军队 ' + fmtNum(s.armies || 0) + ' 支 · 防御战力 ' + fmtNum(defense)
    + (defense > 2500 ? '（重防星）' : '（可试探）');
  top.appendChild(intel);
  card.appendChild(top);

  const isAlly = isPlayerAlly(acc, p.owner_id);

  const act = el('div', 'gx-card-actions');
  const tradeBtn = el('button', 'btn btn-sm btn-primary', '贸易');
  tradeBtn.addEventListener('click', () => openTradeModal(ctx, rerender, acc, p, refresh));
  const allyBtn = el('button', 'btn btn-sm' + (isAlly ? '' : ' btn-ok'), isAlly ? '解除盟约' : '结盟');
  allyBtn.addEventListener('click', async () => {
    ensureAllianceFields(acc);
    if (isAlly) {
      acc.allies = acc.allies.filter((x) => x && x.uid !== p.owner_id);
      try { await postIncident(p.owner_id, 'alliance_break', { fromName: acc.name || '指挥官' }); } catch (e) { /* 忽略 */ }
      refresh();
      return;
    }
    allyBtn.disabled = true; allyBtn.textContent = '已发出…';
    try {
      const r = await postIncident(p.owner_id, 'alliance_offer', { fromName: acc.name || '指挥官', fromUid: (cloudUser() || {}).id || '' });
      if (!r.ok) { allyBtn.disabled = false; allyBtn.textContent = '结盟'; alert(r.reason || '发送失败'); return; }
      allyBtn.textContent = '已发出（等对方处理）';
    } catch (e) { allyBtn.disabled = false; allyBtn.textContent = '结盟'; }
  });
  const atkBtn = el('button', 'btn btn-sm btn-danger', '进攻');
  if (isAlly) { atkBtn.disabled = true; atkBtn.title = '盟友不可进攻（可先解除盟约）'; }
  else atkBtn.addEventListener('click', () => openAttackModal(ctx, rerender, acc, p, refresh));
  act.appendChild(tradeBtn);
  act.appendChild(allyBtn);
  act.appendChild(atkBtn);
  card.appendChild(act);
  return card;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ============================================================================
// 电脑势力卡片 + 即时交易 / 即时进攻（v0.2.4）
// ============================================================================
function buildNpcCard(f, ctx, rerender, acc) {
  ensureAllianceFields(acc);
  const st = npcStateOf(f);
  const allied = isNpcAlly(acc, f.owner);
  const refresh = () => { if (typeof rerender === 'function') rerender(); };
  const defCls = f.defense > 2500 ? 'def-high' : 'def-ok';
  const card = el('div', 'gx-card');
  const top = el('div', 'gx-card-top');
  const line1 = el('div', 'gx-card-line1');
  const nameWrap = el('div');
  nameWrap.appendChild(el('span', 'gx-card-name', f.nameCn));
  nameWrap.appendChild(el('span', 'gx-card-code', f.code));
  line1.appendChild(nameWrap);
  line1.appendChild(el('span', 'gx-faction', '🤖 ' + f.owner + ' · 电脑势力' + (allied ? ' · 🤝 盟友' : '')));
  top.appendChild(line1);
  const info = el('div', 'gx-card-info');
  info.innerHTML = '<div>驻军战力：<b class="' + defCls + '">' + fmtNum(f.defense) + '</b></div>'
    + '<div>金库 <b>' + fmtNum(st.ascoin) + '</b> Ascoin（战胜可掠夺 10%~25%）</div>'
    + (allied ? '<div>🤝 盟友优惠：购买价 9 折 · 互不侵犯</div>' : '');
  top.appendChild(info);
  const intel = el('div', 'gx-intel');
  intel.textContent = f.desc;
  top.appendChild(intel);
  // v0.2.10：详细交易清单（出售含库存/售价，收购含收价）
  const trade = el('div', 'gx-intel muted');
  trade.style.fontSize = '12px';
  const sellTxt = Object.keys(f.sell || {})
    .map((m) => m + ' 剩' + fmtNum(st.stock[m] || 0) + '@/价' + fmtNum(f.sell[m][1])).join('；');
  const buyTxt = Object.keys(f.buys || {})
    .map((m) => m + ' @' + fmtNum(f.buys[m])).join('；');
  trade.textContent = '出售：' + (sellTxt || '无') + '\n收购：' + (buyTxt || '无');
  trade.style.whiteSpace = 'pre-line';
  top.appendChild(trade);
  card.appendChild(top);

  const act = el('div', 'gx-card-actions');
  const allyBtn = el('button', 'btn btn-sm' + (allied ? '' : ' btn-ok'),
    allied ? '解除盟约' : '结盟（' + fmtNum(npcAllyCost(f)) + ' Ascoin）');
  allyBtn.addEventListener('click', () => {
    ensureAllianceFields(acc);
    if (allied) {
      acc.npcAllies = acc.npcAllies.filter((x) => x !== f.owner);
      refresh();
      return;
    }
    const cost = npcAllyCost(f);
    if ((Number(acc.ascoin) || 0) < cost) {
      alert('结盟需支付诚意金 ' + fmtNum(cost) + ' Ascoin（当前余额不足）。');
      return;
    }
    acc.ascoin = (Number(acc.ascoin) || 0) - cost;
    acc.npcAllies.push(f.owner);
    refresh();
  });
  const tradeBtn = el('button', 'btn btn-sm btn-primary', '贸易');
  tradeBtn.addEventListener('click', () => openNpcTradeModal(ctx, f, refresh));
  const atkBtn = el('button', 'btn btn-sm btn-danger', '进攻');
  if (allied) { atkBtn.disabled = true; atkBtn.title = '盟友不可进攻（可先解除盟约）'; }
  else atkBtn.addEventListener('click', () => openNpcAttackModal(ctx, rerender, acc, f, refresh));
  act.appendChild(allyBtn);
  act.appendChild(tradeBtn);
  act.appendChild(atkBtn);
  card.appendChild(act);
  return card;
}

/** NPC 即时交易：买 = 从 NPC 库存按售价扣 Ascoin 入物品栏；卖 = NPC 按收价付 Ascoin */
function openNpcTradeModal(ctx, f, refresh) {
  const openModal = ctx.openModal;
  if (!openModal) return;
  const st = npcStateOf(f);
  const wrap = el('div');   // v0.2.10 修复：rev13 重构时误删，导致贸易弹窗 ReferenceError
  const acc = currentAccount();
  const allied = isNpcAlly(acc, f.owner);   // v0.2.10：盟友购买价 9 折
  const inst = getPlanetInstance((acc && acc.homePlanetCode) || 'syl');

  wrap.appendChild(el('div', 'section-title', '向 ' + f.owner + ' 购买（即时成交）'));
  const buySel = document.createElement('select');
  buySel.className = 'bp-select';
  for (const m in (f.sell || {})) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m + '（剩 ' + fmtNum(st.stock[m] || 0) + ' · ' + fmtNum(Math.round(f.sell[m][1] * (allied ? 0.9 : 1))) + '/件）';
    buySel.appendChild(o);
  }
  const buyQty = document.createElement('input');
  buyQty.type = 'number'; buyQty.min = '1'; buyQty.value = '10'; buyQty.className = 'bp-input';
  const buyBtn = el('button', 'btn btn-sm btn-primary', '购买');
  const buyMsg = el('span', 'muted');
  buyBtn.addEventListener('click', () => {
    const m = buySel.value;
    const price = Math.max(1, Math.round(f.sell[m][1] * (allied ? 0.9 : 1)));
    const qty = Math.max(1, Math.floor(Number(buyQty.value) || 0));
    const avail = st.stock[m] || 0;
    const take = Math.min(qty, avail);
    if (!(take > 0)) { buyMsg.textContent = m + ' 已售罄。'; return; }
    const cost = Math.floor(take * price);
    if ((Number(acc && acc.ascoin) || 0) < cost) {
      buyMsg.textContent = 'Ascoin 不足（需 ' + fmtNum(cost) + '）。';
      return;
    }
    acc.ascoin = (Number(acc.ascoin) || 0) - cost;
    st.stock[m] = avail - take;
    if (inst) addGoods(inst, { [m]: take });
    buyMsg.textContent = '购入 ' + m + ' ×' + take + '，支付 ' + fmtNum(cost) + ' Ascoin（入母星物品栏）。';
    refresh();
  });
  const buyRow = el('div', 'bp-row');
  buyRow.appendChild(buySel); buyRow.appendChild(buyQty); buyRow.appendChild(buyBtn); buyRow.appendChild(buyMsg);
  wrap.appendChild(buyRow);

  wrap.appendChild(el('div', 'section-title', '向 ' + f.owner + ' 出售（即时成交，按其收价）'));
  const sellSel = document.createElement('select');
  sellSel.className = 'bp-select';
  for (const m in (f.buys || {})) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m + '（收价 ' + fmtNum(f.buys[m]) + '/件 · 你持有 ' + fmtNum(inst ? ownedOf(inst, m) : 0) + '）';
    sellSel.appendChild(o);
  }
  const sellQty = document.createElement('input');
  sellQty.type = 'number'; sellQty.min = '1'; sellQty.value = '10'; sellQty.className = 'bp-input';
  const sellBtn = el('button', 'btn btn-sm btn-primary', '出售');
  const sellMsg = el('span', 'muted');
  sellBtn.addEventListener('click', () => {
    const m = sellSel.value;
    const price = f.buys[m];
    const qty = Math.max(1, Math.floor(Number(sellQty.value) || 0));
    const owned = inst ? ownedOf(inst, m) : 0;
    const give = Math.min(qty, Math.floor(owned));
    if (!(give > 0)) { sellMsg.textContent = m + ' 库存不足（持有 ' + fmtNum(owned) + '）。'; return; }
    const gain = Math.floor(give * price);
    if (st.ascoin < gain) { sellMsg.textContent = f.owner + ' 金库 Ascoin 不足（剩 ' + fmtNum(st.ascoin) + '）。'; return; }
    spendOwned(inst, m, give);
    st.ascoin -= gain;
    acc.ascoin = (Number(acc.ascoin) || 0) + gain;
    sellMsg.textContent = '售出 ' + m + ' ×' + give + '，入账 ' + fmtNum(gain) + ' Ascoin。';
    refresh();
  });
  const sellRow = el('div', 'bp-row');
  sellRow.appendChild(sellSel); sellRow.appendChild(sellQty); sellRow.appendChild(sellBtn); sellRow.appendChild(sellMsg);
  wrap.appendChild(sellRow);
  openModal({ title: '贸易：' + f.nameCn + '（' + f.owner + '）', body: wrap });
}

/** NPC 即时进攻：钢铁雄心式多回合对驻军；胜掠夺金库，败按战损解散军队 */
function openNpcAttackModal(ctx, rerender, acc, f, refresh) {
  // v0.2.10：盟友不可进攻
  if (isNpcAlly(acc, f.owner)) {
    alert('「' + f.owner + '」是你的盟友，不可进攻（可先解除盟约）。');
    return;
  }
  const openModal = ctx.openModal;
  if (!openModal) return;
  const st = npcStateOf(f);
  const wrap = el('div');
  const myPower = myDefensePower(acc);
  const armies = listArmies(acc);
  wrap.appendChild(el('div', null, '以当前全部舰队 + 军队（战力 ' + fmtNum(myPower)
    + (armies.length ? '，建制军队 ' + armies.length + ' 支' : '')
    + '）进攻「' + f.nameCn + '」（' + f.owner + ' 驻军战力 ' + fmtNum(f.defense) + '）。'
    + '钢铁雄心式多回合会战，即时结算：胜方掠夺其金库 10%~25%，双方按兵力损失承受战损。'));
  const go = el('button', 'btn btn-danger', '确认发起进攻');
  const msg = el('div', 'muted');
  go.addEventListener('click', () => {
    go.disabled = true;
    const myUnits = armies.map((a) => ({
      nameCn: a.nameCn || a.id, power: a.power,
      atk: a.stats ? a.stats.atk : 0, def: a.stats ? a.stats.def : 0,
    }));
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const res = resolveBattleSafe(seed,
      myUnits.length ? myUnits : myPower, npcGarrison(f));
    // 攻方按兵力损失比解散军队（胜负都损耗）
    const list = listArmiesLocal(acc);
    const nLose = Math.floor(list.length * (res.atkLossRatio || 0));
    const lost = [];
    for (let i = 0; i < nLose && list.length; i++) {
      const a = list.splice(Math.floor(Math.random() * list.length), 1)[0];
      lost.push(a.nameCn || a.id);
      removeArmyLocal(acc, a.id);
    }
    let plunder = 0;
    if (res.attackerWin && st.ascoin > 0) {
      plunder = Math.floor(st.ascoin * (res.plunderRatio || 0));
      st.ascoin -= plunder;
      acc.ascoin = (Number(acc.ascoin) || 0) + plunder;
    }
    const body = document.createElement('div');
    body.style.whiteSpace = 'pre-line';
    body.textContent = res.log + '\n\n'
      + (res.attackerWin
        ? '攻破「' + f.nameCn + '」！掠夺 ' + fmtNum(plunder) + ' Ascoin。'
        : '进攻被击退' + (lost.length ? '，损失军队 ' + lost.join('、') : '，军队无损（火力侦察）') + '。')
      + (lost.length && res.attackerWin ? '\n战损解散：' + lost.join('、') : '');
    openModal({ title: '战斗结算（' + res.rounds + ' 回合）', body });
    refresh();
  });
  wrap.appendChild(go);
  wrap.appendChild(msg);
  openModal({ title: '进攻：' + f.nameCn + '（' + f.owner + '）', body: wrap });
}

function openTradeModal(ctx, rerender, acc, planet, after) {
  const openModal = ctx.openModal;
  if (!openModal) return;
  const inst = getPlanetInstance(ctx.planetCode || (acc && acc.homePlanetCode) || 'syl');
  // 从当前星球物品栏聚合持有 >0 的材料
  const owned = new Map();
  if (inst && Array.isArray(inst.inventory)) {
    for (const e of inst.inventory) {
      if (!e || !e.mat) continue;
      owned.set(e.mat, (owned.get(e.mat) || 0) + (Number(e.owned) || 0));
    }
  }
  const mats = [...owned.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const wrap = el('div');
  if (!mats.length) {
    wrap.appendChild(el('div', 'muted', '当前星球没有可出货的材料。'));
    openModal({ title: '贸易：' + (planet.planet_name_cn || planet.planet_code), body: wrap });
    return;
  }
  const f = el('div', 'galaxy-form');
  const sel = document.createElement('select');
  for (const [m, n] of mats) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m + '（持有 ' + fmtNum(n) + '）';
    sel.appendChild(opt);
  }
  const qty = document.createElement('input');
  qty.type = 'number'; qty.min = '1'; qty.value = '10';
  const price = document.createElement('input');
  price.type = 'number'; price.min = '1'; price.value = '100';
  const go = el('button', 'btn btn-primary', '发出要约（货即托管）');
  const msg = el('div', 'muted', '要约发出后货物立即从当前星球扣走托管；对方接受则收回货款，拒绝则原货退回。');
  go.addEventListener('click', async () => {
    const mat = sel.value;
    const n = Math.floor(Number(qty.value) || 0);
    const ask = Math.floor(Number(price.value) || 0);
    if (!(n > 0) || !(ask > 0)) { msg.textContent = '数量与要价必须为正数'; return; }
    const have = ownedOf(inst, mat);
    if (have < n) { msg.textContent = '持有不足：只有 ' + fmtNum(have); return; }
    spendOwned(inst, mat, n);
    const r = await postIncident(planet.owner_id, 'trade_offer', {
      goods: { [mat]: n }, askAscoin: ask, fromName: (acc && acc.name) || '深空旅人',
    });
    if (!r.ok) {
      // 发送失败：退货
      const e2 = ensureEntry(inst, mat, 'refined');
      if (e2) e2.owned = (Number(e2.owned) || 0) + n;
      msg.textContent = '发送失败：' + (r.reason || '') + '（货已退回）';
      return;
    }
    ctx.closeModal && ctx.closeModal();
    after && after();
  });
  f.appendChild(sel); f.appendChild(qty); f.appendChild(price); f.appendChild(go);
  wrap.appendChild(f); wrap.appendChild(msg);
  openModal({ title: '贸易要约 → ' + (planet.owner_name || '?'), body: wrap });
}

function openAttackModal(ctx, rerender, acc, planet, after) {
  // v0.2.10：盟友不可进攻
  if (isPlayerAlly(acc, planet && planet.owner_id)) {
    alert('「' + (planet.owner_name || '该指挥官') + '」是你的盟友，不可进攻（可先解除盟约）。');
    return;
  }
  const openModal = ctx.openModal;
  if (!openModal) return;
  const myPower = myDefensePower(acc);   // 同一口径：全部舰队 + 军队 + 驻防
  // v0.2.2：把建制军队快照带进 payload —— 守方按钢铁雄心式多回合会战结算
  const armies = listArmies(acc).map((a) => ({
    nameCn: a.nameCn || a.id, power: a.power,
    atk: a.stats ? a.stats.atk : 0, def: a.stats ? a.stats.def : 0,
  }));
  const wrap = el('div');
  wrap.appendChild(el('div', null, '以当前全部舰队 + 军队战力（' + fmtNum(myPower)
    + (armies.length ? '，建制军队 ' + armies.length + ' 支' : '，无建制军队 —— 按总战力折算一支远征军')
    + '）向「' + (planet.owner_name || '?') + '」的 ' + (planet.planet_name_cn || planet.planet_code)
    + ' 发起进攻宣告。对方上线后按钢铁雄心式多回合会战本地结算（同一随机种子：组织度被打空的部队撤出战斗、'
    + '战斗宽度每方 3 支、回合耗尽进攻方撤退）；胜方掠夺对方 10%~25% Ascoin，双方按兵力损失承受战损。'));
  const go = el('button', 'btn btn-danger', '确认发起进攻');
  const msg = el('div', 'muted');
  go.addEventListener('click', async () => {
    go.disabled = true;
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const r = await postIncident(planet.owner_id, 'attack', {
      seed, atkPower: myPower, atkArmies: armies, fromName: (acc && acc.name) || '深空旅人',
      fromPlanet: planet.planet_code || '',
    });
    if (!r.ok) { go.disabled = false; msg.textContent = '发送失败：' + (r.reason || ''); return; }
    ctx.closeModal && ctx.closeModal();
    ctx.openModal && ctx.openModal({ title: '进攻已宣告', body: '进攻宣告已发出。对方登录并处理收件箱后，'
      + '你会在此页收件箱收到战报回执（逐回合战报、掠夺与战损随后入账）。' });
    after && after();
  });
  wrap.appendChild(go); wrap.appendChild(msg);
  openModal({ title: '进攻：' + (planet.planet_name_cn || planet.planet_code), body: wrap });
}
