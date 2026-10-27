# Consultation Category System - Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE (Browser)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    NEW CONSULTATION FLOW                             │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                       │  │
│  │  1. CATEGORY SELECTION                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │  │
│  │  │ 🔖 民事问题  │  │ 🛡️ 刑事问题  │  │ ✨ 不确定   │                │  │
│  │  │  Civil      │  │  Criminal   │  │   Unsure    │                │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                │  │
│  │         │                 │                 │                        │  │
│  │         ▼                 ▼                 ▼                        │  │
│  │                                                                       │  │
│  │  2. INTAKE PANEL (Dynamic)                                           │  │
│  │  ┌────────────────────────────────────────────────┐                 │  │
│  │  │ Civil: Region, Time, Goal                      │                 │  │
│  │  │ Criminal: Role, Coercive Measure, Time, Loc    │                 │  │
│  │  │ Unsure: Simplified info message                │                 │  │
│  │  └────────────────────────────────────────────────┘                 │  │
│  │         │                                                             │  │
│  │         ▼                                                             │  │
│  │  3. RISK ASSESSMENT                                                  │  │
│  │  ┌────────────────────────────────────────────────┐                 │  │
│  │  │ IF criminal + custody → HIGH RISK              │                 │  │
│  │  │ ⚠️ Urgent warning + lawyer CTA                  │                 │  │
│  │  └────────────────────────────────────────────────┘                 │  │
│  │         │                                                             │  │
│  │         ▼                                                             │  │
│  │  4. PROMPT COMPOSER                                                  │  │
│  │  ┌────────────────────────────────────────────────┐                 │  │
│  │  │ Textarea + Topic selector                      │                 │  │
│  │  │ File attachments, Polish button                │                 │  │
│  │  └────────────────────────────────────────────────┘                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    HISTORY MODAL (Enhanced)                          │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                       │  │
│  │  FILTERS: [全部] [民事] [刑事] [不确定]                               │  │
│  │  SEARCH: [_____________________]                                     │  │
│  │                                                                       │  │
│  │  ┌──────────────────────────────────────────────────┐               │  │
│  │  │ [🔖 民事问题] [⚠️ 高风险] 合同纠纷       [🗑️]    │               │  │
│  │  │ 对方拖欠货款需要律师审阅合同                      │               │  │
│  │  │ 2026-10-21 14:30 · 3轮提问                   →  │               │  │
│  │  └──────────────────────────────────────────────────┘               │  │
│  │  ┌──────────────────────────────────────────────────┐               │  │
│  │  │ [🛡️ 刑事问题] [⚠️ 高风险] 刑事问题       [🗑️]    │               │  │
│  │  │ 家人涉嫌经济犯罪被带走调查                        │               │  │
│  │  │ 2026-10-20 09:15 · 1轮提问                   →  │               │  │
│  │  └──────────────────────────────────────────────────┘               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    GUIDE MODAL (Enhanced)                            │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                       │  │
│  │  1. CATEGORY EXPLANATIONS (Visual Cards)                            │  │
│  │     ┌─────────────────────────────────────────┐                     │  │
│  │     │ 🔖 民事问题                              │                     │  │
│  │     │ Contracts, labor, family law...         │                     │  │
│  │     └─────────────────────────────────────────┘                     │  │
│  │     ┌─────────────────────────────────────────┐                     │  │
│  │     │ 🛡️ 刑事问题                              │                     │  │
│  │     │ Criminal matters, custody, bail...      │                     │  │
│  │     │ ⚠️ Contact lawyer immediately if detained│                     │  │
│  │     └─────────────────────────────────────────┘                     │  │
│  │                                                                       │  │
│  │  2. RISK IDENTIFICATION SECTION                                      │  │
│  │  3. USAGE TIPS                                                       │  │
│  │  4. DISCLAIMERS                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ HTTP API
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BACKEND API (FastAPI)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  POST /api/v1/consultations                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Body: { topic, category, intake }                                     │ │
│  │ ├─ Validate category: civil | criminal | unsure                       │ │
│  │ ├─ Validate intake: max 12 entries, bounded strings                   │ │
│  │ └─ Call service layer                                                 │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                     │                                        │
│                                     ▼                                        │
│  GET /api/v1/consultations?category=X&risk_level=Y (NEW)                   │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Query Params:                                                          │ │
│  │ ├─ category: "civil" | "criminal" | "unsure" (optional)               │ │
│  │ ├─ risk_level: "normal" | "high" (optional)                           │ │
│  │ ├─ offset: int ≥ 0                                                     │ │
│  │ └─ limit: int 1-100                                                    │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                     │                                        │
│                                     ▼                                        │
│  POST /api/v1/consultations/{id}/messages                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Body: { prompt, topic, context_enabled }                              │ │
│  │ ├─ Inject intake context from consultation                            │ │
│  │ ├─ Call AI model provider                                             │ │
│  │ ├─ Detect risk keywords                                               │ │
│  │ └─ Update risk_level if escalated                                     │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SERVICE LAYER (Python)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  consultation.create(db, owner_id, topic, title, category, intake)          │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ 1. RISK ASSESSMENT                                                     │ │
│  │    IF category == "criminal" AND                                       │ │
│  │       intake["coercive_measure"] IN CUSTODY_ANSWERS:                   │ │
│  │       risk_level = "high"                                              │ │
│  │    ELSE:                                                               │ │
│  │       risk_level = "normal"                                            │ │
│  │                                                                         │ │
│  │ 2. CREATE CONSULTATION RECORD                                          │ │
│  │    ├─ Generate ID                                                      │ │
│  │    ├─ Store category, intake_json, risk_level                          │ │
│  │    └─ Set timestamps                                                   │ │
│  │                                                                         │ │
│  │ 3. RETURN CONSULTATION OBJECT                                          │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  consultation.prepare_message(db, consultation, actor, payload)             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ 1. BUILD CONTEXT                                                       │ │
│  │    IF context_enabled:                                                 │ │
│  │       ├─ Load last 12 messages                                         │ │
│  │       └─ Format as {role, content} pairs                               │ │
│  │                                                                         │ │
│  │ 2. INJECT INTAKE CONTEXT                                               │ │
│  │    IF consultation.intake_json:                                        │ │
│  │       Prepend: "【咨询类型】civil/criminal/unsure。                     │ │
│  │                【已采集信息】role:X; time:Y; location:Z"               │ │
│  │                                                                         │ │
│  │ 3. RETURN (attachments, context, version)                              │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  consultation.persist_message(db, consultation, actor, payload, answer)     │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ 1. RISK KEYWORD DETECTION                                              │ │
│  │    risk_terms = ["羁押", "逮捕", "刑拘", "立案", "时效",               │ │
│  │                  "财产转移", "人身危险"]                               │ │
│  │    IF any(term in prompt OR term in answer):                           │ │
│  │       answer.risk = True                                               │ │
│  │                                                                         │ │
│  │ 2. ESCALATE RISK LEVEL (STICKY)                                        │ │
│  │    IF answer.risk:                                                     │ │
│  │       consultation.risk_level = "high"  # Only up, never down          │ │
│  │                                                                         │ │
│  │ 3. SAVE MESSAGES                                                       │ │
│  │    ├─ User message with attachments                                    │ │
│  │    ├─ Assistant message with risk flag                                 │ │
│  │    └─ Update consultation.updated_at                                   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  consultation.create_summary(db, consultation, user_id, payload)            │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ 1. EXTRACT MESSAGES                                                    │ │
│  │    ├─ Load all messages (limit 200)                                    │ │
│  │    └─ Filter user messages                                             │ │
│  │                                                                         │ │
│  │ 2. GENERATE REQUEST DRAFT (AI)                                         │ │
│  │    ├─ Call model with conversation transcript                          │ │
│  │    ├─ Parse JSON response                                              │ │
│  │    └─ Normalize fields                                                 │ │
│  │                                                                         │ │
│  │ 3. MAP CATEGORY TO DOMAIN                                              │ │
│  │    IF consultation.category == "civil":                                │ │
│  │       draft["domain"] = "民事"                                         │ │
│  │    ELIF consultation.category == "criminal":                           │ │
│  │       draft["domain"] = "刑事"                                         │ │
│  │                                                                         │ │
│  │ 4. RETURN SUMMARY + CONSENT RECORD                                     │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATABASE (PostgreSQL/SQLite)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  TABLE: consultations                                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ id                 VARCHAR(36)  PRIMARY KEY                            │ │
│  │ owner_id           VARCHAR(36)  FOREIGN KEY → users.id                 │ │
│  │ topic              VARCHAR(80)  DEFAULT "综合咨询"                     │ │
│  │ title              VARCHAR(200) DEFAULT "新的法律咨询"                 │ │
│  │ category           VARCHAR(20)  DEFAULT "unsure"  ← NEW                │ │
│  │ intake_json        JSON         NULL              ← NEW                │ │
│  │ risk_level         VARCHAR(20)  DEFAULT "normal"                       │ │
│  │ summary_json       JSON         NULL                                   │ │
│  │ status             VARCHAR(30)  DEFAULT "active"                       │ │
│  │ version            INTEGER      DEFAULT 0                              │ │
│  │ created_at         TIMESTAMP                                           │ │
│  │ updated_at         TIMESTAMP                                           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  INDEXES:                                                                    │
│  ├─ idx_consultations_owner_id (owner_id)                                   │
│  ├─ idx_consultations_category (category)      ← Supports filtering         │
│  └─ idx_consultations_risk_level (risk_level)  ← Supports filtering         │
│                                                                              │
│  SAMPLE DATA:                                                                │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ id: "C1A2B3C4"                                                         │ │
│  │ owner_id: "U123"                                                       │ │
│  │ topic: "合同纠纷"                                                      │ │
│  │ category: "civil"                                                      │ │
│  │ intake_json: {"region": "北京", "time": "2026-03", "goal": "追回货款"}│ │
│  │ risk_level: "normal"                                                   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ id: "C5D6E7F8"                                                         │ │
│  │ owner_id: "U456"                                                       │ │
│  │ topic: "刑事问题"                                                      │ │
│  │ category: "criminal"                                                   │ │
│  │ intake_json: {"role": "家属涉嫌", "coercive_measure": "已被刑事拘留", │ │
│  │               "time": "2026年9月", "location": "上海市浦东新区"}       │ │
│  │ risk_level: "high"                                                     │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA FLOW SUMMARY                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. USER SELECTS CATEGORY → UI shows intake panel                           │
│  2. USER FILLS INTAKE → Data stored in draft state                          │
│  3. USER SUBMITS PROMPT → POST /consultations                               │
│     ├─ Backend validates category & intake                                  │
│     ├─ Service assesses initial risk (criminal + custody)                   │
│     └─ Database stores consultation with category, intake_json, risk_level  │
│  4. AI GENERATES RESPONSE → POST /consultations/{id}/messages               │
│     ├─ Intake context prepended to conversation                             │
│     ├─ Model generates answer                                               │
│     ├─ Risk keywords detected in prompt/answer                              │
│     ├─ Risk level escalated if needed (sticky)                              │
│     └─ Messages saved with risk flag                                        │
│  5. USER VIEWS HISTORY → GET /consultations?category=X&risk_level=Y        │
│     ├─ Filtered by category and/or risk level                               │
│     ├─ UI renders with color-coded badges                                   │
│     └─ High-risk cases prominently marked                                   │
│  6. USER GENERATES REQUEST → POST /consultations/{id}/summary               │
│     ├─ AI extracts key info from conversation                               │
│     ├─ Category maps to domain field                                        │
│     └─ Draft ready for lawyer marketplace                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        KEY DECISION POINTS                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Category Selection (User Input)                                            │
│  ├─ Civil → Region/Time/Goal intake                                         │
│  ├─ Criminal → Role/Custody/Time/Location intake                            │
│  └─ Unsure → Simplified intake                                              │
│                                                                              │
│  Initial Risk Assessment (Automatic)                                         │
│  ├─ IF criminal + custody → risk = HIGH                                     │
│  └─ ELSE → risk = NORMAL                                                    │
│                                                                              │
│  Risk Escalation (Automatic, Sticky)                                        │
│  ├─ IF risk keywords detected → risk = HIGH                                 │
│  └─ Once HIGH, stays HIGH (never downgraded)                                │
│                                                                              │
│  Context Injection (Automatic)                                              │
│  ├─ Prepend intake fields to first message context                          │
│  └─ AI gets structured facts upfront                                        │
│                                                                              │
│  Domain Mapping (Automatic)                                                 │
│  ├─ civil → "民事"                                                          │
│  ├─ criminal → "刑事"                                                       │
│  └─ unsure → AI determines from content                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

COLOR LEGEND:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🔖 Civil (Blue):    #eff6ff / #3b82f6 - Professional, trustworthy          │
│ 🛡️ Criminal (Red):  #fef2f2 / #ef4444 - Urgent, attention-grabbing         │
│ ✨ Unsure (Purple): #f5f0fa / #a785c5 - Neutral, exploratory               │
│ ⚠️ High Risk:       #fef2f2 / #dc2626 - Warning, immediate action          │
└─────────────────────────────────────────────────────────────────────────────┘
```
