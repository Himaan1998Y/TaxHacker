# TaxHacker Claw Edition — Integration Architecture

*Version: 1.0 | Date: 2026-04-07 | Author: Himanshu Jain + Claude Code*

---

## 1. WHAT IS CLAW (And What It Is Not)

**TaxHacker** is the accounting engine: stores transactions, parses invoices, computes GST, generates reports. It is a database + API with a web UI. No conversational interface.

**Claw** is the conversational skin: it lets you talk to TaxHacker via WhatsApp or Telegram. Claw does NOT store financial data. It does NOT compute GST. It translates natural language into TaxHacker API calls and formats the responses as human-friendly messages.

The division of responsibility is absolute:

```
  CLAW owns:                    TAXHACKER owns:
  -------------                 --------------------
  Conversation state            All transaction data
  Intent classification         GST calculations
  LLM context window            GSTR-1/GSTR-3B reports
  Message formatting            File storage & AI analysis
  Channel adapters              Authentication & rate limiting
  User session memory           Business logic & validation
  Alert scheduling              Database (PostgreSQL + pgvector)
```

---

## 2. SYSTEM DESIGN

```
[User WhatsApp/Telegram]
        |
        v
[CLAW LAYER - nano-claw Docker container]
  - Channel adapters (Telegram Bot API, Evolution API for WA)
  - Intent Router (LLM call #1: classify + extract params)
  - Session Store (Redis, 8-turn history + context snapshot)
  - Intent Handlers (one per supported action)
  - Response Formatter (LLM call #2: natural language reply)
  - LLM: OpenRouter -> gemini-flash-2.0 (primary), mistral-small (fallback)
        |
        | X-Agent-Key auth (SHA-256)
        | Internal Docker network (no public hop)
        v
[TAXHACKER AGENT API - Next.js 15 on port 3000]
  GET  /api/agent/transactions
  POST /api/agent/transactions
  GET  /api/agent/transactions/:id
  PUT  /api/agent/transactions/:id    (MISSING - add in Phase 3)
  POST /api/agent/files
  POST /api/agent/analyze
  GET  /api/agent/digest
  GET  /api/agent/search
  GET  /api/agent/gstr1
  GET  /api/agent/gstr3b
  GET  /api/agent/setup
        |
        v
[PostgreSQL 18 + pgvector + File System + LangChain AI]
```

---

## 3. DATA FLOW EXAMPLES

### 3.1 Add Transaction by Text

```
User (Telegram): "Paid 1450 to Swiggy for team lunch yesterday"
  -> Channel adapter normalizes message
  -> Session manager loads last 8 turns + context snapshot
  -> Intent Router (LLM call #1, ~200 tokens):
       intent: "add_transaction"
       extracted: { merchant: "Swiggy", amount: 145000, date: "2026-04-06",
                    type: "expense", category_hint: "food/meals" }
  -> Handler: POST /api/agent/transactions
  -> TaxHacker creates transaction, returns id
  -> Response Formatter (LLM call #2, ~100 tokens):
       "Done. Recorded Rs. 1,450 expense at Swiggy (Meals & Entertainment)
        for Apr 6. Food spend this month: Rs. 8,340."
  -> Sent back to user
```

### 3.2 Receipt Upload Flow

```
User sends photo of invoice
  -> Channel downloads media buffer
  -> Intent: upload_receipt (auto-detected from attachment)
  -> Step 1: POST /api/agent/files (multipart) -> { fileId }
  -> Step 2: POST /api/agent/analyze { fileId } -> extracted data
  -> Step 3: POST /api/agent/transactions (from extracted data)
  -> Reply: "Invoice from Zomato Platform Pvt Ltd processed.
             Rs. 2,360 (incl. GST Rs. 360 at 18%). GSTIN: 27AAJCZ...
             Saved under Business Expenses. Want to change anything?"
```

### 3.3 Spend Query Flow

```
User: "How much did I spend on travel this month?"
  -> Intent: query_spend, filters: { category: travel, dateFrom: 2026-04-01 }
  -> GET /api/agent/transactions?categoryCode=travel&dateFrom=...
  -> Reply: "Travel spend Apr 1-7: Rs. 45,000
             Top entries: Uber Rs. 12,000 | IndiGo Rs. 28,000 | Parking Rs. 5,000"
```

---

## 4. LLM CONTEXT STRUCTURE

Claw makes exactly 2 LLM calls per user message: classify intent, then format response. Context is bounded to keep token spend predictable.

### 4.1 System Prompt (~400 tokens, static per session)

```
You are a financial assistant for {businessName}, an Indian SME.
GSTIN: {gstin}. Currency: INR. Today: {date}. FY: April to March.

You help the user:
- Add income and expenses by natural language
- Query spending by category, date range, merchant
- Understand GST liability
- Get daily/monthly/quarterly summaries

Rules:
- Respond in the same language the user writes in (Hindi, English, Hinglish all fine)
- All amounts are INR unless stated. Storage format is paisa (Rs. 1,450 = 145000).
- Dates default to today. "last month" = calendar month, not rolling 30 days.
- Available categories: {category_list}
- Available projects: {project_list}

Return intent classification as JSON. Never make up transaction data.
```

### 4.2 Context Snapshot (~300 tokens, Redis-cached, 1h TTL)

Populated by GET /api/agent/digest. Lets the LLM answer follow-up questions without a live API call on every message.

```json
{
  "month_summary": {
    "income": 125000000,
    "expense": 89000000,
    "net": 36000000,
    "gst_collected": 12500000,
    "gst_paid": 8900000
  },
  "top_categories": ["travel", "meals_entertainment", "software"],
  "recent_merchants": ["Swiggy", "Uber", "AWS", "Zomato"],
  "pending_gst_period": "032026",
  "open_invoice_count": 3
}
```

### 4.3 Conversation History (last 8 turns, ~500 tokens max)

Bounded to 8 turns. Older messages drop FIFO. Financial data is authoritative in TaxHacker's database, not in chat history.

### 4.4 Total Context Budget Per Request

| Component | Tokens | Refresh Cadence |
|-----------|--------|-----------------|
| System prompt | ~400 | Static per session |
| Context snapshot | ~300 | 1h TTL (Redis) |
| Conversation history | ~500 | Every message |
| Current message + intent schema | ~200 | Every message |
| **Total per request** | **~1,400** | — |

At Gemini Flash 2.0 pricing (~$0.075/1M tokens): $0.0001 per message. 1,000 messages/day = ~$3/month.

---

## 5. INTEGRATION POINTS WITH EXISTING AGENT API

### 5.1 Claw-to-TaxHacker Endpoint Map

| Claw Intent | HTTP Method + Path | Notes |
|-------------|-------------------|-------|
| add_transaction | POST /api/agent/transactions | total in paisa (integer) |
| edit_transaction | PUT /api/agent/transactions/:id | **MISSING** - Phase 3 addition |
| query_spend | GET /api/agent/transactions | search, dateFrom, dateTo, categoryCode |
| upload_receipt | POST /api/agent/files | multipart/form-data, returns fileId |
| analyze_receipt | POST /api/agent/analyze | { fileId } -> structured extraction |
| daily_digest | GET /api/agent/digest?date=today | stats + 10 recent transactions |
| monthly_summary | GET /api/agent/digest?dateFrom=&dateTo= | custom range |
| gst_summary | GET /api/agent/gstr1?period=MMYYYY | full GSTR-1 data |
| semantic_search | GET /api/agent/search?q= | pgvector cosine similarity |
| session_bootstrap | GET /api/agent/setup | categories, projects, settings |

### 5.2 Authentication Contract

```
Header:     X-Agent-Key: thk_{64 hex chars}
Server:     SHA-256 hash incoming key, timing-safe compare against stored hash
Storage:    Settings table, code "agent_api_key", encrypted at rest via decrypt()
Rate limit: 60 req/min per user (in-process Map)
Mode:       Self-hosted only. Cloud mode returns 403.
```

### 5.3 ONE Missing Endpoint (the only TaxHacker code change needed)

`PUT /api/agent/transactions/:id` does not exist. Adding it requires ~40 lines following the same pattern as POST handler. This is the **only TaxHacker code change** needed across all Claw phases.

### 5.4 Zero TaxHacker Changes for MVP

Phases 1 and 2 (working Telegram bot) require no changes to TaxHacker. TaxHacker is a black box that Claw calls over HTTP.

---

## 6. SCOPE: MVP vs FULL

### MVP - Basic CRUD via Chat (Phases 1-3, 5.5 developer days)

| Capability | Input | Output |
|------------|-------|--------|
| Add expense | "Paid 500 to Swiggy" | Confirmation + category |
| Add income | "Received 50K from client" | Confirmation |
| Upload receipt photo | Photo or PDF | AI-extracted + saved + confirmed |
| Query spend | "How much on travel this month?" | Amount + top transactions |
| Daily digest | "What happened today?" | Income/expense count + totals |
| GST query | "What's my GST this quarter?" | GSTR-1 summary figures |
| Edit entry | "Make that 600 not 500" | Updated confirmation |
| Semantic search | "Show petrol expenses" | Matching transactions |

**Not in MVP**: bulk CSV import, PDF report delivery via chat, scheduled proactive alerts, WhatsApp Business API (Telegram first), voice note transcription.

### Full - Analysis, Recommendations, Alerts (Phase 4+, weeks 5-12)

| Capability | What It Adds |
|------------|-------------|
| Proactive alerts | "No expenses logged in 3 days" |
| Tax deadline warnings | "GSTR-1 due in 5 days. Estimated: Rs. 28,400." |
| Spend anomaly detection | "Travel up 80% vs last month" |
| CA report sharing | GSTR-1 PDF sent to CA's WhatsApp number |
| Voice note support | Audio -> Whisper transcription -> intent pipeline |
| Reminder scheduling | "Remind me to record petrol every Friday 6pm" |
| WhatsApp Business API | Production channel via Evolution API |
| AATO projection | "At this rate you exceed Rs. 40L by December" |
| Email receipt forwarding | Forward bill email -> auto-processed |
| Hindi/Hinglish auto-response | Detect locale, respond in kind |

---

## 7. CLAW INTERNAL FILE STRUCTURE

```
nano-claw/
├── src/
│   ├── index.ts                  Entry point, starts all channel listeners
│   ├── channels/
│   │   ├── telegram.ts           Telegram Bot API adapter (Phase 2)
│   │   └── whatsapp.ts           Evolution API adapter (Phase 4)
│   ├── core/
│   │   ├── intent.ts             LLM call #1 - classify intent + extract params
│   │   ├── context.ts            Build LLM context from session + API snapshot
│   │   ├── session.ts            Redis session load/save/expire
│   │   └── formatter.ts          LLM call #2 - format API response as message
│   ├── handlers/
│   │   ├── add_transaction.ts
│   │   ├── query_spend.ts
│   │   ├── upload_receipt.ts
│   │   ├── daily_digest.ts
│   │   ├── gst_summary.ts
│   │   ├── edit_transaction.ts
│   │   └── semantic_search.ts
│   ├── api/
│   │   └── taxhacker.ts          Typed wrapper for all Agent API endpoints
│   └── config.ts                 Env vars, LLM config, TaxHacker base URL
├── docker-compose.yml
├── .env.example
└── package.json
```

### Session Shape (Redis key: `session:{userId}`)

```typescript
interface ClawSession {
  userId:         string
  channelId:      string           // Telegram chat ID or WhatsApp number
  history:        Message[]        // last 8 turns, FIFO eviction
  contextSnap:    ContextSnapshot
  contextSnapAge: number           // unix ms, refresh when > 1h old
  lastActive:     number
  locale:         "en" | "hi" | "hinglish"
}

interface ContextSnapshot {
  monthIncome:        number       // paisa
  monthExpense:       number       // paisa
  gstCollected:       number       // paisa
  gstPaid:            number       // paisa
  topCategories:      string[]
  recentMerchants:    string[]
  openInvoiceCount:   number
  pendingGstPeriod:   string | null
}
```

---

## 8. DEPLOYMENT TOPOLOGY

```
OVH VPS (8 cores, 22GB RAM)
├── Coolify
│   ├── taxhacker    port 3000  ->  taxhacker.yourdomain.com  (Traefik)
│   │   ├── Next.js 15 app
│   │   └── PostgreSQL 18 with pgvector
│   │
│   └── nano-claw   port 4000  ->  no public exposure needed
│       ├── Node.js 24 service
│       └── Redis on port 6379 (shared with existing VPS services)
│
└── [existing] SearXNG, Crawl4ai, n8n, LightPanda
```

Claw communicates with TaxHacker over Docker's internal network via `http://taxhacker:3000`. No public internet hop. Telegram/WhatsApp push webhooks to Claw via Traefik routing to `/claw/webhook`.

### Environment Variables (`.env` for nano-claw)

```
TAXHACKER_BASE_URL=http://taxhacker:3000
TAXHACKER_AGENT_KEY=thk_...
OPENROUTER_API_KEY=...
TELEGRAM_BOT_TOKEN=...
REDIS_URL=redis://redis:6379
CLAW_WEBHOOK_SECRET=...
EVOLUTION_API_URL=...     # Phase 4 only
EVOLUTION_API_KEY=...     # Phase 4 only
```

---

## 9. IMPLEMENTATION TIMELINE

### Phase 1 - Core Pipeline (Week 1, ~2 developer days)

| Task | Hours | Output File |
|------|-------|-------------|
| Scaffold repo (TypeScript, Docker Compose) | 2h | Project structure |
| TaxHacker API wrapper, typed client for all 9 endpoints | 3h | api/taxhacker.ts |
| Redis session manager (load/save/expire) | 2h | core/session.ts |
| LLM context builder | 2h | core/context.ts |
| Intent classifier (LLM call #1, structured JSON output) | 3h | core/intent.ts |
| Response formatter (LLM call #2, natural language) | 2h | core/formatter.ts |

**Deliverable**: Full pipeline unit-tested end-to-end without a real channel.

### Phase 2 - Telegram Bot (Week 2, ~2 developer days)

| Task | Hours | Output |
|------|-------|--------|
| Telegram channel adapter (webhook receive + send) | 3h | channels/telegram.ts |
| Handler: add_transaction | 2h | Text -> create transaction |
| Handler: query_spend (date/category filter) | 2h | Spend summary reply |
| Handler: daily_digest | 1h | "What happened today?" |
| Handler: upload_receipt (3-step: upload, analyze, save) | 3h | Photo processing |
| Deploy to VPS, end-to-end test with real Telegram | 2h | Live bot |

**Deliverable**: Working Telegram bot deployed on VPS. Personal daily use begins.

### Phase 3 - Polish + Full MVP Scope (Week 3, ~1.5 developer days)

| Task | Hours | Notes |
|------|-------|-------|
| Add PUT /api/agent/transactions/:id to TaxHacker | 1.5h | **Only TaxHacker code change** |
| Handler: edit_transaction | 2h | "Change that to Rs. 600" |
| Handler: gst_summary | 1.5h | Monthly/quarterly GST |
| Handler: semantic_search | 1h | "Show petrol expenses" |
| Hindi/Hinglish locale detection + prompt tuning | 2h | Respond in kind |
| Error handling (never surface raw API errors to user) | 2h | Graceful failures |

**Deliverable**: All 8 intents working. Full MVP scope complete.

### Phase 4 - WhatsApp + Proactive Features (Weeks 5-8, ~8 developer days)

| Task | Hours | Outcome |
|------|-------|---------|
| Evolution API WhatsApp adapter | 3h | WA channel live |
| Cron-based proactive alert system | 4h | GST reminders, inactivity alerts |
| Spend anomaly detection (MTD vs prior month) | 3h | Trend warnings |
| GSTR-1 PDF delivery via chat | 4h | CA sharing use case |
| Voice note pipeline (Whisper transcription) | 4h | Audio messages supported |

---

## 10. EFFORT AND COST SUMMARY

| Phase | Developer Days | LLM Cost/month | Infra Cost |
|-------|---------------|----------------|------------|
| Phase 1 - Foundation | 2 | — | — |
| Phase 2 - Telegram MVP | 2 | ~$3 | 0 (Redis already on VPS) |
| Phase 3 - Full MVP | 1.5 | ~$3 | 0 |
| Phase 4 - WhatsApp + Alerts | 8 | ~$5 | 0 (Evolution API self-hosted) |
| **Total MVP (P1+P2+P3)** | **5.5 days** | **~$3/month** | **free** |

---

## 11. RISKS AND MITIGATIONS

| Risk | Probability | Mitigation |
|------|-------------|------------|
| LLM misclassifies intent | Medium | Echo extracted data before writing; edit handler covers corrections |
| LLM hallucinates amounts | Low | Always confirm extracted values in message before saving |
| WhatsApp Business API rejection by Meta | Medium | Telegram-first; WA is Phase 4, not Phase 2 |
| Redis session loss on VPS restart | Low | Redis AOF persistence; history is convenience not source of truth |
| TaxHacker rate limit (60 req/min) | Low | Single-user personal use; 60/min is ample |
| VPS data residency in France | High | Already flagged in TAXHACKER_DNA.md; migrate to Mumbai before multi-tenant |

---

## 12. WHAT CHANGES WHEN CLAW IS LIVE

**Before Claw**: "Upload your invoices to a web app when you get around to it."

**After Claw**: "Forward any bill to this number right now. It is filed automatically."

That is the difference between software and a service. It is also the pitch that closes at Rs. 5,000/month per client with zero training required, because everyone already knows how to forward a WhatsApp photo.

The accounting engine is built. Claw is the last-mile delivery mechanism.

---

## KEY ARCHITECTURAL DECISIONS

**Separation boundary**: Claw owns nothing financial. It is a stateless translation layer. Redeploy, reset, or replace Claw without touching any accounting data. TaxHacker is the single source of truth.

**2 LLM calls per message maximum**: Call 1 classifies intent and extracts structured parameters. Call 2 formats the response naturally. Keeps latency under 2 seconds and cost at $3/month for personal use.

**Context snapshot pattern**: Rather than querying TaxHacker on every message, a snapshot is cached in Redis for 1 hour via /api/agent/digest. 90% of conversations need no extra API call for context.

**Telegram before WhatsApp**: Telegram Bot API requires no approval, no business registration, no Meta review. Working bot in hours. WhatsApp Business API takes weeks of Meta approval. Phase 2 ships fully functional Telegram. WhatsApp is Phase 4 upgrade.

**One missing endpoint in TaxHacker**: PUT /api/agent/transactions/:id is the only TaxHacker code change needed across all Claw phases. ~40 lines.

**Revenue unlock**: The service pitch changes from "here is a web app" to "forward your bills here and I handle the rest." That is what closes at Rs. 5,000/month.

---

*This document is the implementation-ready specification for TaxHacker Claw Edition.*
*Next action: scaffold the nano-claw repository and begin Phase 1.*
