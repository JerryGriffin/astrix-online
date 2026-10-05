// ============================================================================
// 和平会议 UI（v0.4.5 需求 4）
// ============================================================================
//
// 玩家打赢一场战争后，这里取代原来那个「赔款直接入账 + 事后二选一弹窗」的流程：
//
//   1. 列出 6 种战后处置（吞并 / 殖民化 / 卫星国 / 合作政府 / 瓜分领土 / 赔款）；
//   2. **每一项都实时算出确切得失**（拿到几处战区、划几处殖民地、
//      赔多少、盟友分走多少、哪几项此刻不可选及原因）—— 不做模糊承诺；
//   3. 玩家选定后才结束战争，并立刻把结果写到地图上（战区易主 / 标为殖民地）。
//
// 设计要点：处置之间是**真实取舍**，不是换个文案。
//   吞并拿全部领土但要重兵驻守；殖民化产出 ×1.6、驻军需求降到 35%，
//   但被反扑时容易丢；瓜分要分给盟友；卫星国/合作政府最省事但对方保留战力。
// ============================================================================

import { treatyOptions, treatyAvailability, treatyOutcome, allyCountOf, partitionShares, signTreaty }
  from '../core/treaty.js?v=47.2';
// v0.4.7：殖民化加成与迫降线改引核心常量（此前 UI 里写死 1.6 / 35% / 60，
//   与 theater.js、war.js 各存一份，改平衡要同时改三处）
import { regionsOf, applyTreatyToTheater, TREATY_COLONY_OUTPUT_MUL, TREATY_COLONY_GARRISON_MUL } from '../core/theater.js?v=47.2';
import { endWar, WAR_FORCE_SURRENDER_SCORE } from '../core/war.js?v=47.2';
import { fmtNum } from '../core/format.js?v=47.2';
// v0.4.7：el() 收敛到 ui/common.js（此前本文件自带一份；全项目共 14 份、两种不兼容签名，
//   v0.3.2「列强区块不显示」即源于把 A 型调用写进了 B 型文件）
import { el } from './common.js?v=47.2';

// ---------------------------------------------------------------------------
// 和平会议主入口
// ---------------------------------------------------------------------------
export function openPeaceConference(acc, war, foeView, st, ctx, refresh) {
  const openModal = ctx && ctx.openModal;
  const closeModal = ctx && ctx.closeModal;
  if (!openModal) { alert('当前界面不支持弹窗'); return; }

  const wrap = el('div', 'hoi-treaty-conf');

  // ---- 战局摘要 ----
  wrap.appendChild(el('p', 'modal-tip',
    '「' + (foeView.nameCn || war.targetName || '敌方') + '」承认战败。'
    + '我方战争分数 ' + (war.myScore | 0) + ' / 对方 ' + (war.theirScore | 0) + '，'
    + '战争分数达到 ' + (war.myScore >= WAR_FORCE_SURRENDER_SCORE ? ' ✅' : ' ❌') + ' 迫降线，可召开和平会议。'));

  const foeRegions = regionsOf(acc, war.targetId);
  const allies = allyCountOf(acc, war);
  wrap.appendChild(el('p', 'modal-tip',
    '对方在战区地图上控制 ' + foeRegions.length + ' 处战区'
    + (foeRegions.length ? '（含殖民地与矿场，占领后将真正改变地图）' : '')
    + '；我方盟友 ' + allies + ' 个。'));

  const listWrap = el('div', 'hoi-treaty-list');
  wrap.appendChild(listWrap);

  // ---- 逐项渲染：每一项都带确切得失预览 ----
  const rows = [];
  for (const opt of treatyOptions()) {
    const av = treatyAvailability(acc, war, opt.id);
    const out = treatyOutcome(acc, war, opt.id, {
      regionsOfFoe: foeRegions,
      allyCount: allies,
      foeWealth: Number(st && st.ascoin) || 0,
    });

    const card = el('div', 'hoi-treaty-card' + (av.ok ? '' : ' is-locked'));

    const head = el('div', 'hoi-treaty-head');
    head.appendChild(el('span', 'hoi-treaty-icon', opt.icon || '⚖'));
    head.appendChild(el('span', 'hoi-treaty-name', opt.nameCn));
    head.appendChild(el('span', 'hoi-treaty-cost', '战争分数需 ' + ((opt.cost && opt.cost.score) || 0)));
    card.appendChild(head);

    card.appendChild(el('div', 'hoi-treaty-desc', opt.desc));

    // ---- 得失明细（不是笼统描述，而是具体数字）----
    const gains = el('ul', 'hoi-treaty-gains');
    const add = (label, value, cls) => {
      if (!value) return;
      gains.appendChild(el('li', 'hoi-treaty-gain' + (cls ? ' ' + cls : ''), label + '：' + value));
    };
    if (out.regionsTaken > 0) add('取得战区', out.regionsTaken + ' 处', 'is-good');
    if (opt.id === 'colonization') add('其中划为殖民地', '产出 ×' + TREATY_COLONY_OUTPUT_MUL + '、驻军需求降至 ' + Math.round(TREATY_COLONY_GARRISON_MUL * 100) + '%', 'is-good');
    if (out.regionsToAllies > 0) add('分予盟友', out.regionsToAllies + ' 处', 'is-bad');
    if (out.reparations > 0) add('获得赔款', fmtNum(out.reparations) + ' Ascoin', 'is-good');
    if (out.tribute > 0) add('长期上贡', ('产出的一部分（约 ' + Math.round(out.tribute * 100) + '%）'), 'is-good');
    if (out.researchBonus > 0) add('共享科研', ('约 ' + Math.round(out.researchBonus * 100) + '% 产出转为研究点'), 'is-good');
    if (!gains.childNodes.length) gains.appendChild(el('li', 'hoi-treaty-gain', '不改变领土归属'));
    card.appendChild(gains);

    // ---- 风险提示 ----
    if (opt.risk) card.appendChild(el('div', 'hoi-treaty-risk', '⚠ ' + opt.risk));

    // ---- 不可选原因 ----
    if (!av.ok) card.appendChild(el('div', 'hoi-treaty-locked', '✗ ' + av.reason));

    // ---- 瓜分：显示份额明细 ----
    if (opt.id === 'partition' && allies > 0) {
      const shares = partitionShares(acc, war);
      const shareWrap = el('div', 'hoi-treaty-shares');
      for (const s of shares) {
        shareWrap.appendChild(el('span', 'hoi-treaty-share' + (s.isMe ? ' is-me' : ''),
          s.name + ' ' + Math.round(s.share * 100) + '%'));
      }
      card.appendChild(shareWrap);
    }

    // ---- 签约按钮 ----
    if (av.ok) {
      const sign = el('button', 'btn btn-sm btn-primary hoi-treaty-sign', '签订「' + opt.nameCn + '」和约');
      sign.style.minHeight = '44px';
      sign.addEventListener('click', () => {
        if (!window.confirm('确定签订「' + opt.nameCn + '」和约？\n\n'
          + (opt.effect || '') + '\n' + (opt.risk ? '注意：' + opt.risk : ''))) return;
        commitTreaty(acc, war, opt, st, ctx, refresh);
      });
      card.appendChild(sign);
    }

    rows.push({ opt, card, out, av });
    listWrap.appendChild(card);
  }

  const cancel = el('button', 'btn btn-sm hoi-treaty-cancel', '取消（继续作战）');
  cancel.style.minHeight = '44px';
  cancel.addEventListener('click', () => { closeModal && closeModal(); });
  wrap.appendChild(cancel);

  openModal({ title: '和平会议 · ' + (foeView.nameCn || war.targetName || '战败国'), body: wrap });
}

// ---------------------------------------------------------------------------
// 签约落地：结束战争 + 把处置写到地图上
// ---------------------------------------------------------------------------
function commitTreaty(acc, war, opt, st, ctx, refresh) {
  const r = signTreaty(acc, war, opt.id, {
    foeWealth: Number(st && st.ascoin) || 0,
    applyMap: applyTreatyToTheater,
  });
  if (!r.ok) { alert(r.reason || '签订和约失败'); return; }

  // 结束战争：条约内容写进 war.treaty，便于战史与存档回放
  endWar(acc, war.targetId, 'me', {
    option: opt.id,
    optionName: opt.nameCn,
    regionsTaken: (r.outcome && r.outcome.regionsTaken) || 0,
    reparations: (r.outcome && r.outcome.reparations) || 0,
    toAllies: (r.outcome && r.outcome.regionsToAllies) || 0,
  }, '和平会议：' + opt.nameCn);

  // 记录战败国
  acc.defeatedNations = Array.isArray(acc.defeatedNations) ? acc.defeatedNations : [];
  const nid = String(war.targetId || '');
  if (nid && !acc.defeatedNations.includes(nid)) acc.defeatedNations.push(nid);

  const closeModal = ctx && ctx.closeModal;
  closeModal && closeModal();

  // 战果提示：明确说清地图上发生了什么
  let extra = '';
  const map = r.map;
  if (map) {
    if (map.colonies && map.colonies.length) {
      extra += '\n· ' + map.colonies.length + ' 处战区划为殖民地（产出 ×' + TREATY_COLONY_OUTPUT_MUL
        + '，但驻军需求降至 ' + Math.round(TREATY_COLONY_GARRISON_MUL * 100) + '%）';
    }
    if (map.taken && map.taken.length) extra += '\n· 取得 ' + map.taken.length + ' 处战区';
    if (map.toAllies && map.toAllies.length) extra += '\n· ' + map.toAllies.length + ' 处战区分予盟友';
  }
  if ((r.outcome && r.outcome.reparations) > 0) {
    extra += '\n· 赔款 ' + fmtNum(r.outcome.reparations) + ' Ascoin 已入账';
  }
  alert('和平会议签订「' + opt.nameCn + '」和约。' + (r.summary || '') + extra);
  refresh && refresh();
}