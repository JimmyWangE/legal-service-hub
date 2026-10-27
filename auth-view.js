import { field, icon } from "./ui.js";

const features = [
  ["spark", "民事 / 刑事智能分流", "按问题类型引导提问，识别羁押、时效等紧急风险并优先转人工。"],
  ["lawyer", "认证律师在线报价", "资质人工审核，方案、工期、评分一目了然，择优委托。"],
  ["doc", "合同确认与文书会签", "服务合同双方确认，文书版本留痕、顺序会签、全程可追溯。"],
  ["shield", "履约保障与存证", "验收后结算，退款与争议平台介入，一键导出交易存证包。"],
];

export function renderAuthPage(register = false) {
  return `<main class="auth-page">
    <section class="auth-brand" aria-label="平台介绍">
      <div class="auth-logo"><span class="brand-mark">${icon("scale")}</span><div>法律服务平台<small>LEGAL SERVICE HUB</small></div></div>
      <div class="auth-hero"><h1>专业法律服务<br><em>从一个问题开始</em></h1><p>智能咨询梳理问题，连接认证律师，在线确认合同、协作文书、验收交付——法律服务全流程，清晰、可追溯。</p></div>
      <div class="auth-features">${features.map(([glyph, title, text]) => `<div class="auth-feature"><span>${icon(glyph)}</span><div><b>${title}</b><p>${text}</p></div></div>`).join("")}</div>
      <div class="auth-flow"><span>咨询</span><i></i><span>需求</span><i></i><span>报价</span><i></i><span>合同</span><i></i><span>履约</span><i></i><span>存证</span></div>
      <div class="auth-trust"><span>${icon("review")} 律师资质人工审核</span><span>${icon("lock")} 隐私信息自动脱敏</span><span>${icon("audit")} 关键操作全程留痕</span></div><p class="auth-disclaimer">平台提供信息撮合与协作工具，模型回答仅供参考，不构成法律意见。</p>
    </section>
    <section class="auth-panel">
      <div class="auth-card">
        <div class="auth-tabs" role="tablist"><button type="button" role="tab" aria-selected="${!register}" class="${register ? "" : "active"}" data-action="login-view">登录</button><button type="button" role="tab" aria-selected="${register}" class="${register ? "active" : ""}" data-action="register-view">注册 / 律师入驻</button></div>
        <h2>${register ? "创建账户" : "欢迎回来"}</h2>
        <p>${register ? "注册后即可使用模型咨询与发布需求；律师提交资质并审核通过后开通接单能力。" : "登录后继续你的咨询、订单与文书协作。"}</p>
        <form data-form="${register ? "register" : "login"}">
          ${field("邮箱", "email", "", { type: "email", required: true, placeholder: "name@example.com" })}
          ${register ? field("姓名", "name", "", { required: true, placeholder: "用于律师与客户之间的称呼" }) : ""}
          ${field(register ? "密码（至少8位）" : "密码", "password", "", { type: "password", required: true, placeholder: register ? "至少8位" : "请输入密码" })}
          ${register ? `<label class="field"><span>使用意向（不自动授予权限）</span><select name="registration_intent"><option value="client" selected>我需要法律服务（当事人）</option><option value="lawyer">我是执业律师（需提交资质审核）</option></select></label>
          <label class="field"><span>安全问答 <b>*</b></span><div class="challenge-box"><strong id="registration-question">正在生成题目…</strong><button class="btn sm" type="button" data-action="registration-refresh">换一道题</button></div><input name="challenge_answer" type="text" inputmode="numeric" autocomplete="off" required placeholder="请输入计算结果"><input name="challenge_id" type="hidden"></label>` : ""}
          <p class="form-error" role="alert"></p>
          <button class="btn primary block" type="submit">${register ? "注册并登录" : "登录"}</button>
        </form>
        <div class="auth-foot">${register ? "律师入驻：注册后在“律师入驻”页提交执业证与律所证明，审核通过即可接单。" : "登录状态仅在当前浏览器标签页内保留，关闭标签页后需重新登录。"}</div>
        <div id="auth-message" role="status"></div>
      </div>
    </section>
  </main><div id="toast" role="status" aria-live="polite"></div>`;
}
