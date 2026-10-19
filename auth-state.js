let accessToken = "";
let currentUser = null;

export function setSession(session) {
  accessToken = session.access_token || "";
  currentUser = session.user || null;
}

export function getAccessToken() {
  return accessToken;
}

export function getCurrentUser() {
  return currentUser;
}

export function updateCurrentUser(user) {
  currentUser = user;
}

export function clearSession() {
  accessToken = "";
  currentUser = null;
}
