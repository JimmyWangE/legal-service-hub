// 登录凭证保存在 sessionStorage：刷新页面不掉线，关闭标签页即失效
const STORAGE_KEY = "legal-session";
let accessToken = "";
let currentUser = null;

function persist() {
  try {
    if (accessToken) globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify({ access_token: accessToken, user: currentUser }));
    else globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch { /* 存储不可用时仅保留内存会话 */ }
}

try {
  const saved = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE_KEY) || "null");
  if (saved?.access_token && saved.user) ({ access_token: accessToken, user: currentUser } = saved);
} catch { /* 损坏的存储内容直接忽略 */ }

export function setSession(session) {
  accessToken = session.access_token || "";
  currentUser = session.user || null;
  persist();
}

export function getAccessToken() {
  return accessToken;
}

export function getCurrentUser() {
  return currentUser;
}

export function updateCurrentUser(user) {
  currentUser = user;
  persist();
}

export function clearSession() {
  accessToken = "";
  currentUser = null;
  persist();
}
