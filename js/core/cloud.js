// 云服务封装（Astrix v0.2.0，v0.2.8 起双通道）
// WorkBuddy Cloud Service（对标 Supabase）：邮箱认证 + 星系 registry + 跨玩家事件邮箱。
//
// 【双通道】（v0.2.8）—— 让 GitHub Pages 等任意静态托管也能玩在线模式：
//   A) 原生通道：游戏与云端点同源（astrix.app.workbuddy.host 发布版）→ 直接用 SDK。
//   B) 桥接通道：其它托管（GitHub Pages / 本地 / 任意静态站）→ 浏览器直连云 API 会被
//      跨域预检拦下（服务端不回 OPTIONS），改为**隐藏 iframe** 加载
//      https://astrix.app.workbuddy.host/cloud-bridge.html（与云 API 同源、直接调 SDK），
//      本模块把每个云调用经 postMessage 转发过去（RPC）。两版玩家进同一个星系。
//   两个通道的导出函数**完全同签名**，调用方（main / start / galaxy / state）零感知。
//
// 【加载策略】SDK 按需懒加载（原生通道）；桥接通道的 iframe 也按需懒创建。
//   CDN 不可达绝不能拖垮游戏启动（启动守卫只接管 boot 完成前的资源错误）。
// 【publicConfig】endpoint + publishableKey 属 public 值（服务端按 Origin 校验鉴权），
//   零构建项目无注入通道，按云服务技能约定直接进源码；不得写入任何私密 key。
// 【RLS 模型】
//   galaxy_planets  公开读 / 本人写（owner_id = auth.uid()）
//   galaxy_incidents 发件人写 / 收件人+发件人读 / 双方均可标记 resolved
//   → 「打别人 / 贸易别人」= 插入一条 target_uid 指向对方的事件；
//     对方上线后在收件箱本地结算，并把回执（战报/贸易结算）作为新事件发回。

import { CACHE_TAG } from '../version.js?v=58.9';

const CLOUD_ENDPOINT = 'https://astrix.app.workbuddy.host';
const CLOUD_PUBLISHABLE_KEY = 'wbpk_a83qn1S1YtnqmhL6Wb2oF3_dIuTVZ1qLa1Ph94JTqQhmspVf2q27z14';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';

// 原生/桥接通道判定（**调用时动态判定**，v0.2.8）
//   * location.origin 与云端点同源 → 原生；
//   * window.WorkBuddyCloud 已预置（自检桩环境注入假 SDK）→ 也走原生直连；
//   * 真浏览器其它托管（GitHub Pages 等）永远不会预置该全局 → 桥接。
// 注意不能在模块加载时判死：render 自检是先 import galaxy.js（连带本模块）
//   再注入假 SDK 全局，判死会把桩环境误判成跨域而永远等不到桥接 iframe。
function isNative() {
  try {
    if (typeof location !== 'undefined' && location.origin === CLOUD_ENDPOINT) return true;
    if (typeof window !== 'undefined' && window.WorkBuddyCloud) return true;
  } catch (e) { /* 忽略 */ }
  return false;
}

const state = {
  status: 'idle',          // idle | loading | ready | error
  error: null,
  client: null,
  user: null,              // { id, email }（登录后）
};

let _loadPromise = null;

// v0.2.10 rev17：SDK 多源加载 —— CDN 闪断（尤其国内网络）不再拖死在线模式。
// 依次尝试：主 CDN → fastly 镜像 → 仓库内本地兜底副本（assets/vendor/，随发布更新）。
const SDK_URLS = [
  SDK_URL,
  'https://fastly.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@0.1.3/lib/index.global.js',
  'assets/vendor/workbuddy-cloud-sdk.js?v=' + CACHE_TAG,
];

function loadSdkOnce() {
  if (window.WorkBuddyCloud) return Promise.resolve(true);
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    for (const url of SDK_URLS) {
      const ok = await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => resolve(!!window.WorkBuddyCloud);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
        // 8s 单源超时兜底（挂起时不无限等待）
        setTimeout(() => resolve(!!window.WorkBuddyCloud), 8000);
      });
      if (ok) return true;
      // 清掉失败标签（避免 DOM 堆积）
      const bad = document.querySelector('script[src="' + url + '"]');
      if (bad && bad.parentNode) bad.parentNode.removeChild(bad);
    }
    return false;
  })();
  return _loadPromise;
}

// ============================================================================
// 通道 B：跨域桥接（iframe + postMessage RPC）
// ============================================================================
const BRIDGE_ORIGIN = CLOUD_ENDPOINT;
const bridge = { iframe: null, ready: false, seq: 0, pending: new Map(), starting: null, listener: false };

function bridgeParentOrigin() {
  // file:// 等（origin 为 "null"）回退 null → 桥页对这类父域用 targetOrigin '*' 兜底
  try {
    if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  } catch (e) { /* 忽略 */ }
  return null;
}

function bridgeUrl() {
  const po = bridgeParentOrigin();
  return BRIDGE_ORIGIN + '/cloud-bridge.html?origin=' + encodeURIComponent(po || '')
    + '&v=' + CACHE_TAG;
}

function onBridgeMessage(ev) {
  if (ev.origin !== BRIDGE_ORIGIN) return;
  const m = ev.data;
  if (!m || m.__astrixBridge !== true) return;
  if (m.ready) { bridge.ready = true; return; }
  if (m.id == null) return;
  const p = bridge.pending.get(m.id);
  if (p) { bridge.pending.delete(m.id); p(m.result); }
}

/** 创建隐藏桥接 iframe 并完成握手。resolve(true)=就绪 */
function ensureBridge() {
  if (bridge.ready && bridge.iframe) return Promise.resolve(true);
  if (bridge.starting) return bridge.starting;
  bridge.starting = new Promise((resolve) => {
    if (!bridge.listener) {
      window.addEventListener('message', onBridgeMessage);
      bridge.listener = true;
    }
    const ifr = document.createElement('iframe');
    ifr.style.display = 'none';
    ifr.setAttribute('aria-hidden', 'true');
    ifr.title = 'astrix-cloud-bridge';
    ifr.src = bridgeUrl();
    bridge.iframe = ifr;
    let settled = false;
    const timer = setTimeout(() => settle(false), 15000);
    // ready 消息 + 轮询双保险（消息可能在极端时序下先于监听器到达）
    const poll = setInterval(() => {
      if (bridge.ready) { clearInterval(poll); settle(true); }
    }, 100);
    setTimeout(() => clearInterval(poll), 16000);
    function settle(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      bridge.starting = null;
      resolve(ok);
    }
    // 真实浏览器：插入 DOM 后同步创建 about:blank frame，contentWindow 立即可用；
    // 桩环境（Node 自检的假 DOM）插入后仍无 contentWindow → 快速失败，
    // 恢复「直连不可用」的旧行为，避免卡 15 秒拖死后续调用（render 自检曾在此卡死）。
    (document.body || document.documentElement).appendChild(ifr);
    if (!ifr.contentWindow) { settle(false); return; }
  });
  return bridge.starting;
}

async function bridgeRpc(fn, args = []) {
  const ok = await ensureBridge();
  if (!ok || !bridge.iframe || !bridge.iframe.contentWindow) {
    return { ok: false, reason: '云桥接加载失败（检查网络）' };
  }
  const id = ++bridge.seq;
  return new Promise((resolve) => {
    bridge.pending.set(id, resolve);
    try {
      bridge.iframe.contentWindow.postMessage({ __astrixBridge: true, id, fn, args }, BRIDGE_ORIGIN);
    } catch (e) {
      bridge.pending.delete(id);
      resolve({ ok: false, reason: '桥接发送失败' });
      return;
    }
    setTimeout(() => {
      if (bridge.pending.has(id)) {
        bridge.pending.delete(id);
        resolve({ ok: false, reason: '云桥接响应超时' });
      }
    }, 25000);
  });
}

// ============================================================================
// ensureReady：初始化（幂等）。resolve(true)=可用
// ============================================================================
async function nativeEnsureReady() {
  if (state.status === 'ready') return true;
  if (state.status === 'loading') {
    // 等待中的轮询
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (state.status !== 'loading') return state.status === 'ready';
    }
    return false;
  }
  state.status = 'loading';
  try {
    const ok = await loadSdkOnce();
    if (!ok || !window.WorkBuddyCloud || typeof window.WorkBuddyCloud.createWorkBuddyCloud !== 'function') {
      state.status = 'error';
      state.error = '云服务 SDK 加载失败（检查网络）';
      return false;
    }
    state.client = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: CLOUD_ENDPOINT,
      publishableKey: CLOUD_PUBLISHABLE_KEY,
    });
    // 恢复会话
    try {
      const { data, error } = await state.client.auth.getSession();
      if (!error && data && data.user) state.user = { id: data.user.id, email: data.user.email || '' };
      else state.user = null;
    } catch (e) { state.user = null; }
    // v0.2.10：账号名身份（player_accounts，无云 session）恢复
    if (!state.user) {
      const nu = lsGet('astrix_nuid'), nn = lsGet('astrix_nname');
      if (nu && nn) state.user = { id: nu, name: nn };
    }
    state.status = 'ready';
    return true;
  } catch (e) {
    state.status = 'error';
    state.error = (e && e.message) ? e.message : String(e);
    return false;
  }
}

async function bridgeEnsureReady() {
  if (state.status === 'ready') return true;
  if (state.status === 'loading') {
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (state.status !== 'loading') return state.status === 'ready';
    }
    return false;
  }
  state.status = 'loading';
  const ok = await bridgeRpc('ensureReady');
  const st = await bridgeRpc('cloudStatus');
  if (ok && st && st.status === 'ready') {
    state.status = 'ready';
    state.error = null;
    state.user = st.user || null;
    return true;
  }
  state.status = 'error';
  state.error = (st && st.error) || '云服务不可用（桥接）';
  return false;
}

export async function ensureReady() {
  return isNative() ? nativeEnsureReady() : bridgeEnsureReady();
}

export function cloudStatus() { return { status: state.status, error: state.error, user: state.user }; }
export function cloudUser() { return state.user; }
export function isCloudReady() { return state.status === 'ready'; }

// ============================================================================
// 认证（Web = 邮箱：密码登录 / 邮箱验证码 登录+注册）
// ============================================================================
async function nativeSignInWithPassword(email, password) {
  if (!(await nativeEnsureReady()) || !state.client) return { ok: false, reason: state.error || '云服务不可用' };
  try {
    const { data, error } = await state.client.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
    if (error) return { ok: false, reason: error.message || '登录失败' };
    state.user = data && data.user ? { id: data.user.id, email: data.user.email || '' } : null;
    return { ok: true, user: state.user };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
}

// ---- 邮箱验证码（登录或注册共用；注册需附密码）----
let _pendingOtp = null;   // { email, verificationId, isExistingUser }

async function nativeSendEmailOtp(email) {
  if (!(await nativeEnsureReady()) || !state.client) return { ok: false, reason: state.error || '云服务不可用' };
  const em = String(email || '').trim();
  try {
    const sent = await state.client.auth.sendOtp({ email: em });
    if (sent.error) return { ok: false, reason: sent.error.message || '验证码发送失败' };
    _pendingOtp = {
      email: em,
      verificationId: sent.data.verificationId,
      isExistingUser: !!sent.data.isExistingUser,
    };
    return { ok: true, isExistingUser: _pendingOtp.isExistingUser };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
}

/** 提交验证码。password 仅在「新账号注册」时需要（邮箱注册必须带密码） */
async function nativeVerifyEmailOtp(code, password) {
  if (!_pendingOtp) return { ok: false, reason: '请先获取验证码' };
  try {
    const done = await state.client.auth.verifyOtp({
      email: _pendingOtp.email,
      verificationId: _pendingOtp.verificationId,
      isExistingUser: _pendingOtp.isExistingUser,
      token: String(code || '').trim(),
      password: _pendingOtp.isExistingUser ? undefined : String(password || ''),
    });
    if (done.error) return { ok: false, reason: done.error.message || '验证失败' };
    const u = done.data && done.data.user;
    state.user = u ? { id: u.id, email: u.email || _pendingOtp.email } : null;
    _pendingOtp = null;
    return { ok: true, user: state.user };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
}

async function nativeSignOutCloud() {
  state.user = null;
  try { if (state.client) await state.client.auth.signOut(); } catch (e) { /* 忽略 */ }
  return { ok: true };
}

export async function signInWithPassword(email, password) {
  if (isNative()) return nativeSignInWithPassword(email, password);
  const r = await bridgeRpc('signInWithPassword', [email, password]);
  if (r && r.ok && r.user) state.user = r.user;
  return r || { ok: false, reason: '云服务不可用' };
}

export async function sendEmailOtp(email) {
  if (isNative()) return nativeSendEmailOtp(email);
  const em = String(email || '').trim();
  const r = await bridgeRpc('sendEmailOtp', [em]);
  if (r && r.ok) _pendingOtp = { email: em, verificationId: null, isExistingUser: !!(r && r.isExistingUser) };
  return r || { ok: false, reason: '云服务不可用' };
}

export async function verifyEmailOtp(code, password) {
  if (isNative()) return nativeVerifyEmailOtp(code, password);
  if (!_pendingOtp) return { ok: false, reason: '请先获取验证码' };
  const r = await bridgeRpc('verifyEmailOtp', [code, password]);
  if (r && r.ok) {
    state.user = (r && r.user) || null;
    _pendingOtp = null;
  }
  return r || { ok: false, reason: '云服务不可用' };
}

export function pendingOtpEmail() { return _pendingOtp ? _pendingOtp.email : null; }
export function pendingOtpIsNewUser() { return !!(_pendingOtp && _pendingOtp.isExistingUser); }

export async function signOutCloud() {
  if (isNative()) return nativeSignOutCloud();
  await bridgeRpc('signOutCloud');
  state.user = null;
  return { ok: true };
}

// ============================================================================
// 星系 registry（galaxy_planets：公开读 / 本人写）
// ============================================================================
function db() { return state.client ? state.client.database : null; }

/** 拉取全部公开星球快照（最多 100 条，按最近在线排序） */
export async function listPublicPlanets() {
  if (isNative()) {
    if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用', planets: [] };
    try {
      const { data, error } = await db().from('galaxy_planets')
        .select('*').order('last_seen', { ascending: false }).limit(100);
      if (error) return { ok: false, reason: error.message || '读取星系失败', planets: [] };
      return { ok: true, planets: Array.isArray(data) ? data : [] };
    } catch (e) { return { ok: false, reason: (e && e.message) || String(e), planets: [] }; }
  }
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用', planets: [] };
  return bridgeRpc('listPublicPlanets');
}

/** 发布 / 更新自己的殖民地快照（owner_id 由 RLS 默认 auth.uid() 填，绝不能手传） */
export async function publishMyPlanet(snapshot) {
  if (isNative()) {
    if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
    if (!state.user) return { ok: false, reason: '请先登录云账号' };
    try {
      // v0.2.10 修复：必须按 owner 过滤 —— 此前 select('id').limit(1) 会拿到别人的行，
      // 去更新它必被 RLS（owner_id = auth.uid()）拒绝 → 快照永远发布失败
      const mine = await db().from('galaxy_planets').select('id').eq('owner_id', state.user.id).limit(1);
      if (mine.error) return { ok: false, reason: mine.error.message || '读取自身快照失败' };
      const row = {
        owner_name: snapshot.ownerName || '深空旅人',
        planet_code: String(snapshot.planetCode || 'syl'),
        planet_name_cn: String(snapshot.planetNameCn || '母星'),
        faction: String(snapshot.faction || '开拓者'),
        summary: snapshot.summary || {},
        last_seen: new Date().toISOString(),
      };
      if (Array.isArray(mine.data) && mine.data.length > 0) {
        const up = await db().from('galaxy_planets').update(row).eq('id', mine.data[0].id).select();
        if (up.error) return { ok: false, reason: up.error.message || '更新快照失败' };
        if (!Array.isArray(up.data) || up.data.length === 0) return { ok: false, reason: '更新被拒绝（RLS）' };
        return { ok: true, updated: true };
      }
      const ins = await db().from('galaxy_planets').insert(Object.assign({ owner_id: state.user.id }, row)).select();
      if (ins.error) return { ok: false, reason: ins.error.message || '发布快照失败' };
      return { ok: true, created: true };
    } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
  }
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用' };
  return bridgeRpc('publishMyPlanet', [snapshot]);
}

// ============================================================================
// 事件邮箱（galaxy_incidents：target_uid 指向收件人）
//   type: 'attack'（进攻） | 'trade_offer'（贸易要约） | 'battle_report'（战报回执）
//         | 'trade_result'（贸易结算回执）
// ============================================================================
export async function postIncident(targetUid, type, payload) {
  if (isNative()) {
    if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
    if (!state.user) return { ok: false, reason: '请先登录云账号' };
    if (!targetUid) return { ok: false, reason: '缺少目标玩家' };
    try {
      const { data, error } = await db().from('galaxy_incidents')
        .insert({ target_uid: String(targetUid), type: String(type), payload: payload || {} })
        .select();
      if (error) return { ok: false, reason: error.message || '发送失败' };
      return { ok: true, incident: (Array.isArray(data) && data[0]) || null };
    } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
  }
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用' };
  return bridgeRpc('postIncident', [targetUid, type, payload]);
}

/** 我的收件箱：target_uid = 我 且 未处理 */
export async function fetchInbox() {
  if (isNative()) {
    if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用', items: [] };
    if (!state.user) return { ok: false, reason: '请先登录云账号', items: [] };
    try {
      const { data, error } = await db().from('galaxy_incidents')
        .select('*').eq('target_uid', state.user.id).eq('resolved', false)
        .order('created_at', { ascending: false }).limit(50);
      if (error) return { ok: false, reason: error.message || '读取收件箱失败', items: [] };
      return { ok: true, items: Array.isArray(data) ? data : [] };
    } catch (e) { return { ok: false, reason: (e && e.message) || String(e), items: [] }; }
  }
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用', items: [] };
  return bridgeRpc('fetchInbox');
}

/** 标记事件已处理（发件人与收件人都可以；RLS 双方放行） */
export async function markIncidentResolved(id) {
  if (isNative()) {
    if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
    try {
      const { data, error } = await db().from('galaxy_incidents')
        .update({ resolved: true }).eq('id', Number(id)).select();
      if (error) return { ok: false, reason: error.message || '更新失败' };
      if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: '更新被拒绝（RLS）' };
      return { ok: true };
    } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
  }
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用' };
  return bridgeRpc('markIncidentResolved', [id]);
}

// ============================================================================
// 全服共享商店星仓库（v0.2.10：shop_warehouse 表，所有登录玩家可读写）
//   * 在线模式下商店星仓库不再各自独立 —— 任何玩家的买卖都会增减同一个池子
//   * 读写模型：拉全量 + 按 mat upsert（read-modify-write，末写胜出；并发漂移对游戏可接受）
// ============================================================================
export async function fetchSharedWarehouse() {
  if (isNative()) {
    if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用', rows: [] };
    try {
      const { data, error } = await db().from('shop_warehouse').select('*').limit(500);
      if (error) return { ok: false, reason: error.message || '读取共享仓库失败', rows: [] };
      return { ok: true, rows: Array.isArray(data) ? data : [] };
    } catch (e) { return { ok: false, reason: (e && e.message) || String(e), rows: [] }; }
  }
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用', rows: [] };
  return bridgeRpc('fetchSharedWarehouse');
}

export async function upsertSharedWarehouseRow(mat, qty, price, base) {
  const m = String(mat || '');
  const q = Number(qty) || 0;
  if (!m) return { ok: false, reason: '缺少物资名' };
  // v0.2.12：同一行顺带存全服共享价格（price / base，可选）
  const patch = { qty: q, updated_at: new Date().toISOString() };
  if (price != null && Number(price) > 0) patch.price = Number(price);
  if (base != null && Number(base) > 0) patch.base = Number(base);
  if (isNative()) {
    if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
    try {
      const upd = await db().from('shop_warehouse').update(patch).eq('mat', m).select();
      if (upd.error) return { ok: false, reason: upd.error.message || '更新共享仓库失败' };
      if (Array.isArray(upd.data) && upd.data.length > 0) return { ok: true, updated: true };
      const ins = await db().from('shop_warehouse').insert(Object.assign({ mat: m }, patch)).select();
      if (ins.error) return { ok: false, reason: ins.error.message || '写入共享仓库失败' };
      return { ok: true, created: true };
    } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
  }
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用' };
  return bridgeRpc('upsertSharedWarehouseRow', [m, q, price || null, base || null]);
}

// ============================================================================
// 账号名登录（v0.2.10：不强制邮箱 —— 账号名映射为合成邮箱，密码注册 / 登录）
//   * 云后端身份是邮箱形：账号名 → 'p' + hash(账号名) + '@astrix.game'（对玩家透明）
//   * 同名账号哈希相同；登录失败（不存在）时 UI 侧自动走 signUp 注册再登录
// ============================================================================
export function astrixEmailOf(name) {
  const s = String(name || '').trim().toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'p' + h.toString(16) + '@astrix.game';
}

export async function signUpWithPassword(email, password) {
  if (isNative()) {
    if (!(await nativeEnsureReady()) || !state.client) return { ok: false, reason: state.error || '云服务不可用' };
    try {
      if (typeof state.client.auth.signUp !== 'function') return { ok: false, reason: '云服务暂不支持密码注册' };
      const { data, error } = await state.client.auth.signUp({ email: String(email || '').trim(), password: String(password || '') });
      if (error) return { ok: false, reason: error.message || '注册失败' };
      state.user = data && data.user ? { id: data.user.id, email: data.user.email || '' } : null;
      return { ok: true, user: state.user };
    } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
  }
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用' };
  return bridgeRpc('signUpWithPassword', [email, password]);
}

// ============================================================================
// 账号名登录 v2（v0.2.10 最终方案）：云服务商强制邮箱验证码注册，密码直注走不通 ——
//   改用 player_accounts 表自管账号：账号名 + 加盐 SHA-256，uid = 'n_' + hash(name) 前 16 位
//   * RLS 已放宽：n_* 身份可读写自己的快照 / 收发事件（见云端策略）
//   * 会话存 localStorage（astrix_nuid / astrix_nname），ensureReady 时恢复
// ============================================================================
function nameHashHex(s) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then((buf) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''));
  }
  // 兜底（无 crypto 环境）：双 djb2/FNV 拼接（仅探针用）
  let a = 5381, b = 52711;
  for (let i = 0; i < s.length; i++) {
    a = ((a << 5) + a + s.charCodeAt(i)) >>> 0;
    b = (((b << 7) + b) ^ s.charCodeAt(i)) >>> 0;
  }
  return Promise.resolve(a.toString(16) + b.toString(16));
}

export function nameUidOf(name) {
  return nameHashHex('astrix:uid:' + String(name || '').trim().toLowerCase()).then((h) => 'n_' + h.slice(0, 16));
}

function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) { /* 忽略 */ } }

/** 注册：账号名不存在 → 写入 player_accounts 并登录 */
async function nativeRegisterWithName(n, password) {
  if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
  try {
    const uid = await nameUidOf(n);
    const passhash = await nameHashHex('astrix:v1:' + n + ':' + password);
    // v0.2.12：账号名唯一性（大小写不敏感、忽略首尾空白）
    const norm = (x) => String(x || '').trim().toLowerCase();
    const dup = await db().from('player_accounts').select('name').limit(1000);
    if (dup.error) return { ok: false, reason: dup.error.message || '读取账号失败' };
    if (Array.isArray(dup.data) && dup.data.some((r) => norm(r.name) === norm(n))) {
      return { ok: false, reason: '账号名已存在（不区分大小写），请直接登录或换个名字' };
    }
    const ins = await db().from('player_accounts').insert({ name: n, passhash, uid }).select();
    if (ins.error) return { ok: false, reason: ins.error.message || '注册失败' };
    lsSet('astrix_nuid', uid); lsSet('astrix_nname', n);
    state.user = { id: uid, name: n };
    return { ok: true, user: state.user };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
}

export async function registerWithName(name, password) {
  const n = String(name || '').trim();
  if (n.length < 2) return { ok: false, reason: '账号名至少 2 个字符' };
  if (!password || String(password).length < 4) return { ok: false, reason: '密码至少 4 位' };
  if (isNative()) return nativeRegisterWithName(n, password);
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用' };
  const r = await bridgeRpc('registerWithName', [n, password]);
  if (r && r.ok && r.user) state.user = r.user;   // 父页缓存（bridge 会话存在桥的 localStorage）
  return r || { ok: false, reason: '云服务不可用' };
}

/** 登录：校验账号名 + 密码哈希 */
async function nativeLoginWithName(n, password) {
  if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
  try {
    // v0.2.12：登录也按大小写不敏感匹配（与注册口径一致）
    const q = await db().from('player_accounts').select('*').limit(1000);
    if (q.error) return { ok: false, reason: q.error.message || '读取账号失败' };
    const norm = (x) => String(x || '').trim().toLowerCase();
    const rows = Array.isArray(q.data) ? q.data : [];
    const row = rows.find((r) => norm(r.name) === norm(n));
    if (!row) return { ok: false, reason: '账号不存在' };
    const passhash = await nameHashHex('astrix:v1:' + n + ':' + password);
    if (row.passhash !== passhash) return { ok: false, reason: '密码错误' };
    lsSet('astrix_nuid', row.uid); lsSet('astrix_nname', n);
    state.user = { id: row.uid, name: n };
    return { ok: true, user: state.user };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
}

export async function loginWithName(name, password) {
  const n = String(name || '').trim();
  if (isNative()) return nativeLoginWithName(n, password);
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用' };
  const r = await bridgeRpc('loginWithName', [n, password]);
  if (r && r.ok && r.user) state.user = r.user;
  return r || { ok: false, reason: '云服务不可用' };
}

/** v0.2.12：只更新共享价格（不动 qty —— 避免与并发仓库写入互相覆盖） */
export async function upsertSharedPriceRow(mat, price, base) {
  const m = String(mat || '');
  const p = Number(price) || 0;
  if (!m || !(p > 0)) return { ok: false, reason: '缺少物资名或价格' };
  const patch = { price: p, updated_at: new Date().toISOString() };
  if (base != null && Number(base) > 0) patch.base = Number(base);
  if (isNative()) {
    if (!(await nativeEnsureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
    try {
      const upd = await db().from('shop_warehouse').update(patch).eq('mat', m).select();
      if (upd.error) return { ok: false, reason: upd.error.message || '更新共享价格失败' };
      return { ok: true, updated: Array.isArray(upd.data) && upd.data.length > 0 };
    } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
  }
  if (!(await bridgeEnsureReady())) return { ok: false, reason: state.error || '云服务不可用' };
  return bridgeRpc('upsertSharedPriceRow', [m, p, base || null]);
}
