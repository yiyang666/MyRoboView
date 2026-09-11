import { getApiBaseUrl, getWebSocketUrl } from './apiConfig';

const TOKEN_KEY = 'roboview.jwt';

export function getStoredToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function apiUrl(path) {
  let p = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  if (!base) return p;
  return `${base}${p}`;
}

/**
 * 与 fetch 相同，自动附带 Authorization，401 时清理 token 并派发 roboview:auth-expired。
 */
export async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(path), { ...options, headers });
  if (res.status === 401) {
    clearStoredToken();
    window.dispatchEvent(new CustomEvent('roboview:auth-expired'));
  }
  return res;
}

/** WebSocket 地址附带 JWT（与后端约定 query: token） */
export function getWebSocketUrlWithAuth() {
  const base = getWebSocketUrl();
  const token = getStoredToken();
  if (!token) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}
