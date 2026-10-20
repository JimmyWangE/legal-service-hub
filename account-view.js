import { avatar, button, date, empty, esc, field, icon } from "./ui.js";

export function renderAccount({ user, roleNames }) {
  return `<div class="account-grid"><section class="surface profile-card">${avatar(user, "xl")}<h2>${esc(user.name)}</h2><p>${esc(user.email)}</p><div class="role-tags">${user.roles.map((role) => `<span class="chip">${esc(roleNames[role] || role)}</span>`).join("")}</div><div class="avatar-actions"><label class="btn primary">${icon("camera")} ${user.avatar ? "更换头像" : "上传头像"}<input id="avatar-input" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp"></label>${user.avatar ? button("avatar-remove", "移除头像") : ""}</div><p class="muted">支持 PNG、JPG、WebP，图片将居中裁剪为 256×256 后保存。</p></section>
  <div><section class="surface"><div class="section-title"><h2>基本资料</h2></div><dl class="data-list"><div><dt>姓名</dt><dd>${esc(user.name)}</dd></div><div><dt>登录邮箱</dt><dd>${esc(user.email)}</dd></div><div><dt>账户能力</dt><dd>${esc(user.roles.map((role) => roleNames[role] || role).join("、"))}</dd></div><div><dt>注册校验</dt><dd>算术问答已完成</dd></div>${user.lawyer_profile ? `<div><dt>律师资质</dt><dd>${user.lawyer_profile.can_quote ? "已认证，可接单" : "暂不可接单"}${user.lawyer_profile.expires_on ? ` · 有效期至 ${esc(user.lawyer_profile.expires_on)}` : ""}</dd></div>` : ""}</dl></section>
  <section class="surface"><div class="section-title"><h2>${icon("shield")} 安全设置 · 修改密码</h2></div><ul class="security-tips"><li>新密码至少 12 位，建议组合字母、数字与符号。</li><li>修改成功后所有已登录会话将失效，需要使用新密码重新登录。</li></ul><form data-form="password" class="password-form">${field("原密码", "old_password", "", { type: "password", required: true })}${field("新密码（至少12位）", "new_password", "", { type: "password", required: true })}<p class="form-error" role="alert"></p><button class="btn primary" type="submit">修改密码并退出全部会话</button></form></section></div></div>`;
}

export function renderLawyerOnboarding({ applications, badge, operator }) {
  const form = operator ? "" : `<section class="surface"><div class="section-title"><h2>律师资质申请</h2><small>材料仅本人和授权审核人员可访问</small></div><div class="info-callout">${icon("info")}<span>请上传有效 PDF 或图片格式的执业证及律所证明。提交申请不等于通过认证，审核通过后才会开通律师视图与接单能力。</span></div><form data-form="lawyer-application"><div class="form-grid">${[["律所", "firm"], ["地区", "region"], ["专业领域", "field"], ["服务方式", "mode"], ["执业证号", "license_number"]].map(([title, name]) => field(title, name, "", { required: true })).join("")}${field("执业证有效期", "expires_on", "", { type: "date", required: true })}</div><label class="field"><span>证件与律所证明 <b>*</b></span><input name="credentials" type="file" multiple accept=".pdf,.png,.jpg,.jpeg" required></label><p class="form-error" role="alert"></p><button class="btn primary" type="submit">提交律师申请</button></form></section>`;
  const progress = applications.map((entry) => `<article class="remote-record"><h3>申请 v${entry.version} · ${esc(entry.firm)} ${badge(entry.status)}</h3><p class="muted">${esc(entry.region)} · ${esc(entry.field)} · 执业证有效期 ${esc(entry.expires_on)} · 提交于 ${date(entry.created_at)}</p>${entry.reviews.length ? `<ul class="timeline-list">${entry.reviews.map((review) => `<li>${esc(review.reason)}<small>${date(review.created_at)}</small></li>`).join("")}</ul>` : ""}${["submitted", "under_review", "draft"].includes(entry.status) ? button("withdraw-application", "撤回申请", `data-id="${esc(entry.id)}"`) : ""}</article>`).join("");
  return `${form}<section class="surface"><h2>申请进度</h2>${progress || empty("尚未提交申请")}</section>`;
}

// 头像在浏览器端居中裁剪并压缩为 256px JPEG，避免上传原图
export async function avatarDataUrl(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("头像仅支持 PNG、JPG 或 WebP 图片");
  if (file.size > 5 * 1024 * 1024) throw new Error("原图不能超过5MB");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 256, 256);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}
