const QUEUE_KEY = 'bmb_offline_sales_queue';

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function getOfflineQueue() {
  return readQueue();
}

export function getOfflineQueueCount() {
  return readQueue().length;
}

export function enqueueOfflineRequest(config) {
  const items = readQueue();
  items.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method: (config.method || 'post').toUpperCase(),
    url: config.url,
    data: config.data,
    params: config.params,
    created_at: new Date().toISOString(),
  });
  writeQueue(items);
  window.dispatchEvent(new CustomEvent('bmb-offline-queue-changed'));
  return items.length;
}

export function clearOfflineQueue() {
  writeQueue([]);
  window.dispatchEvent(new CustomEvent('bmb-offline-queue-changed'));
}

export async function flushOfflineQueue(api) {
  const items = readQueue();
  if (!items.length) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const remaining = [];

  for (const item of items) {
    try {
      await api.request({
        method: item.method.toLowerCase(),
        url: item.url,
        data: item.data,
        params: item.params,
      });
      flushed += 1;
    } catch {
      remaining.push(item);
      failed += 1;
    }
  }

  writeQueue(remaining);
  window.dispatchEvent(new CustomEvent('bmb-offline-queue-changed'));
  return { flushed, failed, remaining: remaining.length };
}

export function isSalesCartMutation(config) {
  const method = (config.method || 'get').toLowerCase();
  if (!['post', 'patch', 'put'].includes(method)) return false;
  const url = String(config.url || '');
  return /\/sales\/carts/.test(url);
}

export function isNetworkError(err) {
  return !err.response && (err.code === 'ERR_NETWORK' || err.message === 'Network Error');
}
