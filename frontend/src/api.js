const DEFAULT_HTTP_API_BASE = "http://localhost:8000";
const TOKEN_STORAGE_KEY = "cipherpay_auth_token";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_HTTP_API_BASE;

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

export function getAuthToken() {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAuthToken(token) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearAuthToken() {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(apiUrl(path), {
    ...options,
    headers,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthToken();
    }
    throw new Error(payload?.detail || payload?.message || `Request failed: ${response.status}`);
  }

  return payload;
}

export function wsUrl() {
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol.replace("http", "ws");
  return `${url.toString().replace(/\/$/, "")}/ws`;
}

export async function login(username, password) {
  const result = await apiRequest("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setAuthToken(result.token);
  return result;
}

export async function logout() {
  try {
    await apiRequest("/api/v1/auth/logout", { method: "POST" });
  } finally {
    clearAuthToken();
  }
}

export function fetchCurrentUser() {
  return apiRequest("/api/v1/auth/me");
}

export function fetchOverview() {
  return apiRequest("/api/v1/system/overview");
}

export function setNetworkMode(mode) {
  return apiRequest("/utils/network/mode", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function submitTransfer(payload) {
  return apiRequest("/api/v1/payments/transfer", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetSystem() {
  return apiRequest("/api/v1/admin/system/reset", { method: "POST" });
}

export function resetLedger(useCurrentBalances = true) {
  return apiRequest("/api/v1/admin/ledger/reset", {
    method: "POST",
    body: JSON.stringify({ use_current_balances: useCurrentBalances }),
  });
}

export function recoverLedger(useCurrentBalances = true) {
  return apiRequest("/api/v1/ledger/recover", {
    method: "POST",
    body: JSON.stringify({ use_current_balances: useCurrentBalances }),
  });
}

export function continueLedger(reason = "Operator started a continuity ledger after tamper detection.") {
  return apiRequest("/api/v1/ledger/continue", {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function updateBalance(userId, balance, reanchorLedger = true) {
  return apiRequest(`/api/v1/admin/users/${userId}/balance`, {
    method: "PATCH",
    body: JSON.stringify({
      balance,
      reanchor_ledger: reanchorLedger,
    }),
  });
}

export function clearHistory() {
  return apiRequest("/api/v1/admin/history/clear", { method: "POST" });
}

export function applyScenario(scenarioId) {
  return apiRequest(`/api/v1/admin/scenarios/${scenarioId}/apply`, { method: "POST" });
}

export function resetAttackEngine(clearLogs = true, disableAttacks = true) {
  return apiRequest("/api/v1/admin/attacks/reset", {
    method: "POST",
    body: JSON.stringify({ clear_logs: clearLogs, disable_attacks: disableAttacks }),
  });
}

export function toggleAttack(attackId, state) {
  return apiRequest(`/api/v1/admin/attacks/${attackId}`, {
    method: "POST",
    body: JSON.stringify({ state }),
  });
}

export function triggerInsiderAttack(userId) {
  return apiRequest("/api/v1/admin/attacks/insider/apply", {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export function tamperLedger(blockIndex, txIndex, newAmount) {
  return apiRequest("/api/v1/ledger/tamper", {
    method: "POST",
    body: JSON.stringify({
      block_index: blockIndex,
      tx_index: txIndex,
      new_amount: newAmount,
    }),
  });
}
