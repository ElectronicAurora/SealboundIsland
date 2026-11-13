#!/usr/bin/env node
/* ============================================================
 * 末环协议 · 局域网联机中转服务器
 * RingFall Protocol — LAN Relay Server
 *
 * 用法：
 *   1) npm install ws
 *   2) node server.js            （默认端口 8080，可用 PORT=xxxx 覆盖）
 *   3) 房主浏览器打开 http://localhost:8080/  （或直接双击 index.html）
 *
 * 这个进程做两件事：
 *   · 静态托管同目录下的游戏文件（队友不用再传文件，直接开网址）
 *   · WebSocket 中转：房主 ⇄ 客户端 的双向消息，不做任何游戏逻辑
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const MAX_CLIENTS = 5;          // 房主 + 5 位队友 = 6 人上限（本作支持 2-6 人）

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip':  'application/zip',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (_) { res.writeHead(400); return res.end('bad request'); }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 文件不存在：' + urlPath); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

/* ---------------- WebSocket 中转 ---------------- */
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 });

let hostConn = null;            // 房主连接
const clients = [];             // [{ seat, conn, name }]

const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const log = (...a) => console.log('[' + stamp() + ']', ...a);

function send(conn, obj) {
  if (conn && conn.readyState === 1) {
    try { conn.send(JSON.stringify(obj)); } catch (e) { /* 忽略单条发送失败 */ }
  }
}
function broadcastClients(obj, except) {
  clients.forEach(c => { if (c.conn !== except) send(c.conn, obj); });
}
function usedSeats() { return clients.map(c => c.seat); }
function nextSeat() {
  for (let s = 1; s <= MAX_CLIENTS; s++) if (usedSeats().indexOf(s) < 0) return s;
  return -1;
}

wss.on('connection', (ws) => {
  ws._role = null;
  ws._seat = -1;

  ws.on('message', (raw) => {
    /* ★ ws v8 起，message 回调拿到的是 Buffer（文本帧也一样）。
       直接把它转发出去会变成「二进制帧」，浏览器端 e.data 是 Blob，
       JSON.parse(Blob) 会抛错并被静默吞掉 —— 所以必须先转回字符串。 */
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');

    let m;
    try { m = JSON.parse(text); } catch (_) { return; }      // 非 JSON 一律丢弃
    if (!m || typeof m !== 'object') return;

    /* ---- 握手 ---- */
    if (m.t === 'hello') {
      if (m.role === 'host') {
        if (hostConn && hostConn.readyState === 1) {
          send(ws, { t: 'err', msg: '这台服务器上已经有房主了。请让原房主关掉，或换一个端口启动。' });
          return ws.close();
        }
        hostConn = ws;
        ws._role = 'host';
        send(ws, { t: 'host_ok', seats: usedSeats() });
        log('房主已就位（当前队友 ' + clients.length + ' 人）');
        return;
      }
      if (m.role === 'client') {
        if (!hostConn || hostConn.readyState !== 1) {
          send(ws, { t: 'err', msg: '房主还没开房，请稍后再连。' });
          return ws.close();
        }
        const seat = nextSeat();
        if (seat < 0) {
          send(ws, { t: 'err', msg: '房间已满（最多 6 人）。' });
          return ws.close();
        }
        ws._role = 'client';
        ws._seat = seat;
        const name = (typeof m.name === 'string' && m.name.slice(0, 12)) || ('玩家 ' + (seat + 1));
        clients.push({ seat, conn: ws, name });
        send(ws, { t: 'joined', seat, name });
        send(hostConn, { t: 'peer_join', seat, name });
        log('队友加入：座位 ' + (seat + 1) + '（' + name + '），当前 ' + clients.length + ' 人');
        return;
      }
      return;
    }

    /* ---- 已识别身份后：纯转发 ---- */
    if (ws._role === 'host') {
      /* 房主 → 所有客户端（状态快照 / 面板 / 结算） */
      broadcastClients(Object.assign({}, m));
      return;
    }
    if (ws._role === 'client') {
      /* 客户端 → 房主（把座位号补上，房主据此校验操作权） */
      if (!hostConn || hostConn.readyState !== 1) return;
      const out = Object.assign({}, m);
      out.seat = ws._seat;
      send(hostConn, out);
      return;
    }
  });

  ws.on('close', () => {
    if (ws === hostConn) {
      hostConn = null;
      log('房主断开，通知所有队友');
      broadcastClients({ t: 'host_gone' });
    }
    const i = clients.findIndex(c => c.conn === ws);
    if (i >= 0) {
      const seat = clients[i].seat;
      clients.splice(i, 1);
      send(hostConn, { t: 'peer_leave', seat });
      log('队友离开：座位 ' + (seat + 1) + '，剩余 ' + clients.length + ' 人');
    }
  });

  ws.on('error', () => { /* 连接级错误忽略，交给 close 处理 */ });
});

/* ---------------- 启动 ---------------- */
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(k => {
    (nets[k] || []).forEach(n => {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    });
  });
  return out;
}

server.listen(PORT, () => {
  const ips = lanAddresses();
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║  末环协议 · 局域网联机中转服务器                 ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('  房主：浏览器打开   http://localhost:' + PORT + '/');
  if (ips.length) {
    console.log('  队友：浏览器打开   http://' + ips[0] + ':' + PORT + '/');
    if (ips.length > 1) console.log('        （本机其它网卡：' + ips.slice(1).map(a => 'http://' + a + ':' + PORT + '/').join('  ') + '）');
  } else {
    console.log('  队友：把本机局域网 IP 拼成 http://<IP>:' + PORT + '/');
  }
  console.log('');
  console.log('  也可以直接双击 index.html 打开游戏，');
  console.log('  在开局面板点「作为房主开始」/「加入房间…」，地址填 ws://<房主IP>:' + PORT);
  console.log('');
  console.log('  按 Ctrl+C 停止服务器。');
  console.log('');
});
