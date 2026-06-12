const BC = new BroadcastChannel('multichat_sw');
const DB_NAME = 'sw_schedules';
const STORE   = 'timers';

// 打开 IndexedDB 存储计划表
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}
async function getSchedules() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const all = [];
    tx.objectStore(STORE).openCursor().onsuccess = e => {
      const cur = e.target.result;
      if (cur) { all.push(cur.value); cur.continue(); }
      else res(all);
    };
    tx.onerror = () => rej();
  });
}
async function saveSchedule(item) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = res; tx.onerror = rej;
  });
}
async function deleteSchedule(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res; tx.onerror = rej;
  });
}

// 检查并触发到期的通知
async function checkSchedules() {
  const now = Date.now();
  const items = await getSchedules();
  for (const item of items) {
    if (item.fireAt <= now) {
      await deleteSchedule(item.id);
      // 通知页面（如果打开着）
      BC.postMessage({ type: 'fire', chatId: item.chatId, name: item.name, text: item.text, avatar: item.avatar });
      // 弹出系统通知
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      const pageOpen = clients.some(c => c.visibilityState === 'visible');
      if (!pageOpen) {
        self.registration.showNotification(item.name || '消息', {
          body: item.text || '...',
          icon: item.avatar || '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'multichat_' + item.chatId,
          renotify: true,
          data: { chatId: item.chatId }
        });
      }
    }
  }
}

// 每分钟检查一次
setInterval(checkSchedules, 60 * 1000);
// 安装后立即检查一次
self.addEventListener('install',  () => { self.skipWaiting(); checkSchedules(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); checkSchedules(); });

// 接收来自页面的消息
self.addEventListener('message', async e => {
  if (e.data?.type === 'schedule') {
    await saveSchedule(e.data.item);
  } else if (e.data?.type === 'cancel') {
    await deleteSchedule(e.data.id);
  } else if (e.data?.type === 'cancelAll') {
    const items = await getSchedules();
    for (const i of items) await deleteSchedule(i.id);
  } else if (e.data?.type === 'ping') {
    e.source && e.source.postMessage({ type: 'pong' });
  }
});

// 点击通知：打开/聚焦页面
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const chatId = e.notification.data?.chatId;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        const c = clients[0];
        c.focus();
        c.postMessage({ type: 'openChat', chatId });
      } else {
        self.clients.openWindow('./?chatId=' + chatId);
      }
    })
  );
});
