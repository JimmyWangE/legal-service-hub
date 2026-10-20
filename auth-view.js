import { field, icon } from "./ui.js";

const features = [
  ["spark", "法律模型咨询", "结构化提问、连续追问与流式回答，帮助你先理清事实与诉求。"],
  ["lawyer", "律师撮合报价", "一键把咨询整理成需求草稿，认证律师在线报价，按需择优委托。"],
  ["doc", "文书协作会签", "版本留痕、批注讨论与顺序会签，交付文书全程可追溯。"],
  ["shield", "安全履约售后", "订单状态清晰可查，确认收悉后结算，退款与争议有专人处理。"],
];

export function renderAuthPage(register = false) {
  return `<main class="auth-page">
    <section class="auth-brand" aria-label="平台介绍">
      <div class="auth-logo"><img src="./assets/legal-service-icon.jpg" alt=""><div>法律服务平台<small>咨询 · 协作 · 履约</small></div></div>
      <div class="auth-hero"><h1>让每一次法律求助<br><em>都有专业回应</em></h1><p>从智能咨询梳理问题，到连接认证律师、在线沟通、协作文书与安全履约，一个平台完成法律服务全流程。</p></div>
      <div class="auth-features">${features.map(([glyph, title, text]) => `<div class="auth-feature"><span>${icon(glyph)}</span><div><b>${title}</b><p>${text}</p></div></div>`).join("")}</div>
      <div class="auth-flow"><span>模型咨询</span><i>→</i><span>发布需求</span><i>→</i><span>律师报价</span><i>→</i><span>在线交流</span><i>→</i><span>文书交付</span></div>
      <div class="auth-trust"><span>${icon("shield")} 律师资质人工审核</span><span>${icon("audit")} 关键操作全程审计</span><span>${icon("check")} 需求发布前需本人确认</span></div>
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
        <div class="auth-foot">${register ? "律师入驻：注册后在“律师入驻”页提交执业证与律所证明，审核通过即可接单。" : "登录凭证仅保存在当前页面内存中，刷新页面后需要重新登录。"}</div>
        <div id="auth-message" role="status"></div>
      </div>
    </section>
  </main><div id="toast" role="status" aria-live="polite"></div>`;
}
