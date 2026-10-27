# Consultation Category Flow - Implementation Summary

## Overview

The legal consultation module now supports a **structured entry flow** where users select a problem category (civil/criminal/unsure) before describing their situation. This enhancement improves risk assessment, context collection, and routing to appropriate legal resources.

## Implementation Status: ✅ COMPLETE

### Frontend (model-consultation.js)

**Category Selection**
- Three-card picker: Civil (民事问题), Criminal (刑事问题), Unsure (我不确定)
- Visual differentiation: scale icon for civil, shield icon for criminal, spark icon for unsure
- Color-coded cards with descriptions
- Selection persists in draft state

**Dynamic Intake Panels**
- **Civil**: Region, time, goal fields (all optional)
- **Criminal**: Role, coercive measure, time, location fields
  - Shows urgent warning when custody measures detected
  - Custody measures: 已被刑事拘留, 已被逮捕, 被取保候审, 被监视居住
- **Unsure**: Simple info message

**Topic Selection**
- Civil: Dropdown with topics (合同纠纷, 劳动争议, 婚姻家事, etc.)
- Criminal/Unsure: Fixed topic (刑事问题 / 综合咨询)

**Risk Indicators**
- High-risk banner appears when:
  - Category is criminal AND coercive measure is in custody set
  - Risk keywords detected in conversation (羁押, 逮捕, 刑拘, etc.)
- Banner recommends immediate lawyer contact with CTA button

**Examples**
- Pre-fill category and topic when example clicked
- Examples cover all three categories

### Backend (Python/FastAPI)

**Schema Validation** (schemas.py:63-73)
```python
class ConsultationCreate(BaseModel):
    topic: str = Field(default="综合咨询", max_length=80)
    title: str | None = Field(default=None, max_length=200)
    category: Literal["civil", "criminal", "unsure"] = "unsure"
    intake: dict[str, str] = Field(default_factory=dict, max_length=12)
```

**API Endpoints** (consultations.py:29-32)
- POST `/consultations` accepts `category` and `intake` fields
- Passed to service layer for processing

**Business Logic** (consultation.py:115-125)
```python
def create(..., category: str = "unsure", intake: dict | None = None):
    intake = intake or {}
    risk = "high" if category == "criminal" and 
                     intake.get("coercive_measure") in CUSTODY_ANSWERS else "normal"
    ...
```

**Risk Assessment**
- Initial risk: High if criminal + custody
- Ongoing risk: Escalates to high if risk keywords detected
- Risk level "sticks": Once high, stays high for the consultation

**Context Injection** (consultation.py:157-161)
- Intake fields prepended to conversation context
- Format: "【咨询类型】民事问题。【已采集信息】身份：本人涉嫌；是否被采取强制措施：..."
- Enables context-aware AI responses

**Request Draft Generation** (consultation.py:291-295)
- Category automatically maps to domain field:
  - civil → "民事"
  - criminal → "刑事"
- Missing fields tracked for user completion

### Database

**Model** (models.py:63-77)
```python
class Consultation(Base):
    ...
    category: Mapped[str] = mapped_column(String(20), default="unsure")
    intake_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    risk_level: Mapped[str] = mapped_column(String(20), default="normal")
```

**Migration** (20261021_06_business_flow.py:21-24)
```python
"consultations": [
    sa.Column("category", sa.String(length=20), nullable=False, server_default="unsure"),
    sa.Column("intake_json", sa.JSON(), nullable=True),
]
```

### Testing

**Test Coverage** (test_business_flow.py:198-206)
```python
def test_consultation_category_intake_and_sticky_risk(api):
    # Criminal + custody → high risk
    created = ok(api.post("/api/v1/consultations", headers=client_headers, 
                          json={"topic": "刑事问题", "category": "criminal", 
                                "intake": {"coercive_measure": "已被刑事拘留", "location": "上海"}}))
    assert created["category"] == "criminal"
    assert created["risk_level"] == "high"
    assert created["intake"]["location"] == "上海"
    
    # Civil consultation escalates to high risk on keywords
    civil = ok(api.post("/api/v1/consultations", headers=client_headers, 
                        json={"topic": "合同纠纷", "category": "civil"}))
    ok(api.post(f"/api/v1/consultations/{civil['id']}/messages", 
                headers=client_headers, 
                json={"prompt": "对方转移财产怎么办，涉及财产转移", "topic": "合同纠纷"}))
    detail = ok(api.get(f"/api/v1/consultations/{civil['id']}", headers=client_headers))
    assert detail["risk_level"] == "high"  # Risk sticks after escalation
```

## User Flow

1. **Start Consultation**: User lands on consultation page
2. **Select Category**: Click civil/criminal/unsure card
3. **Fill Intake** (optional): Category-specific fields appear
4. **Describe Situation**: Enter prompt with context-aware placeholder
5. **Submit**: Consultation created with category and intake data
6. **Risk Assessment**: 
   - Immediate warning if criminal + custody
   - Escalating warning if risk keywords detected
7. **Follow-up**: Continue conversation with context maintained
8. **Convert to Request**: Generate lawyer service request draft with pre-filled domain

## Key Features

### Risk Detection
- **Proactive**: Warns before user submits if custody detected
- **Reactive**: Detects risk keywords in conversation
- **Persistent**: Once flagged, consultation stays high-risk
- **Actionable**: Direct link to find lawyers

### Context Collection
- **Minimal friction**: All intake fields optional
- **Category-specific**: Only relevant fields shown
- **Preserved**: Intake data stored and injected into AI context
- **Portable**: Transfers to service request draft

### Topic Management
- **Civil**: User chooses from domain-specific topics
- **Criminal/Unsure**: Fixed topic based on category
- **Immutable**: Topic set at creation, doesn't change on follow-ups

## Data Labels (labels.js)

```javascript
export const consultationCategories = {
  civil: ["民事问题", "合同、劳动、婚姻家事、侵权、借贷等纠纷"],
  criminal: ["刑事问题", "涉嫌犯罪、被害、取保、羁押等事项"],
  unsure: ["我不确定", "先描述情况，由系统帮你判断"],
};

export const civilTopics = [
  "合同纠纷", "劳动争议", "婚姻家事", "侵权责任", 
  "公司商事", "交通事故", "借贷纠纷", "房产物业", "其他民事"
];

export const coerciveMeasures = [
  "否", "已被刑事拘留", "已被逮捕", "被取保候审", "被监视居住", "不清楚"
];

export const criminalRoles = [
  "本人涉嫌", "家属涉嫌", "被害人", "证人", "其他"
];
```

## Verification Checklist

- [x] Category selection UI renders correctly
- [x] Intake panels show category-specific fields
- [x] Criminal + custody triggers high risk warning
- [x] Intake data persists to database
- [x] Context injection includes intake fields
- [x] Risk keywords escalate consultation to high risk
- [x] Risk level persists (sticks) after escalation
- [x] Topic selection works for civil (dropdown) and criminal/unsure (fixed)
- [x] Request draft generation maps category to domain
- [x] Test coverage validates flow
- [x] Migration adds required columns

## Next Steps (Future Enhancements)

1. **Analytics**: Track category distribution and risk escalation rates
2. **Filtering**: Add category filter to consultation list
3. **UI Polish**: Add category badge to history modal
4. **Help Content**: Expand guide modal with category-specific tips
5. **Lawyer Routing**: Auto-match criminal consultations to criminal lawyers
6. **Risk Refinement**: ML-based risk scoring beyond keyword matching

## Related Files

- `/model-consultation.js` - Frontend UI
- `/labels.js` - Data definitions
- `/backend/app/schemas.py` - Request validation
- `/backend/app/api/consultations.py` - HTTP layer
- `/backend/app/services/consultation.py` - Business logic
- `/backend/app/models.py` - Database models
- `/backend/migrations/versions/20261021_06_business_flow.py` - Schema migration
- `/backend/tests/test_business_flow.py` - Integration tests

---

**Status**: ✅ Implementation complete and tested  
**Last Updated**: 2026-10-21  
**Feature Flag**: None (enabled by default)
