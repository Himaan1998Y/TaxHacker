# Incident Response Plan — TaxHacker India

*CERT-In Directions 2022: All organizations must report cyber incidents within 6 hours.*

---

## 1. DETECTION

**Monitoring channels:**
- Sentry error alerts (application errors)
- Coolify health checks (infrastructure)
- VPS monitoring (CPU, memory, disk)
- PostgreSQL logs (failed auth, unusual queries)

**Incident types:**
- Data breach (unauthorized access to user data)
- Service outage (application unavailable)
- Malware/ransomware detection
- Unauthorized API access (suspicious Agent API usage)
- DDoS attack

---

## 2. CLASSIFICATION (Within 30 minutes)

| Severity | Definition | Example |
|----------|-----------|---------|
| P0 — Critical | Data breach, unauthorized data access | DB credentials exposed |
| P1 — High | Service outage affecting all users | Container crash loop |
| P2 — Medium | Partial service degradation | AI analysis failing |
| P3 — Low | Minor issue, no data impact | UI rendering bug |

---

## 3. CONTAINMENT (Within 1 hour)

- **Isolate:** Stop affected containers (`docker stop`)
- **Rotate:** Change all secrets (DB password, API keys, auth secret, encryption key)
- **Block:** Firewall rules to block suspicious IPs
- **Preserve:** Take snapshot of affected systems for forensic analysis
- **Communicate:** Alert team via designated channel

---

## 4. CERT-In REPORTING (Within 6 hours — MANDATORY)

**Report to:** incident@cert-in.org.in
**Phone:** 1800-11-4949

**Report must include:**
- Nature of the incident
- Date and time of detection
- Systems affected
- Data potentially exposed
- Containment actions taken
- Contact information for follow-up

**Template:**
```
Subject: Cyber Incident Report — TaxHacker India

Organization: [Legal entity name]
Contact: Himanshu Jain, [phone], [email]
Date detected: [YYYY-MM-DD HH:MM IST]
Incident type: [Data breach / Unauthorized access / Malware / Other]
Systems affected: [TaxHacker web application / Database / File storage]
Data potentially exposed: [Transaction data / Personal info / API keys]
Users affected: [Number]
Containment actions: [List actions taken]
Status: [Contained / Under investigation / Resolved]
```

---

## 5. USER NOTIFICATION (Within 72 hours — DPDP Act)

- Email all affected users
- Explain what data was potentially exposed
- Explain what remediation steps are being taken
- Provide contact for questions

---

## 6. RECOVERY

1. Restore from last clean backup
2. Verify backup integrity
3. Apply security patches
4. Rotate all credentials
5. Re-deploy with fixes
6. Monitor for 48 hours post-recovery

---

## 7. POST-MORTEM (Within 7 days)

- Root cause analysis
- Timeline of events
- What worked / what didn't
- Security control improvements
- Update this plan if needed
- File updated report with CERT-In if required

---

## CONTACTS

| Role | Name | Contact |
|------|------|---------|
| Incident Lead | Himanshu Jain | [phone] |
| CERT-In | National helpline | 1800-11-4949 |
| CERT-In Email | Incident reporting | incident@cert-in.org.in |
| VPS Provider | OVH Support | [support portal] |

---

*This plan must be reviewed and updated every 6 months or after any incident.*
*Last reviewed: 2026-03-29*
