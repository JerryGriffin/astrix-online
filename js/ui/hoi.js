// 国策与海域面板（v0.2.6 官方 mod 1936 剧本）
//   · 顶部：剧本日历（到天）、国家、阵营、人口、军队 / 舰队概览
//   · 国策树：工业 / 军事 / 外交三支，各两支；按游戏天数推进，完成即生效
//   · 海域：六个 HOI4 风格海域，制海权争夺 + 海战结算
import { fmtNum } from '../core/format.js?v=30.1';
import { currentAccount, getPlanetInstance } from '../core/state.js?v=30.1';
import { listArmies, totalArmyPowerOf } from '../core/army.js?v=30.1';
import { listFleets, fleetPowerOf } from '../core/fleet.js?v=30.1';
import {
  scenarioDateOf, gameDaysOf, ensureFocus, focusOptionsOf, startFocus,
  ensureSeas, contestSea, blocNameOf, nationOf, deepOf, enemySeaPressure, backgroundOf, HOI_SCENARIO_ID,
} from '../core/hoi1936.js?v=30.1';
import { HOI_SEAS } from '../data/hoi1936.js?v=30.1';

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  // 兼容两种写法：el(tag, 'class-a class-b', children) 与 el(tag, { class, text }, children)
  const map = (typeof attrs === 'string') ? { class: attrs } : attrs;
  for (const k in map) {
    if (k === 'style') e.setAttribute('style', map[k]);
    else if (k === 'text') e.textContent = map[k];
    else e.setAttribute(k, map[k]);
  }
  // 第三参兼容：字符串/数字 → 文本；元素或数组 → 追加子节点
  if (typeof children === 'string' || typeof children === 'number') {
    e.textContent = String(children);
    return e;
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    if (typeof c === 'string' || typeof c === 'number') e.appendChild(document.createTextNode(String(c)));
    else e.appendChild(c);
  }
  return e;
}

const CSS = `
  .hoi-panel { font-family: system-ui, sans-serif; color: #e8eef2; padding: 12px; box-sizing: border-box; }
  .hoi-head { background: linear-gradient(180deg, #1c2733, #16202b); border: 1px solid #2a3645; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
  .hoi-date { font-size: 24px; font-weight: 800; letter-spacing: 1px; color: #ffd479; }
  .hoi-sub { font-size: 12px; opacity: .8; margin-top: 4px; line-height: 1.8; }
  .hoi-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .hoi-stat { background: #101820; border-radius: 8px; padding: 8px 10px; min-width: 96px; }
  .hoi-stat .lbl { font-size: 11px; opacity: .65; }
  .hoi-stat .val { font-size: 16px; font-weight: 700; }
  .hoi-sec { border: 1px solid #2a3645; border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
  .hoi-sec-h { padding: 9px 12px; background: #16202b; font-weight: 700; display: flex; justify-content: space-between; align-items: baseline; }
  .hoi-branch { padding: 8px 12px; }
  .hoi-branch > .bn { font-size: 12px; color: #9FE1CB; font-weight: 700; margin: 6px 0 4px; }
  .hoi-focus { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; min-height: 44px; border-top: 1px solid #223040; }
  .hoi-focus .nm { flex: 1 1 150px; min-width: 0; }
  .hoi-focus .nm .d { font-size: 11px; opacity: .65; line-height: 1.5; }
  .hoi-focus .tag { font-size: 11px; padding: 2px 6px; border-radius: 8px; border: 1px solid #34465a; }
  .hoi-focus .tag.done { color: #9FE1CB; border-color: rgba(159,225,203,.5); }
  .hoi-focus button { min-height: 40px; border-radius: 8px; border: none; background: #2d3e50; color: #fff; cursor: pointer; padding: 0 10px; }
  .hoi-focus button.primary { background: #2a5a4d; }
  .hoi-bar { height: 8px; border-radius: 4px; background: #101820; overflow: hidden; margin-top: 4px; }
  .hoi-bar > i { display: block; height: 100%; background: #9FE1CB; }
  .hoi-sea { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; border-top: 1px solid #223040; min-height: 44px; }
  .hoi-sea .nm { flex: 1 1 120px; }
  .hoi-sea .ctl { width: 120px; }
  .hoi-sea button { min-height: 40px; border-radius: 8px; border: none; background: #2d3e50; color: #fff; cursor: pointer; padding: 0 10px; }
  .hoi-note { font-size: 12px; opacity: .65; padding: 0 2px 8px; line-height: 1.7; }
`;

export function renderHoi(root, ctx) {
  const acc = currentAccount();
  root.innerHTML = '';
  if (!acc || acc.scenario !== HOI_SCENARIO_ID) {
    root.appendChild(el('div', { class: 'hoi-panel' },
      el('p', { class: 'hoi-note', text: '仅 1936 剧本存档可用（新建存档 → 开局模式选「1936 剧本」）。' })));
    return;
  }
  root.appendChild(el('style', { text: CSS }));
  const panel = el('div', 'hoi-panel');

  const n = nationOf(acc);
  const deep = deepOf(acc) || {};
  const f = ensureFocus(acc);
  const seas = ensureSeas(acc);
  const navies = listFleets(acc);
  const navPower = navies.reduce((s, x) => {
    try { return s + (fleetPowerOf(acc, x.id) || 0); } catch (e) { return s; }
  }, 0);

  // ---- 顶部：剧本日历与国情 ----
  const head = el('div', 'hoi-head');
  head.appendChild(el('div', 'hoi-date', scenarioDateOf(acc)));
  head.appendChild(el('div', 'hoi-sub',
    (n ? (n.flag + ' ' + n.nameCn + '（' + n.nameEn + '）') : '未知国家')
    + ' · 首都 ' + (n ? n.capital : '—')
    + ' · 阵营：' + (blocNameOf(acc) || '不结盟')
    + '　|　剧本已进行 ' + Math.floor(gameDaysOf(acc)) + ' 天'));
  if (n) {
    head.appendChild(el('div', 'hoi-sub',
      '本体编制：' + (deep.armyName || '步兵师') + '（每支 ' + 500 + ' 人）'
      + '　|　史实海军 ' + n.navy + ' 舰 → 游戏内 ' + acc.ships.length + ' 艘 / ' + navies.length + ' 支舰队'));
  }
  const stats = el('div', 'hoi-stats');
  const addStat = (lbl, val) => stats.appendChild(el('div', 'hoi-stat', [
    el('div', { class: 'lbl', text: lbl }), el('div', { class: 'val', text: val }),
  ]));
  const homeInst = getPlanetInstance(acc.homePlanetCode);
  addStat('人口', fmtNum(Math.floor((homeInst.pop && homeInst.pop.total) || 0)));
  addStat('军队', listArmies(acc).length + ' 支');
  addStat('陆军战力', fmtNum(totalArmyPowerOf(acc)));
  addStat('舰队战力', fmtNum(Math.round(navPower)));
  addStat('国内工业', n ? String(n.ic) : '—');
  addStat('工业建筑', fmtNum(homeInst.hoiIndustry ? homeInst.hoiIndustry.buildings : 0) + ' 座');
  addStat('产线工人', fmtNum(acc.hoiWorkforce || 0));
  addStat('海军传统', '×' + (Number(acc.hoiNavyMul) || 1).toFixed(2));
  head.appendChild(stats);
  const bg = backgroundOf(acc);
  if (bg) {
    const bgBox = el('div', 'hoi-sub');
    bgBox.style.cssText = 'margin-top:8px;padding:8px 10px;background:#101820;border-radius:8px;font-size:12px;line-height:1.8;';
    bgBox.textContent = '📜 ' + bg;
    head.appendChild(bgBox);
  }
  panel.appendChild(head);

  // ---- 国策树 ----
  const focusSec = el('div', 'hoi-sec');
  const cur = f.current;
  focusSec.appendChild(el('div', 'hoi-sec-h', [
    el('span', null, '国策'),
    el('span', { class: 'hoi-sub', text: cur ? ('推进中：' + cur.nameCn + '（' + Math.floor(cur.progressDays) + '/' + cur.needDays + ' 天）') : '空闲（可选择一项国策）' }),
  ]));
  focusSec.appendChild(el('div', 'hoi-note', '国策按游戏天数推进（1 秒 = 1 天）。三支六策，每支侧重不同：工业扩张 / 军事理论 / 外交同盟。'));
  const opts = focusOptionsOf(acc);
  const branches = ['工业', '军事', '外交'];
  for (const br of branches) {
    const wrap = el('div', 'hoi-branch');
    wrap.appendChild(el('div', 'bn', br + '线'));
    for (const o of opts.filter((x) => x.branch === br)) {
      const row = el('div', 'hoi-focus');
      const nm = el('div', 'nm');
      nm.appendChild(el('div', null, o.nameCn + '　' + o.days + ' 天'));
      nm.appendChild(el('div', 'd', o.desc || ''));
      row.appendChild(nm);
      if (o.done) {
        row.appendChild(el('span', 'tag done', '已完成'));
      } else if (cur && cur.id === o.id) {
        const bar = el('div', 'hoi-bar');
        bar.appendChild(el('i', { style: 'width:' + Math.min(100, (cur.progressDays / cur.needDays) * 100) + '%' }));
        row.appendChild(bar);
        row.appendChild(el('span', 'tag', '进行中'));
      } else if (o.locked) {
        const tag = el('span', 'tag', '锁定');
        tag.title = o.locked;
        row.appendChild(tag);
        row.appendChild(el('span', 'd', o.locked));
      } else {
        const b = el('button', cur ? '' : 'primary', cur ? '排队中' : '开始');
        if (!cur) {
          b.addEventListener('click', () => {
            const r = startFocus(acc, o.id);
            if (!r.ok) { alert(r.reason); return; }
            renderHoi(root, ctx);
          });
        } else b.disabled = true;
        row.appendChild(b);
      }
      wrap.appendChild(row);
    }
    focusSec.appendChild(wrap);
  }
  panel.appendChild(focusSec);

  // ---- 海域 ----
  const seaSec = el('div', 'hoi-sec');
  const pressure = enemySeaPressure(acc);
  seaSec.appendChild(el('div', 'hoi-sec-h', [
    el('span', null, '海域与制海权'),
    el('span', { class: 'hoi-sub', text: '敌方海上压力 ' + fmtNum(Math.round(pressure)) + (pressure ? '' : '（当前无敌意海军）') }),
  ]));
  seaSec.appendChild(el('div', 'hoi-note', '派舰队巡航以争夺制海权（0~100%）。海战按双方舰队实力结算，失利会有舰艇损失。'));
  const seaBtnRow = el('div', 'hoi-branch');
  const seaSel = document.createElement('select');
  seaSel.style.cssText = 'min-height:40px;border-radius:8px;background:#2d3e50;color:#fff;border:none;padding:0 8px;';
  if (!navies.length) {
    const o = document.createElement('option');
    o.textContent = '（尚无舰队）';
    seaSel.appendChild(o);
  }
  for (const fl of navies) {
    const o = document.createElement('option');
    o.value = fl.id;
    o.textContent = fl.nameCn + '（' + (fl.shipIds || []).length + ' 艘）';
    seaSel.appendChild(o);
  }
  const out = el('div', 'hoi-note');
  seaBtnRow.appendChild(el('span', 'hoi-note', '巡航舰队：'));
  seaBtnRow.appendChild(seaSel);
  seaSec.appendChild(seaBtnRow);
  for (const s of seas) {
    const row = el('div', 'hoi-sea');
    const nm = el('div', 'nm');
    nm.appendChild(el('div', null, s.nameCn));
    nm.appendChild(el('div', 'd', '基准强度 ' + s.base + (s.lastResult ? ' · 上次：' + (s.lastResult.win ? '我方主动' : '敌方主动') + '（损失 ' + s.lastResult.sunk + '）' : '')));
    nm.lastChild.style.cssText = 'font-size:11px;opacity:.65;';
    row.appendChild(nm);
    const ctl = el('div', 'ctl');
    ctl.appendChild(el('div', { class: 'hoi-note', text: '制海权 ' + Math.round(s.control * 100) + '%' }));
    const bar = el('div', 'hoi-bar');
    bar.appendChild(el('i', { style: 'width:' + Math.round(s.control * 100) + '%;background:' + (s.control >= 0.5 ? '#9FE1CB' : '#f09595') }));
    ctl.appendChild(bar);
    row.appendChild(ctl);
    const go = el('button', null, '巡航争夺');
    go.addEventListener('click', () => {
      const fl = navies.find((x) => x.id === seaSel.value);
      if (!fl) { alert('先组建 / 选择一支舰队。'); return; }
      let pw = 0;
      try { pw = fleetPowerOf(acc, fl.id) || 0; } catch (e) { pw = 0; }
      // 舰队规模换算成海上战力（HOI4 风格：吨位与数量）
      const myNavyStr = (pw + (fl.shipIds || []).length * 60 + n.navy * 6) * (Number(acc.hoiNavyMul) || 1);
      const r = contestSea(acc, s.id, myNavyStr);
      if (!r.ok) { alert(r.reason); return; }
      // 失利损失舰艇：从该舰队移除船（船同时从 acc.ships 摘除）
      if (r.sunk > 0) {
        for (let i = 0; i < r.sunk; i++) {
          const sid = (fl.shipIds || []).pop();
          if (sid == null) break;
          const idx = acc.ships.findIndex((x) => x && x.id === sid);
          if (idx >= 0) acc.ships.splice(idx, 1);
        }
      }
      alert(r.logs.join('\n'));
      renderHoi(root, ctx);
    });
    row.appendChild(go);
    seaSec.appendChild(row);
  }
  panel.appendChild(seaSec);

  // ---- 口径说明 ----
  panel.appendChild(el('p', 'hoi-note',
    '说明：本页为官方 mod「1936 剧本」专属。交战采用钢铁雄心式多回合结算（编队宽度 3、组织度耗尽撤退）；'
    + '海战按舰队实力与真实海军规模换算（含海军传统加成）；国策按游戏天数推进，'
    + '同支国策需按序解锁，外交线两策互斥。'
    + '另外：AI 国家会主动宣战或结盟（每 30 游戏天判定）；「星球管理 → 战时总动员」在全存档可用（产出 +30%、幸福度下滑）。'));

  root.appendChild(panel);
}
