# Tier 2 Manual Smoke Tests

**Status**: Post-deployment verification checklist  
**Date**: 2026-04-10  
**Total Tests**: 3 critical paths

---

## Test 1: Dashboard GST Widget (Wave B.1)

**Purpose**: Verify GST consolidation refactor doesn't change reported totals  
**Risk Level**: MEDIUM (active user-facing feature)

### Prerequisites
- Staging/production deployment complete
- At least one transaction with GST in the test account

### Steps

1. **Navigate to dashboard**
   ```
   Open: https://your-domain/dashboard
   ```

2. **Observe GST Summary widget**
   - Widget should display:
     - Rate breakdown (5%, 12%, 18%, 28%)
     - Input GST (paid) per rate
     - Output GST (collected) per rate
     - Total Input, Total Output, Net Payable
   - Widget should NOT display error or be empty

3. **Verify totals match pre-refactor**
   - Before refactor: total was X.XX INR (record this from git log or screenshot)
   - After refactor: total should be X.XX INR (exactly the same)
   - Rounding should match (no extra decimals or truncation)

4. **Test with filters** (if applicable)
   - Apply date range filter
   - Widget should update
   - Totals should still be correct

5. **Check browser console**
   - No JS errors
   - No warnings related to "GSTSummaryResult" or "getGSTSummary"

### Expected Behavior
✅ Widget renders with unchanged totals  
✅ No console errors  
✅ Breakdown matches individual slab calculations  

### Rollback
If totals differ: `git revert d0168f7` (revert GST consolidation)

---

## Test 2: Legacy Auth Cutoff (Wave B.2)

**Purpose**: Verify legacy cookie deprecation infrastructure is in place  
**Risk Level**: LOW (cutoff is 2026-05-01, 3 weeks future)

### Prerequisites
- Self-hosted deployment with password enabled
- Access to logs

### Steps

1. **Check startup logs**
   ```
   docker logs <container-id> | grep "Legacy auth"
   ```
   Expected output (before 2026-05-01):
   ```
   [TaxHacker] Legacy auth cookie migration window: 21 days remaining.
   After 2026-05-01, old SHA-256 cookies will be rejected.
   ```

2. **Verify code is in place**
   - Confirm `LEGACY_AUTH_CUTOFF` constant exists in `lib/self-hosted-auth.ts`
   - Confirm middleware checks cutoff date in `middleware.ts:136`
   - Confirm startup log in `instrumentation.ts`

3. **Test old token rejection** (optional, requires manual cookie manipulation)
   - Get old SHA-256 cookie value (if available from archive)
   - Manually set `taxhacker_sh_auth` cookie to old value
   - Reload dashboard
   - Should reject and redirect to `/self-hosted-login` (after 2026-05-01)

4. **No action needed before 2026-05-01**
   - This test is verification only
   - Actual user impact (re-login requirement) happens after cutoff date

### Expected Behavior
✅ Startup log shows countdown or "cutoff reached"  
✅ Middleware has cutoff check in place  
✅ No users affected before 2026-05-01  

### Rollback
If you need to extend cutoff: edit `LEGACY_AUTH_CUTOFF` in `lib/self-hosted-auth.ts`

---

## Test 3: Audit Log DLQ (Wave C) — **CRITICAL**

**Purpose**: Verify audit logs survive temporary DB outages  
**Risk Level**: HIGH (compliance-critical, Companies Act 2023)

### Prerequisites
- Staging deployment (do NOT do this in production without backup)
- Container with writable `/app/data` volume
- SSH/Docker access to running container
- Database that can be killed/restarted

### Setup

```bash
# SSH into VPS
ssh -i ~/.ssh/ovh_vps3_key -p 49222 antigravity@57.129.125.171

# Navigate to Coolify container
# Find the running TaxHacker container
docker ps | grep taxhacker

# Verify /app/data is mounted
docker inspect <container-id> | grep -A5 "Mounts"
# Should show: /app/data mounted as volume
```

### Scenario A: Transient DB Failure (Core Test)

#### Phase 1: Trigger DLQ Write
```bash
# 1. Start monitoring DLQ file (in another terminal)
docker exec <container-id> tail -f /app/data/audit-dlq.jsonl

# 2. Kill the database (or network-disconnect it)
docker exec <container-id> systemctl stop postgres
# OR: Create transaction in UI while DB is unreachable

# 3. Open another terminal and trigger audit event:
#    - Login to the app
#    - Create a transaction (any invoice/receipt)
#    - Expected: Request times out or returns 500

# 4. Check DLQ file was created
docker exec <container-id> ls -la /app/data/audit-dlq.jsonl
# Expected: File exists, contains JSON entry

# 5. Inspect DLQ content
docker exec <container-id> cat /app/data/audit-dlq.jsonl | head -1
# Expected: {"userId":"...", "entityType":"transaction", ...}
```

#### Phase 2: Drain on DB Recovery
```bash
# 1. Restart database
docker exec <container-id> systemctl start postgres

# 2. Wait for postgres to be ready
docker exec <container-id> pg_isready -h localhost
# Expected: accepting connections

# 3. Restart the app container (triggers instrumentation.register → drainDLQ)
docker restart <container-id>

# 4. Check startup logs
docker logs <container-id> | tail -30 | grep -i "dlq\|audit\|drained"
# Expected: "[TaxHacker] Drained N audit log entries from DLQ at startup"

# 5. Verify DLQ file is deleted
docker exec <container-id> ls -la /app/data/audit-dlq.jsonl 2>&1
# Expected: "No such file or directory"

# 6. Verify entry is in database
docker exec <container-id> psql -U postgres -d taxhacker -c \
  "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 1;"
# Expected: Entry from the transaction created during DB outage exists
```

#### Phase 3: Verify No Data Loss
```bash
# In the UI:
# 1. Navigate to Admin > Audit Log page (if visible)
# 2. Filter to recent entries
# 3. Verify the transaction created during DB outage appears
# Expected: Audit entry is complete and consistent
```

### Scenario B: Persistent DB Failure (Alert Test)

#### Phase 1: Keep DB Down, Drain Fails
```bash
# 1. Stop database
docker exec <container-id> systemctl stop postgres

# 2. Restart the app container
docker restart <container-id>

# 3. Check startup logs for alert
docker logs <container-id> | grep -i "persistent\|ALERT\|DLQ"
# Expected: "[TaxHacker] ALERT: Audit log DLQ file still exists after drain"

# 4. Verify DLQ file is still present (drain failed)
docker exec <container-id> ls -la /app/data/audit-dlq.jsonl
# Expected: File exists (not drained due to DB unavailable)
```

#### Phase 2: Recovery and Drain
```bash
# 1. Restart database
docker exec <container-id> systemctl start postgres

# 2. Restart app again
docker restart <container-id>

# 3. Check logs for successful drain
docker logs <container-id> | grep -i "drained"
# Expected: "[TaxHacker] Drained N audit log entries from DLQ at startup"

# 4. Verify DLQ is now empty
docker exec <container-id> ls -la /app/data/audit-dlq.jsonl 2>&1
# Expected: "No such file or directory"
```

### Scenario C: Disk Full (Error Handling Test)

#### Phase 1: Simulate Disk Full
```bash
# 1. Fill the /app/data volume (or /app/data/audit-dlq.jsonl specifically)
docker exec <container-id> dd if=/dev/zero of=/app/data/audit-dlq.jsonl.tmp bs=1M count=<large>
# This will eventually trigger disk full

# 2. Trigger an audit event
#    Expected: logAudit throws "No space left on device"

# 3. Check logs
docker logs <container-id> | grep -i "critical"
# Expected: "[TaxHacker CRITICAL: Audit logging failed on both DB and DLQ file"
```

#### Phase 2: Recovery
```bash
# 1. Free up disk space
docker exec <container-id> rm /app/data/audit-dlq.jsonl.tmp

# 2. Create another transaction
#    Expected: Succeeds normally (DB works, DLQ works)

# 3. Verify in audit log
```

### Expected Behavior Summary

| Scenario | Phase | Expected Result |
|----------|-------|-----------------|
| **Transient Outage** | 1: DB down | DLQ file created ✓ |
| | 2: DB recovers | DLQ drained, file deleted ✓ |
| | 3: UI check | Audit entry exists ✓ |
| **Persistent Outage** | 1: DB down→restart | Drain fails, alert logged ✓ |
| | 2: DB recovers | DLQ drained on retry ✓ |
| **Disk Full** | 1: No space | CRITICAL error logged ✓ |
| | 2: Space freed | Normal operation resumes ✓ |

---

## Checklist

### Pre-Deployment
- [ ] All 12 Tier 2 commits applied
- [ ] 239/239 tests passing locally
- [ ] CI/CD pipeline green
- [ ] Backup of production database taken (if deploying to prod)

### Deployment
- [ ] Code deployed to staging
- [ ] Containers restarted
- [ ] Startup logs checked (no errors)

### Post-Deployment
- [ ] Test 1: Dashboard GST widget renders correctly
- [ ] Test 2: Startup logs show legacy auth countdown
- [ ] Test 3a: Transient DB outage → DLQ created → entry recovered
- [ ] Test 3b: Persistent outage → alert logged → recovery works
- [ ] Test 3c: Disk full → critical error → recovery works
- [ ] Rollback procedure documented and tested (if needed)

### Sign-Off
- [ ] All critical tests passed
- [ ] No regressions observed
- [ ] Audit log DLQ is operational (if applicable to deployment)
- [ ] Ready for production deployment

---

## Rollback Procedures

### Rollback Entire Tier 2
```bash
git reset --hard d26fdde  # Back to pre-Tier 2 state (Tier 1 final commit)
```

### Rollback Specific Item
```bash
git revert 74ec4c7  # Revert DLQ (2.4)
git revert b719621  # Revert agent embeddings probe (2.11)
git revert 187ae9f  # Revert embeddings refactor (2.9)
git revert c91e6de  # Revert auth cutoff (2.10)
git revert d0168f7  # Revert GST consolidation (2.13+2.3)
git revert 3c501bd  # Revert parseLocalDate (2.2)
git revert 2e7dbdd  # Revert Promise.all (2.1)
git revert f60e783  # Revert Sentry warning (2.6)
git revert d705446  # Revert axios patch
git revert 64a3502  # Revert matchesKeyword (2.12)
git revert b70db43  # Revert console.log cleanup (2.8)
git revert 76e5bf5  # Revert hasCurrencySet (2.5)
```

---

## Notes

- **DLQ file location**: `/app/data/audit-dlq.jsonl` (must be in mounted volume)
- **DLQ drain timing**: Happens at container startup (Node runtime registration)
- **Log file**: Check `docker logs <container>` for "[TaxHacker]" prefixed messages
- **Database access**: Requires `psql` or admin panel access to verify audit entries
- **Test data**: Use throwaway transactions; don't use customer data for failure tests
