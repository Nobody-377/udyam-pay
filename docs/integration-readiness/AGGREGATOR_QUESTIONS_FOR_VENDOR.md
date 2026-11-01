# Udhyam PAY — Aggregator Discovery & Due Diligence Questionnaire

**Document Reference**: `docs/integration-readiness/AGGREGATOR_QUESTIONS_FOR_VENDOR.md`  
**Date**: November 2026  
**Audience**: Prospective Lending Aggregators (e.g. FinBox, Setu, or equivalent), Technical Solutions Architects, Partnership Directors  
**Context**: Technical Discovery & Contractual Evaluation for In-Store Consumer Durable Checkout Financing  

---

## Instructions for Vendor & Partnership Team

Udhyam PAY is an in-store POS checkout financing platform enabling retail electronics customers to purchase smartphones, laptops, and home appliances on EMI.

Every question below is categorized with our current assessment status:
- `[ ] Confirmed by Evidence`: Verified by official documentation or test credentials.
- `[?] Requires Clarification`: Partially understood, but operational/technical specifics are pending.
- `[N/A] Not Applicable`: Irrelevant to our consumer durable checkout model.
- `[!] Unknown / Blocker`: Unresolved dependency that blocks sandbox integration or commercial signing.

---

## Section 1: Technical Architecture & API Access

| # | Question / Requirement | Status | Vendor Response / Resolution |
| :-: | :--- | :-: | :--- |
| **1.1** | Can you provide an official OpenAPI 3.0 / Swagger JSON specification covering all application origination, offer retrieval, KYC, mandate, and disbursement webhooks? | `[?] Requires Clarification` | |
| **1.2** | What authentication scheme is required for server-to-server API calls (e.g. OAuth2 Bearer Tokens, API Key + Client Secret, or mTLS with client certificates)? | `[?] Requires Clarification` | |
| **1.3** | Do you provide a Postman Collection with functional pre-configured sandbox environments, realistic headers, and script assertions? | `[?] Requires Clarification` | |
| **1.4** | What is the API rate limit policy (sustained requests per second, burst allowance, and IP concurrency limits)? How are limits enforced (HTTP 429 with `Retry-After`)? | `[?] Requires Clarification` | |
| **1.5** | How is idempotency supported on application submissions (e.g. `Idempotency-Key` or `X-Request-Id` header)? What is the idempotency cache TTL (24h, 7d)? | `[?] Requires Clarification` | |
| **1.6** | What is your API versioning and breaking-change deprecation policy? What notice period is guaranteed before deprecating an endpoint version? | `[?] Requires Clarification` | |
| **1.7** | What are the exact sandbox URL and production base URL structures? Are sandbox services isolated from live bureau inquiries and banking networks? | `[!] Unknown / Blocker` | |
| **1.8** | Do you support IP whitelisting for our outbound production servers? What is the turnaround time for updating whitelisted IP addresses? | `[?] Requires Clarification` | |

---

## Section 2: Webhooks, Signatures & Asynchronous Handshakes

| # | Question / Requirement | Status | Vendor Response / Resolution |
| :-: | :--- | :-: | :--- |
| **2.1** | What is the exact cryptographic signature mechanism for inbound webhooks (e.g. HMAC-SHA256, Ed25519, or RSA signatures)? Which request headers carry the signature and timestamp? | `[?] Requires Clarification` | |
| **2.2** | Does your webhook engine sign the raw request body including timestamps to defend against replay attacks? What is the recommended replay window tolerance (e.g. 300 seconds)? | `[?] Requires Clarification` | |
| **2.3** | What is your automated retry schedule if our webhook endpoint returns HTTP 5xx or times out (e.g. exponential backoff over 24 hours)? | `[?] Requires Clarification` | |
| **2.4** | What is your expected webhook response SLA (e.g. synchronous HTTP 200 OK within 500ms before background processing)? | `[ ] Confirmed by Evidence` | Udhyam PAY returns 200 OK immediately and processes in background. |
| **2.5** | Can multiple webhook endpoints be registered per environment (e.g. separate URLs for staging, UAT, and production)? | `[?] Requires Clarification` | |
| **2.6** | Do you provide an event replay or manual re-dispatch mechanism via your partner portal for incident remediation? | `[?] Requires Clarification` | |

---

## Section 3: Lender Coverage & Credit Products

| # | Question / Requirement | Status | Vendor Response / Resolution |
| :-: | :--- | :-: | :--- |
| **3.1** | Which specific commercial Banks and NBFCs are actively live and disbursing through your platform for consumer electronics checkout loans? | `[!] Unknown / Blocker` | |
| **3.2** | What are the minimum and maximum loan ticket sizes supported by your partner lenders (Udhyam target: Rs 10,000 to Rs 2,50,000)? | `[?] Requires Clarification` | |
| **3.3** | What loan tenures are available across partner lenders (e.g. 3, 6, 9, 12, 18, 24 months)? | `[?] Requires Clarification` | |
| **3.4** | Do partner lenders support **0% Subvented EMI** (where the merchant or OEM manufacturer subvents the interest)? How are subvention fees deducted or invoiced? | `[!] Unknown / Blocker` | Critical for in-store consumer electronics conversion. |
| **3.5** | What customer demographics and employment types are eligible (salaried, self-employed, gig-workers, new-to-credit)? | `[?] Requires Clarification` | |
| **3.6** | What is the geographical coverage across Tier 1, Tier 2, and Tier 3 Indian pincodes? Are there restricted states or negative pincode lists? | `[?] Requires Clarification` | |
| **3.7** | What are the average end-to-end turnaround times (TAT) from customer QR scan to final loan disbursement sanction? | `[?] Requires Clarification` | Target: Under 5 minutes for in-store checkout. |

---

## Section 4: Workflow Control & Customer Journey

| # | Question / Requirement | Status | Vendor Response / Resolution |
| :-: | :--- | :-: | :--- |
| **4.1** | Do you support a **Headless Server-to-Server API** where Udhyam PAY renders all UI screens, or is an **Embedded Webview / SDK** mandatory for customer interaction? | `[!] Unknown / Blocker` | Determines frontend architecture and DPDP data scope. |
| **4.2** | If an Embedded Webview or Web SDK is required, can it be fully white-labeled or co-branded with Udhyam PAY and the retail merchant's branding? | `[?] Requires Clarification` | |
| **4.3** | In multi-lender scenarios, does your API return **all qualifying offers** simultaneously (discovery mode) so Udhyam PAY can present a comparison table to the customer? | `[!] Unknown / Blocker` | Core feature of Udhyam PAY. |
| **4.4** | Can Udhyam PAY dictate or influence the lender waterfall priority via API configuration, or does your engine enforce rigid algorithmic routing? | `[?] Requires Clarification` | |
| **4.5** | How does the journey handle fallback if the customer's primary chosen lender declines during underwriting? Does it automatically fall back to the secondary pre-approved offer? | `[?] Requires Clarification` | |
| **4.6** | If underwriting requires additional documentation (e.g. bank statements), how is the user notified and where are files uploaded? | `[?] Requires Clarification` | |

---

## Section 5: KYC, Underwriting, Mandate & e-Sign

| # | Question / Requirement | Status | Vendor Response / Resolution |
| :-: | :--- | :-: | :--- |
| **5.1** | Which Credit Bureaus are pulled (CIBIL, Experian, Equifax, CRIF High Mark)? Does the aggregator absorb bureau pull costs or pass them through? | `[?] Requires Clarification` | |
| **5.2** | How is customer KYC executed? Do you support DigiLocker, Aadhaar OTP XML, and CKYC lookup? | `[?] Requires Clarification` | |
| **5.3** | Does Udhyam PAY ever need to handle or store raw Aadhaar numbers or OTPs, or is this entirely confined within your compliant environment? | `[ ] Confirmed by Evidence` | Udhyam PAY database stores zero Aadhaar/PAN. Must stay in aggregator view. |
| **5.4** | How is bank account verification conducted (Penny Drop IMPS vs UPI reverse penny drop)? What name-match confidence threshold is enforced by lenders? | `[?] Requires Clarification` | |
| **5.5** | What methods are supported for electronic mandates (e-NACH NetBanking, Debit Card, UPI Autopay)? What is the failure / drop-off rate on UPI Autopay? | `[?] Requires Clarification` | |
| **5.6** | How is the digital loan agreement executed? Do you integrate with an Electronic Signature Provider (e.g. Digio, Leegality, NSDL) for Aadhaar e-Sign? | `[?] Requires Clarification` | |
| **5.7** | How is the RBI-mandated Key Fact Statement (KFS) presented and acknowledged by the borrower before signing? | `[?] Requires Clarification` | |

---

## Section 6: Money Flow, Settlement & Disbursements

| # | Question / Requirement | Status | Vendor Response / Resolution |
| :-: | :--- | :-: | :--- |
| **6.1** | Under RBI Digital Lending Guidelines, who does the lender disburse funds to: directly to the customer's bank account, or to a merchant nodal/escrow account? | `[!] Unknown / Blocker` | POS checkout financing typically settles directly to the retail merchant. |
| **6.2** | What banking rails are used for disbursement (IMPS, NEFT, RTGS)? What is the typical disbursement settlement window (instant vs T+1)? | `[?] Requires Clarification` | |
| **6.3** | How is the bank UTR (Unique Transaction Reference) delivered to Udhyam PAY (real-time webhook vs batch reconciliation file)? | `[?] Requires Clarification` | |
| **6.4** | In the event of a customer order cancellation or item return before delivery, what is the exact loan cancellation and refund protocol? | `[?] Requires Clarification` | |
| **6.5** | How are merchant subventions, platform processing fees, and platform commissions settled? Does the lender deduct fees at source or remit gross? | `[!] Unknown / Blocker` | Directly impacts Udhyam PAY commission ledger. |

---

## Section 7: Regulatory Compliance, Security & DPDP Act

| # | Question / Requirement | Status | Vendor Response / Resolution |
| :-: | :--- | :-: | :--- |
| **7.1** | Are all underlying partner lenders formally registered as Regulated Entities (REs) with RBI? | `[ ] Confirmed by Evidence` | Regulatory prerequisite. |
| **7.2** | Does the aggregator provide a standard Tripartite Agreement template between the RE, Aggregator, and Udhyam PAY (as Lending Service Provider - LSP)? | `[!] Unknown / Blocker` | Mandatory under RBI Digital Lending Guidelines dated Sept 2022. |
| **7.3** | Are all customer data, transaction records, and document archives stored exclusively on servers located physically within India? | `[?] Requires Clarification` | Mandatory under RBI and DPDP regulations. |
| **7.4** | What audit logs and consent timestamps are captured to defend against regulatory audits and customer disputes? | `[?] Requires Clarification` | |
| **7.5** | Can you provide a copy of your latest SOC 2 Type II and ISO 27001 audit certifications, as well as recent VAPT executive summaries? | `[?] Requires Clarification` | |
| **7.6** | How does your platform support the Right to Erasure under the DPDP Act 2023 when a customer revokes consent? | `[?] Requires Clarification` | |

---

## Section 8: Commercials, SLAs & Onboarding

| # | Question / Requirement | Status | Vendor Response / Resolution |
| :-: | :--- | :-: | :--- |
| **8.1** | What is the commercial model: one-time setup fee, monthly minimum commitment, per-application fee, or success-fee commission on disbursement? | `[!] Unknown / Blocker` | Success-fee / revenue-share model strongly preferred. |
| **8.2** | Are third-party verification fees (CIBIL bureau pull, CKYC, Penny drop, e-Sign, e-NACH) billed at actuals, or bundled into the platform commission? | `[!] Unknown / Blocker` | |
| **8.3** | What Service Level Agreement (SLA) is committed for API availability (e.g. 99.9% uptime) and maximum scheduled maintenance downtime? | `[?] Requires Clarification` | |
| **8.4** | What is the committed support escalation hierarchy for production incidents (P1 severity response within 15 minutes)? | `[?] Requires Clarification` | |
| **8.5** | What is the realistic onboarding timeline from contract signing and sandbox testing to production go-live with initial pilot merchants? | `[?] Requires Clarification` | Target: Under 4 weeks. |

---

## Section 9: Sandbox Test Scenarios Required

To facilitate automated regression testing before production rollout, please confirm which test triggers exist in the sandbox:

| Scenario Code | Expected System Outcome | Trigger Mechanism (e.g. Specific Test Phone / PAN) |
| :--- | :--- | :--- |
| `TC-APPROVE` | Immediate multi-lender approval with 3 active offers | Test Phone: `+919800000001` or specific test PAN |
| `TC-DECLINE` | Adverse credit decline with clear policy error code | Test Phone: `+919800000002` or specific test PAN |
| `TC-ADDITIONAL-INFO`| Demands Bank Statement / Account Aggregator consent | Test Phone: `+919800000003` |
| `TC-TIMEOUT` | Simulated gateway timeout (> 10s) to verify circuit breaker | Test Phone: `+919800000004` |
| `TC-503-UNAVAILABLE`| Simulated upstream lender downtime | Test Phone: `+919800000005` |
| `TC-MANDATE-FAIL` | Simulates failed e-NACH registration at bank | Specific test IFSC / Account number |
| `TC-ESIGN-SUCCESS` | Automated simulation of signed loan agreement | Automatic webhook trigger |
| `TC-DISBURSE-SUCCESS`| Automated simulation of NEFT bank UTR and disbursement | Automatic webhook trigger |

