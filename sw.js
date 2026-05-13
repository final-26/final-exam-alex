const DB_NAME = 'exam-notifications-db';
const DB_VERSION = 1;
const STORE_NAME = 'scheduled-exams';
const SYNC_TAG = 'exam-notification-check';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).finally(() => db.close());
}

function getAllScheduled() {
  return withStore('readonly', store => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  }));
}

function saveSchedule(schedule) {
  return withStore('readwrite', store => store.put(schedule));
}

function removeSchedule(key) {
  return withStore('readwrite', store => store.delete(key));
}

function getDaysRemaining(examTs) {
  return Math.max(0, Math.floor((examTs - Date.now()) / 86400000));
}

function getReminderBody(schedule, days) {
  const dayText = days > 0 ? `${days} من الأيام` : 'أقل من يوم';
  return `متنساش انه باقي ${dayText} على امتحان ${schedule.subject}`;
}

async function checkSchedules() {
  const schedules = await getAllScheduled();

  await Promise.all(schedules.map(async schedule => {
    if (!schedule.active) return;

    const days = getDaysRemaining(schedule.examTs);
    if (days < schedule.lastDays) {
      await self.registration.showNotification(schedule.studentName, {
        body: getReminderBody(schedule, days),
        tag: schedule.key,
        renotify: true,
        icon: 'hacker.png',
        badge: 'hacker.png'
      });
      await saveSchedule({ ...schedule, lastDays: days });
    }
  }));
}

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim().then(checkSchedules));
});

self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  if (type === 'UPSERT_EXAM_NOTIFICATION' && payload) {
    event.waitUntil(saveSchedule(payload).then(checkSchedules));
  }

  if (type === 'REMOVE_EXAM_NOTIFICATION' && payload && payload.key) {
    event.waitUntil(removeSchedule(payload.key));
  }
});

self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(checkSchedules());
  }
});

self.addEventListener('periodicsync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(checkSchedules());
  }
});


function getPushPayload(event) {
  if (!event.data) return {};

  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener('push', event => {
  const payload = getPushPayload(event);
  const title = payload.title || payload.studentName || 'Exam Reminder';
  const options = {
    body: payload.body || (payload.subject ? `متنساش امتحان ${payload.subject}` : 'متنساش تراجع جدول امتحاناتك'),
    tag: payload.tag || payload.key || 'exam-reminder',
    renotify: true,
    icon: payload.icon || 'hacker.png',
    badge: payload.badge || 'hacker.png',
    data: payload.url || './'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('./f-index.html'));
});
