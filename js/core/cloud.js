// 云服务封装（Astrix v0.2.0）
// WorkBuddy Cloud Service（对标 Supabase）：邮箱认证 + 星系 registry + 跨玩家事件邮箱。
//
// 【加载策略】SDK（CDN IIFE 全局 WorkBuddyCloud）**按需懒加载**：
//   * main.js 启动期不碰本模块的网络加载 —— CDN 不可达绝不能拖垮游戏启动
//     （启动守卫只接管 boot 完成前的资源错误，懒加载发生在 boot 完成之后）。
//   * 首次打开「星际」页或点登录时 ensureReady()。
// 【publicConfig】endpoint + publishableKey 属 public 值（服务端按 Origin 校验鉴权），
//   零构建项目无注入通道，按云服务技能约定直接进源码；不得写入任何私密 key。
// 【RLS 模型】
//   galaxy_planets  公开读 / 本人写（owner_id = auth.uid()）
//   galaxy_incidents 发件人写 / 收件人+发件人读 / 双方均可标记 resolved
//   → 「打别人 / 贸易别人」= 插入一条 target_uid 指向对方的事件；
//     对方上线后在收件箱本地结算，并把回执（战报/贸易结算）作为新事件发回。

const CLOUD_ENDPOINT = 'https://astrix.app.workbuddy.host';
const CLOUD_PUBLISHABLE_KEY = 'wbpk_a83qn1S1YtnqmhL6Wb2oF3_dIuTVZ1qLa1Ph94JTqQhmspVf2q27z14';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';

const state = {
  status: 'idle',          // idle | loading | ready | error
  error: null,
  client: null,
  user: null,              // { id, email }（登录后）
};

let _loadPromise = null;

function loadSdkOnce() {
  if (window.WorkBuddyCloud) return Promise.resolve(true);
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve(!!window.WorkBuddyCloud);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
    // 15s 超时兜底（CDN 挂起时不无限等待）
    setTimeout(() => resolve(!!window.WorkBuddyCloud), 15000);
  });
  return _loadPromise;
}

/** 初始化（幂等）：加载 SDK → 建 client → 恢复会话。resolve(true)=可用 */
export async function ensureReady() {
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
    state.status = 'ready';
    return true;
  } catch (e) {
    state.status = 'error';
    state.error = (e && e.message) ? e.message : String(e);
    return false;
  }
}

export function cloudStatus() { return { status: state.status, error: state.error, user: state.user }; }
export function cloudUser() { return state.user; }
export function isCloudReady() { return state.status === 'ready'; }

// ============================================================================
// 认证（Web = 邮箱：密码登录 / 邮箱验证码 登录+注册）
// ============================================================================
export async function signInWithPassword(email, password) {
  if (!(await ensureReady()) || !state.client) return { ok: false, reason: state.error || '云服务不可用' };
  try {
    const { data, error } = await state.client.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
    if (error) return { ok: false, reason: error.message || '登录失败' };
    state.user = data && data.user ? { id: data.user.id, email: data.user.email || '' } : null;
    return { ok: true, user: state.user };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
}

// ---- 邮箱验证码（登录或注册共用；注册需附密码）----
let _pendingOtp = null;   // { email, verificationId, isExistingUser }

export async function sendEmailOtp(email) {
  if (!(await ensureReady()) || !state.client) return { ok: false, reason: state.error || '云服务不可用' };
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
export async function verifyEmailOtp(code, password) {
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

export function pendingOtpEmail() { return _pendingOtp ? _pendingOtp.email : null; }
export function pendingOtpIsNewUser() { return !!(_pendingOtp && _pendingOtp.isExistingUser); }

export async function signOutCloud() {
  state.user = null;
  try { if (state.client) await state.client.auth.signOut(); } catch (e) { /* 忽略 */ }
  return { ok: true };
}

// ============================================================================
// 星系 registry（galaxy_planets：公开读 / 本人写）
// ============================================================================
function db() { return state.client ? state.client.database : null; }

/** 拉取全部公开星球快照（最多 100 条，按最近在线排序） */
export async function listPublicPlanets() {
  if (!(await ensureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用', planets: [] };
  try {
    const { data, error } = await db().from('galaxy_planets')
      .select('*').order('last_seen', { ascending: false }).limit(100);
    if (error) return { ok: false, reason: error.message || '读取星系失败', planets: [] };
    return { ok: true, planets: Array.isArray(data) ? data : [] };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e), planets: [] }; }
}

/** 发布 / 更新自己的殖民地快照（owner_id 由 RLS 默认 auth.uid() 填，绝不能手传） */
export async function publishMyPlanet(snapshot) {
  if (!(await ensureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
  if (!state.user) return { ok: false, reason: '请先登录云账号' };
  try {
    const mine = await db().from('galaxy_planets').select('id').limit(1);
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
    const ins = await db().from('galaxy_planets').insert(row).select();
    if (ins.error) return { ok: false, reason: ins.error.message || '发布快照失败' };
    return { ok: true, created: true };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
}

// ============================================================================
// 事件邮箱（galaxy_incidents：target_uid 指向收件人）
//   type: 'attack'（进攻） | 'trade_offer'（贸易要约） | 'battle_report'（战报回执）
//         | 'trade_result'（贸易结算回执）
// ============================================================================
export async function postIncident(targetUid, type, payload) {
  if (!(await ensureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
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

/** 我的收件箱：target_uid = 我 且 未处理 */
export async function fetchInbox() {
  if (!(await ensureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用', items: [] };
  if (!state.user) return { ok: false, reason: '请先登录云账号', items: [] };
  try {
    const { data, error } = await db().from('galaxy_incidents')
      .select('*').eq('target_uid', state.user.id).eq('resolved', false)
      .order('created_at', { ascending: false }).limit(50);
    if (error) return { ok: false, reason: error.message || '读取收件箱失败', items: [] };
    return { ok: true, items: Array.isArray(data) ? data : [] };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e), items: [] }; }
}

/** 标记事件已处理（发件人与收件人都可以；RLS 双方放行） */
export async function markIncidentResolved(id) {
  if (!(await ensureReady()) || !db()) return { ok: false, reason: state.error || '云服务不可用' };
  try {
    const { data, error } = await db().from('galaxy_incidents')
      .update({ resolved: true }).eq('id', Number(id)).select();
    if (error) return { ok: false, reason: error.message || '更新失败' };
    if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: '更新被拒绝（RLS）' };
    return { ok: true };
  } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
}
