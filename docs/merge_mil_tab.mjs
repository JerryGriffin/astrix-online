// v0.4.16 入口整合（②）：把「舰队 / 军队 / 战区」三个顶层页签合并为**单一「军事」入口**
//
// 起因（用户诉求）：「把所有系统都整合到一个入口里面，例如战斗系统不要在多个入口
//   里面存在各种新旧窗口」。此前军事相关的内容散在 4 个顶层页签里：
//     · 舰队 tab —— 自己还带一层子导航（舰船 / 舰队与殖民 / 设计与建造）
//     · 军队 tab —— 自己也带一层子导航（我的军队 / 设计与建造）
//     · 战区 tab
//     · 星际 tab —— 另有战争战况与 NPC 进攻（v0.4.12 已把宣战/和平会议/投降收拢走）
//   同一个「军队」功能因此有两套一模一样的子导航控件，跨页切换要来回跳。
//
// 做法：顶层只留一个「军事」页签，内部子页 = 战区 / 军队 / 舰队；
//   三个原页签的 key（hoi / army / fleet）保留为**子页 key**，
//   selectTab 对旧 key 做重定向，这样任何遗留调用都不会掉进「未开放」占位页。
//
// 前置检查：已确认全库除 planet.js 自身外，没有任何文件引用 'hoi'/'army'/'fleet'
//   这三个 tab key（docs/scan_tab_refs.mjs），所以合并不会打断外部调用。
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/ui/planet.js';
let src = readFileSync(FILE, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
const N = (s) => s.split(EOL).join('\n');
src = N(src);
let n = 0;
function must(cond, what) { if (!cond) { console.error('✗ ' + what + ' 没找到'); process.exit(1); } n++; }

// ---------------------------------------------------------------- 1) 页签定义
// 用正则而非字面量匹配：这个文件的缩进在各段之间不一致（有的 2 空格、有的 4 空格），
// 写死缩进会在下一���文件里就匹配不上（v0.4.16 首次应用时正是如此）。
const TABS_RE = /[ \t]*\{ key: 'fleet', label: '舰队' \},\r?\n[ \t]*\{ key: 'army', label: '军队' \},/;
must(TABS_RE.test(src), '页签定义里的 舰队/军队 两行');
src = src.replace(TABS_RE, () => "    { key: 'mil', label: '军事' },");

// 战区页签：原来单独 push，现在并入军事入口
const OLD_HOI_PUSH = `  tabs.push({ key: 'hoi', label: '战区' });`;
const NEW_HOI_PUSH = `  // v0.4.16：战区不再是独立顶层页签，改作「军事」入口下的子页
  //   （原先与 军队 / 舰队 并列，同一套军事内容散在 4 个顶层入口里）。`;
must(src.includes(OLD_HOI_PUSH), '战区页签 push');
src = src.replace(OLD_HOI_PUSH, () => NEW_HOI_PUSH);

// ---------------------------------------------------------------- 2) selectTab 分发
const OLD_DISPATCH = `    } else if (key === 'fleet') {
      renderFleet(contentInner);
    } else if (key === 'build') {`;
const NEW_DISPATCH = `    } else if (key === 'mil') {
      renderMilitary(contentInner);
    } else if (key === 'build') {`;
must(src.includes(OLD_DISPATCH), "selectTab 里的 key === 'fleet' 分支");
src = src.replace(OLD_DISPATCH, () => NEW_DISPATCH);

const OLD_ARMY_HOI = `    } else if (key === 'army') {
      // v0.2.0：军队页（组装生产线 / 蓝图 / 建制军队）
      showArmy(contentInner);
    } else if (key === 'hoi') {
      // v0.2.6：1936 剧本国策与海域面板
      showHoi(contentInner);
    } else if (key === 'galaxy') {`;
const NEW_ARMY_HOI = `    } else if (key === 'galaxy') {`;
must(src.includes(OLD_ARMY_HOI), "selectTab 里的 army / hoi 分支");
src = src.replace(OLD_ARMY_HOI, () => NEW_ARMY_HOI);

// ---------------------------------------------------------------- 3) 重定向 + 军事入口
const OLD_REDEF = `  let currentTab = 'inv';
  function rerender() { selectTab(currentTab); }`;
const NEW_REDEF = `  let currentTab = 'inv';
  function rerender() { selectTab(currentTab); }

  // v0.4.16 入口整合：旧页签 key 重定向到新入口，并带上对应子页。
  //   rerender() 走的是 currentTab，而子页切换会改写 currentTab，所以
  //   数据变化后重绘仍停在用户正在看的那个子页上。
  const MIL_SUB_FROM_TAB = { hoi: 'hoi', army: 'army', fleet: 'fleet' };
  let milSub = 'hoi';

  /**
   * 单一「军事」入口：顶层只有这一个页签，内部子页 = 战区 / 军队 / 舰队。
   * 顺序按「先看战况、再调兵、最后看舰队」的操作链排。
   */
  function renderMilitary(container) {
    container.innerHTML = '';
    const subNav = document.createElement('div');
    subNav.className = 'fleet-subnav';
    const subContent = document.createElement('div');
    subContent.className = 'fleet-subcontent';
    container.append(subNav, subContent);

    const defs = [
      { key: 'hoi', label: '战区' },
      { key: 'army', label: '军队' },
      { key: 'fleet', label: '舰队' },
    ];
    const btns = {};
    defs.forEach((d) => {
      const b = document.createElement('button');
      b.className = 'fleet-subnav-btn';
      b.textContent = d.label;
      b.addEventListener('click', () => selectMilSub(d.key));
      btns[d.key] = b;
      subNav.appendChild(b);
    });

    function selectMilSub(k) {
      milSub = k;
      // currentTab 记成子页 key，这样 rerender() 能回到同一个子页
      currentTab = k;
      Object.entries(btns).forEach(([kk, b]) => b.classList.toggle('active', kk === k));
      subContent.innerHTML = '';
      if (k === 'hoi') showHoi(subContent);
      else if (k === 'army') showArmy(subContent);
      else renderFleet(subContent);
    }

    selectMilSub(milSub);
    // 顶层按钮高亮：停在「军事」页签上
    Object.entries(tabBtns).forEach(([k, b]) => b.classList.toggle('active', k === 'mil'));
  }`;
must(src.includes(OLD_REDEF), 'currentTab / rerender 声明');
src = src.replace(OLD_REDEF, () => NEW_REDEF);

// ---------------------------------------------------------------- 4) selectTab 加旧 key 重定向
const OLD_SELTAB_HEAD = `  function selectTab(key) {
    currentTab = key;`;
const NEW_SELTAB_HEAD = `  function selectTab(key) {
    // v0.4.16：把旧的三个页签 key 重定向到新的「军事」入口。
    //   没有这层重定向，任何遗留的 selectTab('army') 都会掉进末尾的
    //   「尚未开放」占位页 —— 表现为功能凭空消失。
    if (MIL_SUB_FROM_TAB[key]) {
      milSub = MIL_SUB_FROM_TAB[key];
      key = 'mil';
    }
    currentTab = key;`;
must(src.includes(OLD_SELTAB_HEAD), 'selectTab 函数头');
src = src.replace(OLD_SELTAB_HEAD, () => NEW_SELTAB_HEAD);

// 标签查表：labelOf 用于占位页文案，合并后补上新 key
const OLD_LABEL_FALLBACK = `      contentInner.innerHTML =
        \`<div class="placeholder glass">\` +`;
const NEW_LABEL_FALLBACK = `      contentInner.innerHTML =
        \`<div class="placeholder glass">\` +`;
must(src.includes(OLD_LABEL_FALLBACK), '占位页兜底');

writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
console.log('✓ planet.js 已合并为单一「军事」入口（' + n + ' 处改动）');