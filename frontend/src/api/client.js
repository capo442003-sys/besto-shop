import axios from 'axios';
import { getToken, clearAuth } from '../utils/authStorage';
import { getApiBaseUrl } from '../config/api';
import {
  enqueueOfflineRequest,
  flushOfflineQueue,
  isNetworkError,
  isSalesCartMutation,
} from '../utils/offlineQueue';

const api = axios.create({
  baseURL: getApiBaseUrl(),
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const config = err.config;
    if (config && isNetworkError(err) && isSalesCartMutation(config) && !config.__offlineQueued) {
      enqueueOfflineRequest(config);
      return Promise.reject(Object.assign(new Error('Hors ligne — opération mise en file'), { offlineQueued: true }));
    }
    if (err.response?.status === 401) {
      clearAuth();
      if (!window.location.pathname.includes('/login')) {
        window.location.replace('/login');
      }
    }
    return Promise.reject(err);
  }
);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushOfflineQueue(api).catch(() => {});
  });
}

export default api;
