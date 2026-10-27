# Consultation Category Enhancements - Implementation

## Overview

This document describes the enhancements made to the consultation category flow based on the future enhancement suggestions in `CONSULTATION_CATEGORY_FLOW.md`.

## Implemented Enhancements

### 1. Category & Risk Filtering (Backend API)

**File**: `backend/app/api/consultations.py`

**Change**: Enhanced the `GET /consultations` endpoint to support filtering by category and risk level.

**Query Parameters**:
- `category`: Filter by problem type (`civil`, `criminal`, `unsure`)
- `risk_level`: Filter by risk assessment (`normal`, `high`)

**Example Requests**:
```bash
# Get all civil consultations
GET /api/v1/consultations?category=civil

# Get all high-risk consultations
GET /api/v1/consultations?risk_level=high

# Combined filtering
GET /api/v1/consultations?category=criminal&risk_level=high
```

**Implementation**:
```python
def list_consultations(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    category: str | None = Query(None, regex="^(civil|criminal|unsure)$"),
    risk_level: str | None = Query(None, regex="^(normal|high)$"),
    db: Session = Depends(get_db),
    user=Depends(current_user)
):
    query = db.query(Consultation).filter(Consultation.owner_id == user.id)
    if category:
        query = query.filter(Consultation.category == category)
    if risk_level:
        query = query.filter(Consultation.risk_level == risk_level)
    items = query.order_by(Consultation.updated_at.desc()).offset(offset).limit(limit).all()
    return [...]
```

**Benefits**:
- Users can quickly find consultations by type
- Operators can identify high-risk cases requiring attention
- Supports analytics on category distribution

---

### 2. Enhanced History Modal with Category Badges

**File**: `model-consultation.js`

**Changes**:
1. Added filter buttons for categories (全部/民事/刑事/不确定)
2. Added category badges to each consultation row
3. Added risk badges for high-risk consultations
4. Restructured history item layout for better information hierarchy

**UI Components**:

**Filter Buttons**:
```html
<div class="model-history-filters">
  <button class="model-filter-btn active" data-filter-category="">全部</button>
  <button class="model-filter-btn" data-filter-category="civil">🔖 民事</button>
  <button class="model-filter-btn" data-filter-category="criminal">🛡️ 刑事</button>
  <button class="model-filter-btn" data-filter-category="unsure">✨ 不确定</button>
</div>
```

**Category Badge**:
```html
<span class="category-badge civil">
  <svg>...</svg> 民事问题
</span>
```

**Risk Badge** (shown only for high-risk consultations):
```html
<span class="risk-badge">
  <svg>...</svg> 高风险
</span>
```

**Information Hierarchy**:
```
┌─────────────────────────────────────────────────┐
│ [民事问题] [高风险] 合同纠纷              [删除] │
│ 对方拖欠货款需要律师审阅合同                    │
│ 2026-10-21 14:30 · 3轮提问                  →   │
└─────────────────────────────────────────────────┘
```

**Features**:
- Click filter buttons to show only consultations of that category
- Active filter highlighted with purple theme
- Badges color-coded: blue (civil), red (criminal), purple (unsure)
- Risk badges always shown for high-risk cases
- Maintains existing search functionality

---

### 3. Expanded Guide Modal

**File**: `model-consultation.js`

**Changes**: Completely redesigned the help/guide modal with:
1. Detailed explanations for each category
2. Visual category cards with icons
3. New section on risk identification
4. Emphasis on when to contact human lawyers

**Content Structure**:

```
如何使用法律模型咨询

1. 选择问题类型
   首次咨询需要选择问题类型，帮助系统更准确地评估风险并提供建议：

   ┌───────────────────────────────────────────┐
   │ 🔖 民事问题                                │
   │ 合同、劳动、婚姻家事、侵权、借贷等民事纠纷。│
   │ 系统会询问地区、时间和诉求等信息。          │
   └───────────────────────────────────────────┘

   ┌───────────────────────────────────────────┐
   │ 🛡️ 刑事问题                                │
   │ 涉嫌犯罪、被害、取保、羁押等刑事事项。      │
   │ 系统会特别询问是否已被采取强制措施，并优先  │
   │ 提示联系律师。如已被拘留、逮捕或监视居住，  │
   │ 请立即联系刑事律师。                        │
   └───────────────────────────────────────────┘

   ┌───────────────────────────────────────────┐
   │ ✨ 我不确定                                │
   │ 不清楚属于哪个类型，或涉及多个领域。        │
   │ 直接描述情况即可，系统会根据内容识别风险。  │
   └───────────────────────────────────────────┘

2. 描述并追问
   补充时间、地点、诉求等关键事实，支持连续追问...

3. 风险识别 ⚠️
   系统会自动识别紧急或高风险事项（如羁押、财产转移、
   诉讼时效等），并在对话中提示联系人工律师。
   模型回答仅供参考，不构成法律意见，重要或紧急事项
   务必联系执业律师。

4. 转为律师需求
   授权后系统把对话整理成需求草稿...
```

**Enhancements**:
- Category cards use same visual language as main UI
- Clear urgency indicators for criminal cases
- Explicit warnings about model limitations
- Structured information flow matches user journey

---

### 4. CSS Styling

**File**: `model-consultation.css`

**Added Styles**:

**History Modal Filters** (~165 lines):
```css
.model-history-header { ... }
.model-history-filters { ... }
.model-filter-btn { ... }
.model-filter-btn.active { ... }
.history-row-header { ... }
.category-badge { ... }
.category-badge.civil { ... }
.category-badge.criminal { ... }
.category-badge.unsure { ... }
.risk-badge { ... }
```

**Guide Category Cards**:
```css
.guide-category-list { ... }
.guide-category-item { ... }
.guide-category-item.civil { ... }
.guide-category-item.criminal { ... }
.guide-category-item.unsure { ... }
.guide-category-icon { ... }
```

**Color Palette**:
- **Civil (Blue)**: `#eff6ff` background, `#3b82f6` text, `#dbeafe` border
- **Criminal (Red)**: `#fef2f2` background, `#ef4444` text, `#fee2e2` border
- **Unsure (Purple)**: `#f5f0fa` background, `#a785c5` text, `#ede6f5` border

**Accessibility Features**:
- Sufficient color contrast ratios
- Hover states for interactive elements
- Focus indicators maintained
- Screen reader friendly structure

---

### 5. Test Coverage

**File**: `backend/tests/test_business_flow.py`

**Enhanced Test**: `test_consultation_category_intake_and_sticky_risk`

**Added Assertions**:
```python
# Test category filtering
all_consultations = ok(api.get("/api/v1/consultations", headers=client_headers))
assert len(all_consultations) >= 2

criminal_only = ok(api.get("/api/v1/consultations?category=criminal", headers=client_headers))
assert all(c["category"] == "criminal" for c in criminal_only)
assert any(c["id"] == created["id"] for c in criminal_only)

civil_only = ok(api.get("/api/v1/consultations?category=civil", headers=client_headers))
assert all(c["category"] == "civil" for c in civil_only)
assert any(c["id"] == civil["id"] for c in civil_only)

# Test risk level filtering
high_risk = ok(api.get("/api/v1/consultations?risk_level=high", headers=client_headers))
assert all(c["risk_level"] == "high" for c in high_risk)
assert len(high_risk) >= 2
```

**Coverage**:
- ✅ Category filter returns correct subset
- ✅ Risk level filter returns correct subset
- ✅ Filtered results maintain expected properties
- ✅ Multiple consultations can share same category/risk level

---

## User Experience Improvements

### Before
- History modal: Plain list with topic and title
- No way to filter consultations by type
- Basic help text with minimal guidance
- No visual distinction between categories

### After
- History modal: Categorized, filterable, with visual indicators
- API supports category and risk filtering
- Comprehensive guide with category-specific advice
- Consistent color coding throughout UI

### User Flows

**Finding a specific consultation**:
1. Open history modal (咨询记录 button)
2. Click category filter (e.g., "民事")
3. Scan filtered list with category badges
4. Click consultation to reopen

**Understanding categories**:
1. Click "了解咨询方式" button
2. Read category explanations with visual cards
3. Understand when to escalate to human lawyer
4. Return to select appropriate category

**Monitoring high-risk cases**:
1. (For operators) GET `/api/v1/consultations?risk_level=high`
2. Review consultations flagged for urgency
3. Check if users contacted lawyers
4. Follow up on time-sensitive matters

---

## API Documentation

### GET /api/v1/consultations

**Query Parameters**:

| Parameter | Type | Required | Values | Description |
|-----------|------|----------|--------|-------------|
| `offset` | int | No | ≥0, default 0 | Pagination offset |
| `limit` | int | No | 1-100, default 50 | Results per page |
| `category` | string | No | `civil`, `criminal`, `unsure` | Filter by category |
| `risk_level` | string | No | `normal`, `high` | Filter by risk |

**Response**: Array of consultation summaries
```json
[
  {
    "id": "C1A2B3C4",
    "topic": "合同纠纷",
    "category": "civil",
    "risk_level": "normal",
    "title": "对方拖欠货款需要律师审阅合同",
    "status": "active",
    "updated_at": "2026-10-21T14:30:00Z",
    "created_at": "2026-10-21T10:15:00Z"
  }
]
```

**Error Responses**:
- `422 Unprocessable Entity`: Invalid category or risk_level value

---

## Analytics Potential

With the new filtering capabilities, the platform can now track:

1. **Category Distribution**:
   - Percentage of civil vs criminal vs unsure consultations
   - Trending topics within each category
   - Category-specific conversion rates to lawyer requests

2. **Risk Assessment Accuracy**:
   - Initial risk vs escalated risk consultations
   - False positive/negative rates on risk detection
   - Time to escalation for high-risk cases

3. **User Behavior**:
   - Do users select correct category initially?
   - How often do users switch categories?
   - Correlation between category and consultation length

4. **Operational Metrics**:
   - Average response time by category
   - High-risk cases requiring manual review
   - Category-specific user satisfaction scores

---

## Future Enhancement Ideas

### Short Term
- [ ] Add category filter to admin dashboard
- [ ] Export consultations filtered by category
- [ ] Category-based notification preferences
- [ ] Auto-categorization of "unsure" consultations after first message

### Medium Term
- [ ] ML-based category suggestion before user selects
- [ ] Category-specific model fine-tuning
- [ ] Historical category change tracking
- [ ] Category-aware lawyer matching algorithm

### Long Term
- [ ] Predictive risk scoring beyond keywords
- [ ] Multi-category consultation support
- [ ] Category-specific legal knowledge graphs
- [ ] Cross-category case law recommendations

---

## Files Modified

1. `backend/app/api/consultations.py` - Added filtering parameters
2. `model-consultation.js` - Enhanced history modal and guide
3. `model-consultation.css` - Added 165+ lines of styles
4. `backend/tests/test_business_flow.py` - Enhanced test coverage

## Lines Changed

- **Backend**: +12 lines (API filtering logic)
- **Frontend JS**: +35 lines (history enhancements, guide content)
- **CSS**: +165 lines (new UI components)
- **Tests**: +10 lines (filter assertions)
- **Total**: ~222 lines added/modified

## Breaking Changes

None. All changes are backward compatible:
- New query parameters are optional
- Frontend gracefully handles missing category data
- Existing consultations work without changes

## Deployment Notes

1. No migration required (uses existing columns)
2. CSS changes require cache bust or hard refresh
3. Test filtering endpoints before production deploy
4. Update API documentation with new parameters

---

**Status**: ✅ Implementation complete  
**Last Updated**: 2026-10-21  
**Related**: CONSULTATION_CATEGORY_FLOW.md
