// 所有后端枚举到中文文案与状态色调的唯一映射，页面不直接展示英文枚举
export const statusLabels = {
  // 订单
  pending_confirm: "待确认合同", pending_payment: "待支付", service: "服务中", pending_receipt: "待确认交付",
  completed: "已完成", refund_pending: "退款处理中", disputed: "争议处理中", closed: "已关闭", cancelled: "已取消",
  // 支付 / 结算
  unpaid: "未支付", paid: "已支付", creating: "支付单创建中", created: "等待支付", success: "支付成功", failed: "支付失败",
  frozen: "暂不结算", refunded: "已全额退款", partially_refunded: "部分退款",
  // 需求 / 报价
  quoting: "报价中", ordered: "已下单", valid: "有效", accepted: "已接受", expired: "已失效", withdrawn: "已撤回",
  // 文书 / 会签
  draft: "草稿", signing: "会签中", confirmed: "已确认", returned: "已退回", archived: "已归档", waiting: "待轮到",
  // 售后 / 审核
  pending: "待处理", approved: "已通过", rejected: "已驳回", refund_processing: "退款处理中",
  submitted: "已提交", under_review: "审核中", supplement: "需补充材料",
};

const tones = {
  success: ["completed", "paid", "success", "confirmed", "approved", "accepted", "refunded", "valid"],
  danger: ["disputed", "refund_pending", "refund_processing", "returned", "rejected", "failed", "frozen_lawyer"],
  muted: ["closed", "cancelled", "expired", "withdrawn", "archived", "unpaid", "waiting", "draft"],
  info: ["service", "signing", "quoting", "ordered", "under_review", "submitted", "pending_receipt", "creating", "created", "partially_refunded"],
};

export function statusTone(value) {
  for (const [tone, values] of Object.entries(tones)) if (values.includes(value)) return tone;
  return "warning";
}

export const roleNames = { client: "当事人", lawyer: "律师", operator: "运营" };
export const docTypes = { service_contract: "服务合同", legal_document: "法律文书", attachment: "附件材料", delivery: "交付物" };
export const caseTypes = { refund: "退款申请", dispute: "争议处理" };
export const reviewDecisions = { approve: "通过", reject: "驳回", supplement: "需补充材料" };
export const consultationCategories = {
  civil: ["民事问题", "合同、劳动、婚姻家事、侵权、借贷等纠纷"],
  criminal: ["刑事问题", "涉嫌犯罪、被害、取保、羁押等事项"],
  unsure: ["我不确定", "先描述情况，由系统帮你判断"],
};

export const auditActions = {
  "request.created": "发布需求", "request.updated": "修改需求", "request.closed": "关闭需求",
  "quote.created": "提交报价", "quote.accepted": "接受报价", "quote.withdrawn": "撤回报价",
  "order.contract.confirmed": "确认服务合同", "order.cancelled": "取消订单", "order.reviewed": "评价订单", "order.evidence.exported": "导出存证包",
  "payment.created": "创建支付单", "payment.booked": "支付入账", "payment.simulated": "模拟支付",
  "delivery.submitted": "提交交付", "delivery.received": "确认交付", "delivery.returned": "退回交付",
  "refund.created": "申请退款", "dispute.created": "发起争议", "case.resolved": "处理售后", "refund.success": "退款完成",
  "document.created": "新建文书", "document.version.created": "保存新版本", "document.version.restored": "恢复历史版本",
  "document.comment.created": "添加批注", "document.comment.resolved": "解决批注", "document.access.revoked": "撤销文书授权", "document.metadata.viewed": "运营查看文书信息",
  "workflow.started": "发起会签", "workflow.confirmed": "会签确认", "workflow.returned": "会签退回", "workflow.withdrawn": "撤回会签",
  "lawyer.applied": "提交律师申请", "lawyer.reviewed": "审核律师申请", "lawyer.frozen": "冻结律师", "lawyer.unfrozen": "恢复律师接单", "lawyer.withdrawn": "撤回律师申请", "lawyer.credential.downloaded": "下载资质材料",
  "account.registered": "注册账户", "password.changed": "修改密码", "chat.opened": "发起交流", "file.uploaded": "上传文件", "payment.reconciled": "支付对账",
  "consultation.message": "模型咨询", "consultation.deleted": "删除咨询", "user.avatar.updated": "更新头像",
};
export const objectTypes = { request: "需求", quote: "报价", order: "订单", payment: "支付", delivery: "交付", case: "售后", document: "文书", comment: "批注", lawyer: "律师", lawyer_application: "律师申请", consultation: "咨询", user: "用户", refund: "退款" };

export const domains = ["民事", "刑事", "行政", "非诉"];
export const fields = ["合同纠纷", "劳动争议", "婚姻家事", "侵权责任", "公司商事", "交通事故", "借贷纠纷", "房产物业", "知识产权", "刑事辩护", "刑事控告", "其他"];
export const serviceTypes = ["法律咨询", "合同审阅", "合同起草", "律师函", "诉讼文书起草", "案件代理", "刑事会见", "其他"];
export const regions = ["北京", "上海", "广东", "浙江", "江苏", "四川", "湖北", "山东", "福建", "河南", "其他地区", "全国"];
export const serviceModes = ["线上服务", "线下面谈", "线上+线下"];
export const civilTopics = ["合同纠纷", "劳动争议", "婚姻家事", "侵权责任", "公司商事", "交通事故", "借贷纠纷", "房产物业", "其他民事"];
export const coerciveMeasures = ["否", "已被刑事拘留", "已被逮捕", "被取保候审", "被监视居住", "不清楚"];
export const criminalRoles = ["本人涉嫌", "家属涉嫌", "被害人", "证人", "其他"];

export const label = (value) => statusLabels[value] || value || "—";
export const options = (values) => values.map((value) => [value, value]);
