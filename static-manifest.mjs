export const publicFiles = new Set([
  "index.html", "app.js", "api-client.js", "auth-state.js", "model-consultation.js",
  "ui.js", "styles.css", "model-consultation.css", "remote.css", "platform.css",
  "auth-view.js", "guide.js", "orders-view.js", "documents-view.js", "chat.js", "account-view.js",
]);

export function isPublicFile(relative) {
  return publicFiles.has(relative) || /^assets\/[a-zA-Z0-9_-]+\.(png|jpe?g|svg|ico|woff2)$/.test(relative);
}
