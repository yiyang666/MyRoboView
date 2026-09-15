export const apiFetch = (path, options) => fetch(path, { cache: 'no-store', ...options });
export async function apiJson(path, data, method) {
  const response = await apiFetch(path, {
    method: method || (data === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
  return result;
}
