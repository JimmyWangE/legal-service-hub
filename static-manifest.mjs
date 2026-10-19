export const publicFiles = new Set([
  "index.html", "app.js", "api-client.js", "auth-state.js", "model-consultation.js",
  "ui.js", "styles.css", "model-consultation.css", "remote.css",
]);

export function isPublicFile(relative) {
  return publicFiles.has(relative) || /^assets\/[a-zA-Z0-9_-]+\.(png|jpe?g|svg|ico|woff2)$/.test(relative);
}
