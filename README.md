# 法律服务平台 · 本地前端原型

这是结合《法律服务平台需求文档》调整后的法律服务平台本地前端原型。项目复用了 Alpha AI 复刻页的视觉语言，但产品入口已经围绕“问答分流 → 律师连接 → 报价 → 订单 → 文书协作 → 支付 → 交付 → 售后/存证”重新组织。页面使用原生 HTML、CSS、ES modules 和本地 Node 静态服务器，无需构建步骤或后端服务即可运行。

## 启动

```bash
npm start
```

浏览器打开 <http://127.0.0.1:4173/>。如果 4173 端口已被占用，可以使用：

```bash
PORT=4174 npm start
```

服务器预览时，可以监听所有 IPv4 网卡：

```bash
HOST=0.0.0.0 PORT=4173 npm start
```

通过 `http://服务器地址:4173/` 访问。跨网络访问需要放行服务器防火墙或云安全组中的 TCP 4173 端口；这是无真实鉴权的演示原型，请仅向可信访问者开放。未设置 `HOST` 时仍默认仅监听本机。

检查语法：

```bash
npm run check
```

运行业务状态测试：

```bash
npm test
```

## 保留的页面和流程

- 当事人工作台：法律问答、需求发布、找律师、报价比较、订单、文书中心和账户安全。
- 法律问答：民事、刑事、不确定三入口，事实/地区/时间/诉求采集，刑事身份和强制措施字段，风险提示和人工律师入口。
- 服务需求：问答摘要授权转需求，预算、地区、截止时间、交付物和公开范围；需求详情与报价列表。
- 律师连接：认证律师列表、领域/地区筛选、律师资质信息和报价流程。
- 订单履约：接受报价创建订单与服务合同，单次支付成功/失败重试，服务中、待交付、待确认、已完成、退款中、争议中等状态。
- 文书协作：服务合同、法律文书和交付物，版本、恢复为新版本、批注、访问授权、顺序会签、退回、撤回、催办和平台内确认。
- 售后与存证：退款/争议申请、运营处理、订单过程记录、版本指纹和必要元数据导出。
- 律师视角：线索、报价、订单、文书工作区、交付、资质与收款结算。
- 运营视角：律师审核、订单监管、售后争议、审计日志、服务类目和风险提示配置。

## 已移除或暂缓的原入口

- 已移除促销浮窗、AlphaClaw、峰会活动、小阿来信、试用剩余天数、旧版切换、原站备案和微信登录展示。
- 已合并合同审查、模板审查、补充协议审查、制度审查为订单内的文书审阅与版本协作。
- 独立类案检索、自动 AI 审查、并行会签、电子签署、分阶段付款、发票、托管结算、多组织合同管理暂缓，避免出现没有真实服务支撑的孤立入口。

主要 hash 路由沿用了原站的 `appId`：

```text
#/AlphaGPT/index?appId=LAW_SEARCH_COLUMN&tab=BUSINESS_EFFECT
#/AlphaGPT/index?appId=SIMILAR_CASE_GPT_COLUMN&tab=BUSINESS_EFFECT
#/AlphaGPT/index?appId=CONTRACT_REVIEW_COLUMN&tab=BUSINESS_EFFECT
#/AlphaGPT/index?appId=TEMPLATE_REVIEW_COLUMN&tab=BUSINESS_EFFECT
#/AlphaGPT/index?appId=AGREEMENT_REVIEW_COLUMN&tab=BUSINESS_EFFECT
#/AlphaGPT/index?appId=REGULATION_REVIEW_COLUMN&tab=BUSINESS_EFFECT
#/AlphaGPT/index?appId=WRITING_DRAFT_COLUMN&tab=BUSINESS_EFFECT
#/AlphaGPT/index?appId=WRITING_TABLE_GPT_COLUMN&tab=BUSINESS_EFFECT
```

## 数据和边界

这是本地前端原型，不连接 AlphaLawyer 的账号、AI 模型、案例库、合同审查服务或真实支付。需求、报价、订单、文书版本、会签、通知、售后和审计数据使用当前浏览器 `localStorage` 保存，并通过三种演示角色模拟权限边界。文件只保存名称和大小，不上传或解析正文；支付、确认和存证都明确标注为本地演示。

保留服务清单、页面映射和删除/暂缓决策见 [服务清单与页面调整方案](./服务清单与页面调整方案.md)。如需投入生产，可替换为自己的品牌与素材，并接入鉴权、AI/检索、文件存储、支付、电子签署、存证和运营后台 API。
