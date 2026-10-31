import { fields, label, regions, reviewDecisions, serviceModes, statusTone } from "./labels.js";
import { avatar, button, date, dateOnly, empty, esc, field, icon, status } from "./ui.js";

const badge = (value) => status(label(value), statusTone(value));
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

export function renderAccount({ user, roleNames }) {
  return `<div class="account-grid"><section class="surface profile-card">${avatar(user, "xl")}<h2>${esc(user.name)}</h2><p>${esc(user.email)}</p><div class="role-tags">${user.roles.map((role) => `<span class="chip">${esc(roleNames[role] || role)}</span>`).join("")}</div><div class="avatar-actions"><label class="btn primary">${icon("camera")} ${user.avatar ? "更换头像" : "上传头像"}<input id="avatar-input" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp"></label>${user.avatar ? button("avatar-remove", "移除头像") : ""}</div><p class="muted">支持 PNG、JPG、WebP，图片将居中裁剪为 256×256 后保存。</p></section>
  <div><section class="surface"><div class="section-title"><h2>基本资料</h2></div><form data-form="profile" class="inline-form">${field("显示名称", "name", user.name, { required: true, maxlength: 40, hint: "律师与当事人之间沟通时展示的称呼" })}<button class="btn primary" type="submit">保存</button><p class="form-error" role="alert"></p></form><dl class="data-list"><div><dt>登录邮箱</dt><dd>${esc(user.email)}</dd></div><div><dt>账户能力</dt><dd>${esc(user.roles.map((role) => roleNames[role] || role).join("、"))}</dd></div>${user.lawyer_profile ? `<div><dt>律师资质</dt><dd>${user.lawyer_profile.can_quote ? '<span class="status success">已认证 · 可接单</span>' : user.lawyer_profile.status === "frozen" ? '<span class="status danger">接单权限已冻结</span>' : '<span class="status muted">暂不可接单</span>'}${user.lawyer_profile.expires_on ? ` <small class="muted">有效期至 ${esc(dateOnly(user.lawyer_profile.expires_on))}</small>` : ""}</dd></div>` : ""}</dl></section>
  <section class="surface"><div class="section-title"><h2>${icon("shield")} 安全设置 · 修改密码</h2></div><ul class="security-tips"><li>新密码至少 8 位，建议组合字母、数字与符号。</li><li>修改成功后所有已登录会话将失效，需要使用新密码重新登录。</li></ul><form data-form="password" class="password-form">${field("原密码", "old_password", "", { type: "password", required: true })}${field("新密码（至少8位）", "new_password", "", { type: "password", required: true })}<p class="form-error" role="alert"></p><button class="btn primary" type="submit">修改密码并退出全部会话</button></form></section></div></div>`;
}

export function renderLawyerOnboarding({ applications, operator, profile = null }) {
  const pending = applications.find((entry) => ["submitted", "under_review"].includes(entry.status));
  const certified = profile && ["approved", "frozen"].includes(profile.status) && profile.expires_on && profile.expires_on >= today();
  const applicationForm = `<form data-form="lawyer-application"><div class="form-grid">${field("执业机构（律所）", "firm", "", { required: true, placeholder: "与执业证一致" })}${field("执业证号", "license_number", "", { required: true })}${field("主要执业地区", "region", "", { options: regions, required: true, placeholder: "请选择" })}${field("擅长领域", "field", "", { options: fields, required: true, placeholder: "请选择" })}${field("服务方式", "mode", "线上服务", { options: serviceModes, required: true })}${field("执业证有效期至", "expires_on", "", { type: "date", required: true, min: today() })}</div><label class="field"><span>证件与律所证明 <b>*</b></span><input name="credentials" type="file" multiple accept=".pdf,.png,.jpg,.jpeg" required></label><p class="form-error" role="alert"></p><button class="btn primary" type="submit">提交律师申请</button></form>`;
  const notice = `<div class="info-callout">${icon("info")}<span>请上传有效 PDF 或图片格式的执业证及律所证明。提交申请不等于通过认证，审核通过后才会开通律师视图与接单能力。</span></div>`;
  const form = operator ? "" : pending ? `<section class="surface onboarding-state">${icon("clock")}<div><h2>申请审核中</h2><p class="muted">平台通常在 1-2 个工作日内完成审核，结果会通过服务通知告知。</p></div></section>` : certified ? `<section class="surface"><div class="onboarding-state">${icon("review")}<div><h2>你已完成律师入驻</h2><p class="muted">${profile.status === "frozen" ? "接单权限目前被平台冻结，如有疑问请联系平台运营。" : `资质有效期至 ${esc(dateOnly(profile.expires_on))}。可在右上角切换到律师视图，浏览需求线索、报价或上架服务套餐。`}</p></div></div><details class="reapply"><summary>执业证续期或变更执业机构？重新提交资质</summary>${notice}${applicationForm}</details></section>` : `<section class="surface"><div class="section-title"><h2>律师资质申请</h2><small>材料仅本人和授权审核人员可访问</small></div>${profile?.status === "approved" ? `<div class="info-callout warn">${icon("alert")}<span>你的执业证已过期，已暂停新接单。请上传续期后的证件重新提交审核。</span></div>` : notice}${applicationForm}</section>`;
  const progress = applications.map((entry) => `<article class="record-card"><header><h3>第 ${entry.version} 次申请 · ${esc(entry.firm)}</h3>${badge(entry.status)}</header><p class="muted">${esc(entry.region)} · ${esc(entry.field)} · 执业证有效期至 ${esc(dateOnly(entry.expires_on))} · 提交于 ${date(entry.created_at)}</p>${entry.status === "supplement" ? `<div class="info-callout warn">${icon("info")}<span>审核人员要求补充材料，请根据意见在上方重新提交申请。</span></div>` : ""}${entry.reviews.length ? `<ul class="timeline-list compact">${entry.reviews.map((review) => `<li><div><b>${esc(reviewDecisions[review.decision] || review.decision)}</b> · ${esc(review.reason)}</div><small>${date(review.created_at)}</small></li>`).join("")}</ul>` : ""}${["submitted", "under_review", "draft"].includes(entry.status) ? button("withdraw-application", "撤回申请", `data-id="${esc(entry.id)}"`, "ghost sm") : ""}</article>`).join("");
  return `${form}<section class="surface"><h2>申请进度</h2>${progress || empty("尚未提交申请", "", "提交后可在此查看审核进度与意见", "review")}</section>`;
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
