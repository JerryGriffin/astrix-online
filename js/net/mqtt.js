// Astrix · 零依赖 MQTT 3.1.1 over WebSocket 客户端
//
// 为什么需要它：HuggingFace 免费账号只能托管 Static Space（官方政策——运行计算型
// Space 需付费，`cpu-basic` 对免费账号配额为 0），因此公网联机不能再依赖
// server.mjs 提供的 /api/online/*。改为浏览器直连公共 MQTT 代理做实时广播，
// 站点保持纯静态、零服务端计算、零账号、零费用。
//
// 本模块只实现游戏所需的 MQTT 3.1.1 最小子集：
//   CONNECT / CONNACK、SUBSCRIBE / SUBACK、PUBLISH(QoS 0，支持 retain)、
//   PINGREQ / PINGRESP、DISCONNECT。
// 有意不实现：QoS 1/2 与重传、遗嘱消息、用户名/密码、UNSUBSCRIBE、MQTT 5 属性。
// 报文编解码全部自实现，不引入任何依赖（与项目「零依赖原生 ES 模块」一致）。
//
// 同时可在浏览器与 Node 中运行（依赖全局 WebSocket / TextEncoder / TextDecoder /
// crypto.getRandomValues —— Node 22 均原生具备），因此自检探针能直接复用本模块。

export const PACKET_TYPE = {
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  PUBACK: 4,
  SUBSCRIBE: 8,
  SUBACK: 9,
  UNSUBSCRIBE: 10,
  UNSUBACK: 11,
  PINGREQ: 12,
  PINGRESP: 13,
  DISCONNECT: 14,
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ---- 报文编解码 -------------------------------------------------------------

function utf8LengthPrefixed(str) {
  const bytes = textEncoder.encode(str);
  const out = new Uint8Array(bytes.length + 2);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function encodeRemainingLength(len) {
  const out = [];
  let value = len;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    out.push(byte);
  } while (value > 0);
  return Uint8Array.from(out);
}

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function buildPacket(type, flags, body) {
  const remaining = encodeRemainingLength(body.length);
  const header = Uint8Array.from([(type << 4) | flags]);
  return concatBytes([header, remaining, body]);
}

export function encodeConnect(clientId, keepAliveSec = 60) {
  const variableHeader = Uint8Array.from([
    0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, // 协议名 "MQTT"
    0x04,                               // 协议级别 4 = MQTT 3.1.1
    0x02,                               // 连接标志：仅 cleanSession=1（无遗嘱/无认证）
    (keepAliveSec >> 8) & 0xff,
    keepAliveSec & 0xff,
  ]);
  return buildPacket(PACKET_TYPE.CONNECT, 0, concatBytes([variableHeader, utf8LengthPrefixed(clientId)]));
}

export function encodeSubscribe(topicFilter, packetId) {
  const body = concatBytes([
    Uint8Array.from([(packetId >> 8) & 0xff, packetId & 0xff]),
    utf8LengthPrefixed(topicFilter),
    Uint8Array.from([0x00]), // 请求 QoS 0
  ]);
  return buildPacket(PACKET_TYPE.SUBSCRIBE, 0x02, body);
}

export function encodePublish(topic, payload, retain = false) {
  const data = typeof payload === 'string' ? textEncoder.encode(payload) : payload;
  const body = concatBytes([utf8LengthPrefixed(topic), data]);
  return buildPacket(PACKET_TYPE.PUBLISH, retain ? 0x01 : 0x00, body);
}

export function encodePingReq() {
  return Uint8Array.from([(PACKET_TYPE.PINGREQ << 4) | 0, 0x00]);
}

export function encodeDisconnect() {
  return Uint8Array.from([(PACKET_TYPE.DISCONNECT << 4) | 0, 0x00]);
}

// 增量解析：返回本次能完整解析出的报文数组，以及尚未消费的剩余字节。
// 必须支持跨 WebSocket 帧拼接（代理可能合并/拆分 MQTT 报文）。
export function decodePackets(buffer) {
  const packets = [];
  let view = buffer;
  for (;;) {
    if (view.length < 2) break;
    const type = view[0] >> 4;
    const flags = view[0] & 0x0f;

    let multiplier = 1;
    let remaining = 0;
    let index = 1;
    let byte;
    do {
      if (index >= view.length) return { packets, rest: view }; // 长度字段还没收全
      byte = view[index++];
      remaining += (byte & 0x7f) * multiplier;
      multiplier *= 128;
      if (multiplier > 128 * 128 * 128) throw new Error('MQTT 剩余长度字段非法');
    } while (byte & 0x80);

    const total = index + remaining;
    if (view.length < total) return { packets, rest: view }; // 载荷还没收全

    const body = view.subarray(index, total);
    view = view.subarray(total);

    if (type === PACKET_TYPE.PUBLISH) {
      const topicLen = (body[0] << 8) | body[1];
      const topic = textDecoder.decode(body.subarray(2, 2 + topicLen));
      const qos = (flags >> 1) & 0x03;
      const payloadStart = 2 + topicLen + (qos > 0 ? 2 : 0);
      packets.push({
        type,
        topic,
        payload: body.subarray(payloadStart),
        retain: (flags & 0x01) === 1,
      });
    } else if (type === PACKET_TYPE.CONNACK) {
      packets.push({ type, returnCode: body[1] });
    } else if (type === PACKET_TYPE.SUBACK) {
      packets.push({ type, packetId: (body[0] << 8) | body[1] });
    } else {
      packets.push({ type });
    }
  }
  return { packets, rest: view };
}

// ---- 连接客户端 -------------------------------------------------------------

const CONNACK_TEXT = {
  1: '不支持的协议版本',
  2: '客户端标识被拒绝',
  3: '服务端不可用',
  4: '用户名或密码错误',
  5: '未授权',
};

// 单个代理的连接超时：某些网络（含部分 Windows 防火墙策略）对不可达地址是「静默丢包」
// 而不是回 RST，此时 WebSocket 既不 open 也不 close，若无超时就会永久卡在第一个代理上。
const CONNECT_TIMEOUT_MS = 12000;

export function randomToken(bytes = 8) {
  const arr = new Uint8Array(bytes);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 创建一个带自动重连与代理故障切换的 MQTT 客户端。
 *
 * @param {object} opts
 * @param {string[]} opts.brokers        候选代理 WSS 地址，按顺序尝试
 * @param {(topic:string, text:string)=>void} opts.onMessage  收到消息
 * @param {(state:string, detail:object)=>void} [opts.onStatus] 连接状态变化
 * @param {number} [opts.keepAliveSec=60]
 */
export function createMqttClient(opts) {
  const brokers = (opts.brokers || []).slice();
  const onMessage = opts.onMessage || (() => {});
  const onStatus = opts.onStatus || (() => {});
  const keepAliveSec = opts.keepAliveSec || 60;
  const clientId = opts.clientId || `astrix-${randomToken(6)}`;

  let socket = null;
  let buffer = new Uint8Array(0);
  let socketEstablished = false; // 本次 socket 是否已收到 CONNACK（决定失败后是轮换还是原地重连）
  let brokerIndex = 0;
  let packetId = 0;
  let attempt = 0;
  let closedByUser = false;
  let state = 'idle';
  let pingTimer = null;
  let pongTimer = null;
  let reconnectTimer = null;
  let connectTimer = null;
  let watchers = new Set();
  const subscriptions = new Map(); // filter -> { _id: number }

  function setState(next, detail) {
    state = next;
    onStatus(next, detail || {});
  }

  function nextPacketId() {
    packetId = packetId >= 65535 ? 1 : packetId + 1;
    return packetId;
  }

  function send(bytes) {
    if (socket && socket.readyState === 1) {
      socket.send(bytes);
      return true;
    }
    return false;
  }

  function clearTimers() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
  }

  // rotate=true 时轮换到下一个代理。仅用于「连都没连上」的失败：
  // 若是已建立后被断开，则原地重连 —— 不同代理拥有各自独立的世界，
  // 随意轮换会把玩家打散到不同世界里。
  function scheduleReconnect(reason, rotate = true) {
    if (closedByUser || reconnectTimer) return;
    if (rotate) brokerIndex = (brokerIndex + 1) % Math.max(1, brokers.length);
    const delay = Math.min(20000, 800 * Math.pow(2, Math.min(attempt, 4))) + Math.floor(Math.random() * 400);
    attempt++;
    setState('reconnecting', { reason, delay, broker: brokers[brokerIndex] });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function handlePackets() {
    let result;
    try {
      result = decodePackets(buffer);
    } catch (e) {
      // 报文损坏无法恢复，直接断开重连（cleanSession 保证不会读到半截状态）
      setState('error', { reason: 'MQTT 报文解析失败: ' + e.message });
      try { socket && socket.close(); } catch (e2) { /* ignore */ }
      return;
    }
    buffer = result.rest;

    for (const pkt of result.packets) {
      if (pkt.type === PACKET_TYPE.PUBLISH) {
        let text = '';
        try {
          text = textDecoder.decode(pkt.payload);
        } catch (e) { /* 非 UTF-8 载荷忽略 */ }
        onMessage(pkt.topic, text, pkt.retain);
      } else if (pkt.type === PACKET_TYPE.PINGRESP) {
        if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
      } else if (pkt.type === PACKET_TYPE.CONNACK) {
        if (pkt.returnCode !== 0) {
          setState('error', { reason: CONNACK_TEXT[pkt.returnCode] || ('CONNACK ' + pkt.returnCode) });
          try { socket && socket.close(); } catch (e) { /* ignore */ }
          return;
        }
        attempt = 0;
        socketEstablished = true;
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
        setState('connected', { broker: brokers[brokerIndex], clientId });        // 重连后必须重新订阅（cleanSession=1 会丢弃服务端的订阅关系）
        for (const filter of subscriptions.keys()) {
          send(encodeSubscribe(filter, nextPacketId()));
        }
        startPing();
        // 通知外部「已连上，可重放订阅/请求快照」
        for (const w of watchers) {
          try { w(); } catch (e) { /* ignore */ }
        }
      }
    }
  }

  function startPing() {
    if (pingTimer) clearInterval(pingTimer);
    const intervalMs = Math.max(5000, (keepAliveSec * 1000) / 2);
    pingTimer = setInterval(() => {
      if (!send(encodePingReq())) return;
      // 保活探测：PINGREQ 发出后 10 秒仍无 PINGRESP 视为链路已死。
      if (!pongTimer) {
        pongTimer = setTimeout(() => {
          pongTimer = null;
          setState('error', { reason: '保活超时（无 PINGRESP）' });
          try { socket && socket.close(); } catch (e) { /* ignore */ }
        }, 10000);
      }
    }, intervalMs);
  }

  function connect() {
    if (closedByUser || brokers.length === 0) return;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;

    const url = brokers[brokerIndex];
    setState(attempt === 0 ? 'connecting' : 'reconnecting', { broker: url });
    let ws;
    try {
      ws = new WebSocket(url, ['mqtt']);
    } catch (e) {
      setState('error', { reason: '无法建立 WebSocket: ' + e.message, broker: url });
      scheduleReconnect('construct-failed');
      return;
    }
    socket = ws;
    ws.binaryType = 'arraybuffer';
    socketEstablished = false;

    // 统一的失败出口。存在的理由：实测（Windows / undici）对不可达代理发起的
    // WebSocket 会触发 error 但**从不触发 close**，若把重连只挂在 close 上，
    // 客户端会永久卡在第一个代理上。因此所有失败路径都收敛到这里，并保证只执行一次。
    let failed = false;
    const fail = (reason, extra) => {
      if (failed) return;
      failed = true;
      if (socket === ws) socket = null;
      clearTimers();
      try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; } catch (e) { /* ignore */ }
      try { ws.close(); } catch (e) { /* ignore */ }
      setState('error', { reason, broker: url, ...(extra || {}) });
      scheduleReconnect(reason, !socketEstablished);
    };

    // 连接超时：未在限时内收到 CONNACK 就主动断开并轮换代理，避免卡死。
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      connectTimer = null;
      fail('连接超时（未收到 CONNACK）');
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      buffer = new Uint8Array(0);
      if (!send(encodeConnect(clientId, keepAliveSec))) fail('CONNECT 发送失败');
    };
    ws.onmessage = (event) => {
      const data = event.data;
      let chunk;
      if (data instanceof ArrayBuffer) chunk = new Uint8Array(data);
      else if (data && data.buffer instanceof ArrayBuffer) chunk = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      else return;
      buffer = buffer.length === 0 ? chunk : concatBytes([buffer, chunk]);
      handlePackets();
    };
    ws.onerror = () => {
      fail('WebSocket 错误');
    };
    ws.onclose = (event) => {
      if (closedByUser) {
        clearTimers();
        if (socket === ws) socket = null;
        setState('closed', { code: event && event.code });
        return;
      }
      fail('closed:' + (event && event.code));
    };
  }

  return {
    connect() {
      closedByUser = false;
      attempt = 0;
      connect();
    },
    subscribe(filter) {
      if (!subscriptions.has(filter)) subscriptions.set(filter, true);
      if (state === 'connected') send(encodeSubscribe(filter, nextPacketId()));
    },
    publish(topic, payload, retain = false) {
      return send(encodePublish(topic, payload, retain));
    },
    /** 连接建立（含重连）时回调，用于重放「握手」类动作，如请求世界快照。 */
    onConnected(fn) {
      watchers.add(fn);
      if (state === 'connected') { try { fn(); } catch (e) { /* ignore */ } }
      return () => watchers.delete(fn);
    },
    close() {
      closedByUser = true;
      clearTimers();
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      const ws = socket;
      socket = null;
      if (ws) {
        try { ws.send(encodeDisconnect()); } catch (e) { /* ignore */ }
        try { ws.close(); } catch (e) { /* ignore */ }
      }
      setState('closed', {});
    },
    getState() { return state; },
    getClientId() { return clientId; },
    getBroker() { return brokers[brokerIndex]; },
  };
}
