# Udhyam PAY — External API Access & Integration Requirements

**Document Reference**: `docs/integration-readiness/API_ACCESS_AND_INTEGRATION_REQUIREMENTS.md`  
**Date**: November 2026  
**Audience**: Engineering Leadership, Product Management, Fintech Partnership Teams  
**Target Aggregators**: FinBox, Setu, or equivalent multi-lender credit aggregator  

---

## 1. Executive Summary

Udhyam PAY provides an in-store checkout financing experience where customers scan a QR code at merchant locations, configure loan terms for consumer durables, and receive instantaneous multi-lender offers.

To operate legally and securely within the Reserve Bank of India (RBI) Digital Lending Guidelines (DLG) and the Digital Personal Data Protection (DPDP) Act 2023, Udhyam PAY must integrate with external financial infrastructure. Rather than establishing individual direct integrations with 15+ Banks and NBFCs, Udhyam PAY plans to integrate with an external lending aggregator (such as FinBox).

This document evaluates all 20 external service categories, defines the data exchange contracts, categorizes requirements across implementation phases (Phases A through D), and provides a comprehensive vendor readiness checklist.

---

## 2. Comprehensive 20-Category External Service Evaluation

Each external service is evaluated against the 11 dimensions required for technical due diligence:

---

### Category 1: Multi-Lender Aggregator & Lender Connectivity
- **Required for Workflow**: **YES** (Core platform foundation).
- **Existing Repository Status**: **Simulated**. Hardcoded in-memory adapters for `LENDER_ALPHA` and `LENDER_BETA`.
- **Provided by Aggregator**: **YES**. Aggregators provide a unified API gateway abstracting partner Banks and NBFCs.
- **Separate Provider Required**: **NO**. The primary value of an aggregator is eliminating bilateral lender integrations.
- **Specific API Operations**:
  - `GET /v1/lenders`: Fetch list of active lenders, credit policies, and operating hours.
  - `POST /v1/applications/route`: Submit application to aggregator's multi-lender routing engine.
- **Data Exchange**:
  - *Outbound*: Merchant ID, store location, purchase category, requested amount, customer basic profile.
  - *Inbound*: Aggregator tracking ID, list of eligible partner lenders, routing disposition.
- **Sync / Async**: **Hybrid** (Initial handshake synchronous; underwriting asynchronous).
- **Security & Auth**: Server-to-server TLS 1.3, API Key + Client Secret, HMAC-SHA256 request signatures, IP whitelisting.
- **Compliance & Contracts**: Tripartite agreement between Udhyam PAY (LSP), Aggregator (Tech Provider / LSP), and Regulated Entities (REs / NBFCs).
- **Mock Feasibility**: **YES**. Fully mockable via deterministic scenarios.
- **Production-Ready Evidence**: Successful sandbox handshake, verified mTLS connectivity, active partner lender routing in production.

---

### Category 2: Loan Application Submission
- **Required for Workflow**: **YES**.
- **Existing Repository Status**: **Implemented & Tested** internally (`ApplicationService.createApplication`, `submitApplication`); external dispatch is **Mocked** (`MockLenderAdapter.submitApplication`).
- **Provided by Aggregator**: **YES**.
- **Separate Provider Required**: **NO**.
- **Specific API Operations**:
  - `POST /v1/applications`: Initialize loan origination session.
  - `POST /v1/applications/{id}/submit`: Transmit finalized underwriting packet.
- **Data Exchange**:
  - *Outbound*: Unique Udhyam application UUID, requested principal (paise), tenure, purchase metadata, customer mobile, consent timestamp.
  - *Inbound*: Aggregator loan reference ID, initial triage status (`PENDING`, `REJECTED`, `PROCESSING`).
- **Sync / Async**: **Asynchronous**. Response returns HTTP 202 Accepted with polling URL or webhook registration.
- **Security & Auth**: Bearer JWT / API Key, request-level idempotency key (`Idempotency-Key` header).
- **Compliance & Contracts**: Customer consent record referencing RBI Digital Lending privacy notice version.
- **Mock Feasibility**: **YES**. Existing `MockLenderAdapter` supports deterministic response codes.
- **Production-Ready Evidence**: Idempotent re-submission handling, sub-second acknowledgement latency, verified persistence of external references.

---

### Category 3: Eligibility & Underwriting Results
- **Required for Workflow**: **YES**.
- **Existing Repository Status**: **Simulated** (`MockLenderAdapter.checkEligibility`).
- **Provided by Aggregator**: **YES**. Powered by aggregator rule engine and partner lender credit policies.
- **Separate Provider Required**: **NO**.
- **Specific API Operations**:
  - `POST /v1/eligibility/check`: Quick pre-qualification check.
  - `GET /v1/applications/{id}/underwriting-status`: Retrieve detailed underwriting decision.
- **Data Exchange**:
  - *Outbound*: Customer phone, purchase amount, product category, merchant pincode.
  - *Inbound*: Eligibility boolean, maximum sanctioned limit, pre-approved tenure options, decline reason codes.
- **Sync / Async**: **Hybrid** (Pre-qualification is synchronous < 3s; full underwriting is asynchronous 10–30s).
- **Security & Auth**: Encrypted transit, payload signature.
- **Compliance & Contracts**: Fair lending disclosure compliance; clear decline reason codes for adverse actions.
- **Mock Feasibility**: **YES**. Can simulate approval, hard reject, and conditional approval.
- **Production-Ready Evidence**: Webhook / polling updates reflecting lender underwriting policies without timeout drops.

---

### Category 4: Multi-Offer Retrieval & Offer Comparison
- **Required for Workflow**: **YES** (Core differentiator of Udhyam PAY).
- **Existing Repository Status**: **Implemented & Tested** internally (`OfferService`, `FinancingOffer` model); populated with simulated offers.
- **Provided by Aggregator**: **YES**.
- **Separate Provider Required**: **NO**.
- **Specific API Operations**:
  - `GET /v1/applications/{id}/offers`: Retrieve all sanctioned lender proposals.
- **Data Exchange**:
  - *Outbound*: Application ID.
  - *Inbound*: Array of lender offers containing: lender code, sanctioned principal (paise), tenure (months), interest rate (% p.a.), rate type (`REDUCING_BALANCE` / `FLAT`), EMI amount, processing fee, APR %, terms URL.
- **Sync / Async**: **Synchronous** once underwriting webhooks complete.
- **Security & Auth**: Authenticated server-to-server API; sanitization of lender disclosures.
- **Compliance & Contracts**: RBI Key Fact Statement (KFS) standardized disclosure format; standardized APR calculation.
- **Mock Feasibility**: **YES**. Existing `EmiCalculator` dynamically generates multi-tenure offers.
- **Production-Ready Evidence**: Correct paise calculation across all offer tenures; APR values matching regulatory formulas.

---

### Category 5: Lender Routing & Offer Selection
- **Required for Workflow**: **YES**.
- **Existing Repository Status**: **Implemented & Tested** (`WaterfallOrchestrator`, `OfferService.acceptOffer`).
- **Provided by Aggregator**: **Hybrid**. Aggregators support lender routing, but Udhyam PAY retains customer-facing selection and waterfall preference.
- **Separate Provider Required**: **NO**.
- **Specific API Operations**:
  - `POST /v1/applications/{id}/offers/{offerId}/select`: Lock chosen lender offer.
- **Data Exchange**:
  - *Outbound*: Selected offer ID, customer acceptance timestamp, device IP / user agent.
  - *Inbound*: Confirmation of offer reservation, lender loan account reference, downstream action requirements (KYC / Mandate).
- **Sync / Async**: **Synchronous** (< 2s).
- **Security & Auth**: Authenticated request with optimistic locking to prevent race conditions.
- **Compliance & Contracts**: Explicit customer selection without pre-ticked defaults (RBI compliance).
- **Mock Feasibility**: **YES**. `OfferService.acceptOffer` supersedes competing offers atomically.
- **Production-Ready Evidence**: Offer lock guarantees interest rate and fees remain unchanged during documentation.

---

### Category 6: Credit Bureau Integration (CIBIL / Experian / CRIF / Equifax)
- **Required for Workflow**: **YES** (Regulatory prerequisite for unsecured credit in India).
- **Existing Repository Status**: **Missing**. Simulated via phone suffix in `MockLenderAdapter`.
- **Provided by Aggregator**: **YES** (Standard aggregator capability; bundled in underwriting).
- **Separate Provider Required**: **NO** if bundled by aggregator; **YES** if aggregator requires pre-fetched bureau pull.
- **Specific API Operations**:
  - Handled internally by aggregator during `submitApplication`, OR:
  - `POST /v1/bureau/fetch`: Fetch credit score and CIR (Credit Information Report).
- **Data Exchange**:
  - *Outbound*: Full name, phone, PAN, DOB, residential address, pincode, customer bureau consent.
  - *Inbound*: Bureau score (300–900), active tradelines, overdue amounts, inquiry count.
- **Sync / Async**: **Synchronous** (3–8s).
- **Security & Auth**: Strict data masking; PAN and credit report must not be exposed to unauthorized staff.
- **Compliance & Contracts**: CICRA 2005 (Credit Information Companies Regulation Act); mandatory customer consent capture.
- **Mock Feasibility**: **YES**. Mock bureau returning mock credit scores and tradelines.
- **Production-Ready Evidence**: Validated bureau pull within SLA without corrupting customer credit footprint.

---

### Category 7: KYC & Identity Verification (DigiLocker / Aadhaar OTP / CKYC)
- **Required for Workflow**: **YES** (RBI Master Direction on KYC).
- **Existing Repository Status**: **Missing**. Database deliberately stores zero KYC data.
- **Provided by Aggregator**: **YES** (via Aggregator Webview SDK or embedded journey).
- **Separate Provider Required**: **NO** if using aggregator journey; **YES** (e.g. Setu, Digio, Signzy) if building custom white-label KYC UI.
- **Specific API Operations**:
  - `POST /v1/kyc/initiate`: Generate hosted DigiLocker / Aadhaar OTP session.
  - `GET /v1/kyc/{sessionId}/status`: Retrieve verification result token.
- **Data Exchange**:
  - *Outbound*: Customer phone, application ID, redirect callback URL.
  - *Inbound*: Verification status (`VERIFIED`, `FAILED`), verified name, masked Aadhaar (`XXXX-XXXX-1234`), CKYC identifier, verification timestamp.
- **Sync / Async**: **Asynchronous** (Customer completes verification in hosted view).
- **Security & Auth**: Tokenized references only; zero raw Aadhaar or XML storage on Udhyam PAY database.
- **Compliance & Contracts**: UIDAI / DigiLocker guidelines; Section 6A of Aadhaar Act.
- **Mock Feasibility**: **YES**. Mock SDK returning simulated `VERIFIED` callback.
- **Production-Ready Evidence**: Tokenized KYC verification recognized and accepted by partner NBFCs.

---

### Category 8: Bank Account Verification (Penny Drop / IMPS Name Match)
- **Required for Workflow**: **YES** (Ensures loan is disbursed to genuine account and validates mandate destination).
- **Existing Repository Status**: **Missing**.
- **Provided by Aggregator**: **YES** (Bundled in checkout flow).
- **Separate Provider Required**: **NO** if bundled; **YES** (e.g. Cashfree / Razorpay / Setu) if standalone.
- **Specific API Operations**:
  - `POST /v1/bank/verify`: Initiate Re 1 penny drop or UPI account validation.
- **Data Exchange**:
  - *Outbound*: Bank account number, IFSC code, registered customer name.
  - *Inbound*: Account active boolean, registered beneficiary name from bank, name match score (0–100%).
- **Sync / Async**: **Synchronous** (2–5s).
- **Security & Auth**: Bank account tokenization; encryption of account numbers.
- **Compliance & Contracts**: NPCI IMPS verification standards; RBI Digital Lending name-matching rules.
- **Mock Feasibility**: **YES**. Mock service returning 100% name match.
- **Production-Ready Evidence**: Verified penny drop on major private and public sector banks.

---

### Category 9: Bank Statement Analysis & Income Assessment
- **Required for Workflow**: **CONDITIONAL** (Required for higher tickets > Rs 50,000; optional for low-ticket consumer durables).
- **Existing Repository Status**: **Simulated** (`ADDITIONAL_INFO_REQUIRED` test scenario).
- **Provided by Aggregator**: **YES** (e.g. FinBox BankConnect, Account Aggregator integration).
- **Separate Provider Required**: **NO** (Aggregators specialize in this).
- **Specific API Operations**:
  - `POST /v1/aa/consent`: Initiate Account Aggregator (AA) consent request.
  - `POST /v1/statements/upload`: Upload PDF statement for OCR and parsing.
- **Data Exchange**:
  - *Outbound*: Mobile number linked to bank, bank selection.
  - *Inbound*: Average bank balance, monthly salary credits, bounce count, Debt-to-Income ratio (DTI).
- **Sync / Async**: **Asynchronous** (User approves AA notification or uploads PDF).
- **Security & Auth**: End-to-end encrypted financial data; AA framework compliance.
- **Compliance & Contracts**: RBI Account Aggregator master directions; customer explicit consent.
- **Mock Feasibility**: **YES**. Mock analyzer returning synthetic cashflow metrics.
- **Production-Ready Evidence**: Successful fetch of last 6 months statement data via RBI AA ecosystem.

---

### Category 10: Fraud & Risk Checks
- **Required for Workflow**: **RECOMMENDED / CONDITIONAL**.
- **Existing Repository Status**: **Missing**.
- **Provided by Aggregator**: **YES** (e.g. FinBox DeviceConnect SDK for device risk and behavioral signals).
- **Separate Provider Required**: **NO**.
- **Specific API Operations**:
  - Client-side SDK integration transmitting privacy-safe behavioral signals directly to aggregator.
- **Data Exchange**:
  - *Outbound*: Client SDK token, IP, geolocation coordinates.
  - *Inbound*: Fraud score, risk indicators, velocity warnings.
- **Sync / Async**: **Asynchronous background execution**.
- **Security & Auth**: Client SDK keys, TLS certificate pinning.
- **Compliance & Contracts**: Google Play / Apple App Store privacy disclosures; DPDP Act explicit consent.
- **Mock Feasibility**: **YES**. Can bypass or return neutral risk score in development.
- **Production-Ready Evidence**: Device fingerprinting without battery or performance degradation.

---

### Category 11: Document Upload & Verification
- **Required for Workflow**: **CONDITIONAL** (Only triggered if automated KYC/AA fails and manual document upload is needed).
- **Existing Repository Status**: **Missing**.
- **Provided by Aggregator**: **YES**.
- **Separate Provider Required**: **NO**.
- **Specific API Operations**:
  - `POST /v1/documents/upload`: Upload proof of address / utility bill / shop invoice.
- **Data Exchange**:
  - *Outbound*: Document category, binary image / PDF stream.
  - *Inbound*: Aggregator document reference ID, OCR extraction data, document authenticity score.
- **Sync / Async**: **Asynchronous OCR & virus scan**.
- **Security & Auth**: Pre-signed URLs with expiring write tokens; client-side file-type validation.
- **Compliance & Contracts**: PII redaction; secure storage with server-side encryption.
- **Mock Feasibility**: **YES**. Mock endpoint accepting multipart form and returning dummy doc ID.
- **Production-Ready Evidence**: Reliable OCR text extraction from camera photos under poor lighting.

---

### Category 12: Loan Agreement Generation & e-Signing (Aadhaar e-Sign)
- **Required for Workflow**: **YES** (Mandatory before loan disbursement in India).
- **Existing Repository Status**: **Missing**. Only placeholder `termsUrl` exists on `FinancingOffer`.
- **Provided by Aggregator**: **YES** (Standard component in digital lending journeys).
- **Separate Provider Required**: **NO** if using aggregator flow; **YES** (Digio / Leegality) if custom flow.
- **Specific API Operations**:
  - `POST /v1/agreements/generate`: Compile Key Fact Statement (KFS) and sanction letter into PDF.
  - `POST /v1/agreements/sign/initiate`: Launch Aadhaar OTP e-Sign session (via ESP / NSDL / CDSL).
- **Data Exchange**:
  - *Outbound*: Application ID, agreed loan terms, customer phone.
  - *Inbound*: Hosted signing URL, agreement reference, signed document download link, audit trail hash.
- **Sync / Async**: **Asynchronous** (Customer completes OTP signing in browser/webview).
- **Security & Auth**: Certified Electronic Signature Provider (ESP); SHA-256 document hashing.
- **Compliance & Contracts**: Information Technology Act 2000; mandatory display of RBI KFS.
- **Mock Feasibility**: **YES**. Mock e-sign URL that automatically triggers signed webhook.
- **Production-Ready Evidence**: Legally binding cryptographic signature and audit trail stamped on final loan contract.

---

### Category 13: Electronic Mandates (e-NACH / UPI Autopay)
- **Required for Workflow**: **YES** (Required for automated monthly EMI collection).
- **Existing Repository Status**: **Missing**.
- **Provided by Aggregator**: **YES** (Bundled with partner lender onboarding).
- **Separate Provider Required**: **NO** if bundled; **YES** (Razorpay / Cashfree / Setu) if standalone.
- **Specific API Operations**:
  - `POST /v1/mandates/create`: Initiate e-NACH (NetBanking / Debit Card) or UPI Autopay setup.
- **Data Exchange**:
  - *Outbound*: Maximum debit limit (usually 2x EMI), tenure, start date, customer VPA or bank details.
  - *Inbound*: Mandate registration URL, UMRN (Unique Mandate Reference Number), mandate status (`ACTIVE`, `FAILED`).
- **Sync / Async**: **Asynchronous** (Customer authorizes via bank portal or UPI app).
- **Security & Auth**: NPCI security protocols; bank redirection tokens.
- **Compliance & Contracts**: NPCI e-NACH regulations; RBI limits on auto-debit notifications.
- **Mock Feasibility**: **YES**. Simulated mandate creation returning mock UMRN.
- **Production-Ready Evidence**: Live UMRN generated and accepted by the lender's loan management system (LMS).

---

### Category 14: Disbursement Initiation & Status Tracking
- **Required for Workflow**: **YES** (Signals transaction completion and activates commission accrual).
- **Existing Repository Status**: **Implemented & Tested** internally (`WebhookService.processWebhook` handles `LOAN_DISBURSED`); external trigger is **Simulated**.
- **Provided by Aggregator**: **YES**. Triggered by lender LMS and reported via aggregator webhook.
- **Separate Provider Required**: **NO**.
- **Specific API Operations**:
  - Inbound webhook: `POST /api/v1/webhooks/aggregator` (`LOAN_DISBURSED`).
  - `GET /v1/applications/{id}/disbursement-status`: Check settlement status.
- **Data Exchange**:
  - *Outbound*: Query by application reference.
  - *Inbound*: Disbursement status (`DISBURSED`, `FAILED`), bank UTR number, disbursed amount (paise), lender timestamp.
- **Sync / Async**: **Asynchronous** (Disbursement occurs via NEFT / RTGS / IMPS).
- **Security & Auth**: HMAC-SHA256 signature verification on inbound webhooks; strict replay protection (300s).
- **Compliance & Contracts**: RBI Digital Lending Rule: RE must disburse directly to borrower's bank account (or merchant account in co-lending/merchant checkout models).
- **Mock Feasibility**: **YES**. Fully tested in `tests/e2e/main-flow.test.ts`.
- **Production-Ready Evidence**: Bank UTR matched against banking reconciliation statements.

---

### Category 15: Repayment Schedules & Post-Disbursement Loan Status
- **Required for Workflow**: **CONDITIONAL / FUTURE** (Udhyam PAY's core revenue is origination commission; repayments are managed by the lender).
- **Existing Repository Status**: **Partial**. Database stores `repaymentSchedule` as JSON on `financing_offers`.
- **Provided by Aggregator**: **YES**.
- **Separate Provider Required**: **NO**.
- **Specific API Operations**:
  - `GET /v1/loans/{loanId}/schedule`: Fetch detailed installment dates and amounts.
- **Data Exchange**:
  - *Outbound*: Loan ID.
  - *Inbound*: Array of installments: due date, principal component, interest component, status (`PAID`, `PENDING`, `OVERDUE`).
- **Sync / Async**: **Synchronous**.
- **Security & Auth**: Authenticated merchant/customer query.
- **Compliance & Contracts**: RBI transparency requirements for repayment tracking.
- **Mock Feasibility**: **YES**. `EmiCalculator` computes schedule.
- **Production-Ready Evidence**: Accurate schedule matching lender LMS ledger.

---

### Category 16: Customer Notifications (SMS, WhatsApp, Email, OTP)
- **Required for Workflow**: **YES** (Crucial for in-store drop-off re-engagement, status alerts, and consent audit).
- **Existing Repository Status**: **Missing**. QR codes handle initial handoff; no outbound messaging exists.
- **Provided by Aggregator**: **Partial** (Aggregator sends compliance SMS; Udhyam PAY needs own merchant/customer notifications).
- **Separate Provider Required**: **YES** (e.g. Twilio, Gupshup, Exotel, Karix).
- **Specific API Operations**:
  - `POST /v1/messages/send`: Send transactional SMS or WhatsApp template message with checkout link.
- **Data Exchange**:
  - *Outbound*: Mobile number, DLT template ID, template variable mapping (customer name, store name, offer link).
  - *Inbound*: Message delivery reference, delivery receipt status.
- **Sync / Async**: **Asynchronous**.
- **Security & Auth**: API keys, DLT (Distributed Ledger Technology) template registration in India.
- **Compliance & Contracts**: TRAI DLT registration; Indian anti-spam regulations.
- **Mock Feasibility**: **YES**. Console logger / in-memory notifier.
- **Production-Ready Evidence**: Verified SMS delivery within 5 seconds across major Indian telcos (Jio, Airtel, Vi).

---

### Category 17: Payment Collection (Down Payments & Processing Fees)
- **Required for Workflow**: **CONDITIONAL** (Required if customer pays down payment or processing fee at point of sale).
- **Existing Repository Status**: **Partial**. Database models down payment on `Purchases` and `FinancingApplications`, but no payment gateway is wired.
- **Provided by Aggregator**: **NO** (Aggregators focus on loan disbursement; customer-to-merchant payments use standard PG).
- **Separate Provider Required**: **YES** (e.g. Razorpay, Cashfree, PayU, PhonePe PG).
- **Specific API Operations**:
  - `POST /v1/orders`: Create payment order for down payment.
  - `POST /v1/payments/verify`: Verify UPI / card payment signature.
- **Data Exchange**:
  - *Outbound*: Down payment amount (paise), customer phone, merchant reference.
  - *Inbound*: Payment ID, payment status (`CAPTURED`), payment mode.
- **Sync / Async**: **Asynchronous webhook confirmation**.
- **Security & Auth**: Standard PG webhook HMAC signatures; PCI-DSS compliance.
- **Compliance & Contracts**: Payment aggregator merchant onboarding.
- **Mock Feasibility**: **YES**. Simulated payment capture.
- **Production-Ready Evidence**: Automated down payment reconciliation against merchant order.

---

### Category 18: Webhooks & Event Delivery
- **Required for Workflow**: **YES** (Essential for real-time asynchronous state transitions).
- **Existing Repository Status**: **Implemented & Tested** (`WebhookService` verifies HMAC-SHA256, prevents replay, hashes payloads).
- **Provided by Aggregator**: **YES**.
- **Separate Provider Required**: **NO**.
- **Specific API Operations**:
  - Inbound route: `POST /api/v1/webhooks/aggregator`.
- **Data Exchange**:
  - *Outbound*: Webhook registration URL provided to aggregator during onboarding.
  - *Inbound*: Signed JSON payload with `eventId`, `eventType`, `applicationId`, `lenderReference`, `amountPaise`, `status`.
- **Sync / Async**: **Synchronous acknowledgement (200 OK within 500ms); background processing**.
- **Security & Auth**: HMAC-SHA256 signature verification over raw request body, timestamp replay tolerance (< 300s).
- **Compliance & Contracts**: Idempotent processing; audit trail of all webhook receipts.
- **Mock Feasibility**: **YES**. Verified in integration tests.
- **Production-Ready Evidence**: Zero dropped webhooks under simulated retry bursts.

---

### Category 19: Document Storage & Encrypted Vault
- **Required for Workflow**: **YES** (Archiving signed agreements, invoices, and compliance audit logs).
- **Existing Repository Status**: **Missing**.
- **Provided by Aggregator**: **Partial** (Aggregator stores lender loan agreements; Udhyam PAY must archive merchant invoices).
- **Separate Provider Required**: **YES** (AWS S3, Google Cloud Storage, or Azure Blob with server-side encryption).
- **Specific API Operations**:
  - `PUT /v1/storage/documents/{id}`: Upload encrypted agreement copy.
  - `GET /v1/storage/documents/{id}/signed-url`: Generate short-lived (15 min) read URL for merchant download.
- **Data Exchange**:
  - *Outbound*: PDF stream, encryption metadata, customer ID.
  - *Inbound*: Storage object key, secure ETag.
- **Sync / Async**: **Synchronous**.
- **Security & Auth**: Cloud IAM, Customer Managed Encryption Keys (CMEK / KMS), pre-signed URL expiration.
- **Compliance & Contracts**: Data localization within India (RBI mandate); 5-year retention schedule.
- **Mock Feasibility**: **YES**. Local file system mock or in-memory buffer.
- **Production-Ready Evidence**: Encrypted at rest using AES-256; signed URLs expire reliably.

---

### Category 20: Analytics, Monitoring & Operational Telemetry
- **Required for Workflow**: **YES** (Production reliability and merchant conversion analytics).
- **Existing Repository Status**: **Implemented & Tested** (`pino` structured JSON logging, `/health` and `/ready` endpoints, `AuditLog` table).
- **Provided by Aggregator**: **Partial** (Aggregator provides partner dashboard).
- **Separate Provider Required**: **YES** (Datadog, OpenTelemetry, Sentry, or Grafana Cloud).
- **Specific API Operations**:
  - Outbound metrics: Waterfall latency, drop-off rates, circuit breaker trips, HTTP 5xx errors.
- **Data Exchange**:
  - Structured logs and metrics streams without sensitive customer PII.
- **Sync / Async**: **Non-blocking asynchronous agent**.
- **Security & Auth**: Outbound TLS; sanitization filter stripping customer phone numbers and secrets.
- **Compliance & Contracts**: No personal data leakage into log monitoring services.
- **Mock Feasibility**: **YES**. Pino logs to stdout in development.
- **Production-Ready Evidence**: Real-time alerts triggering on error spikes or degraded lender latency.

---

## 3. Phased Requirement Roadmap

To maximize engineering efficiency, external integrations are divided into four sequential phases:

```
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE A: Sandbox Readiness (Immediate)                                 │
│  • Aggregator API Auth & Partner Credentials                          │
│  • Mock Lending Provider Abstraction                                  │
│  • Webhook Gateway with Signature Verification                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE B: Full Origination Journey (Pre-Sanction)                       │
│  • Application Initialization API                                      │
│  • Aggregator Webview / SDK for Customer KYC & Underwriting            │
│  • Multi-Offer Presentation & Selection Sync                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE C: Agreement, Mandate & Disbursement (Closing)                   │
│  • Key Fact Statement (KFS) Presentation                               │
│  • e-Mandate (e-NACH / UPI Autopay) Callback Listener                  │
│  • Aadhaar e-Sign Agreement Callback Listener                          │
│  • Disbursement Confirmation Webhook & Commission Accrual             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE D: Post-Disbursement & Ancillary Services (Expansion)            │
│  • Transactional SMS / WhatsApp Gateway (Twilio / Gupshup)             │
│  • Cloud Document Archival (AWS S3 / GCS with KMS)                     │
│  • Down Payment Collection Gateway (Razorpay / Cashfree)               │
│  • Post-Disbursement Repayment Tracking & Dispute Management          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Aggregator Bundling vs. Standalone Provider Analysis

A pivotal commercial and architectural decision is whether to use the aggregator's bundled services or contract with standalone vendors:

| Service Area | Bundled via Aggregator (e.g. FinBox) | Standalone Specialized Provider | Udhyam PAY Recommendation |
| :--- | :--- | :--- | :--- |
| **Credit Bureau** | Included in credit decisioning API. | Direct Bureau membership (CIBIL/Experian). Requires NBFC license or heavy setup fee. | **Use Aggregator Bundled**. Avoids huge minimum commitments. |
| **KYC & Identity** | Included in Aggregator Hosted Journey / SDK. | Digio / Signzy / Setu. | **Use Aggregator Bundled** for MVP; evaluate unbundled if custom UI is required. |
| **Bank Account Penny Drop** | Included in Aggregator Mandate flow. | Cashfree / Razorpay. | **Use Aggregator Bundled**. |
| **Bank Statement (AA)** | Proprietary (e.g. FinBox BankConnect). | Perfios / Anumati. | **Use Aggregator Bundled**. Aggregator algorithms are tuned to their partner NBFCs. |
| **e-Mandate** | Managed via partner NBFC sponsor banks. | Standalone e-NACH gateway. | **Use Aggregator Bundled**. Lender's sponsor bank must accept the mandate. |
| **Loan Agreement e-Sign** | Stamped and signed via aggregator partner. | Standalone Digio / Leegality. | **Use Aggregator Bundled**. Eliminates bilateral agreement template management. |
| **Customer Notifications** | Compliance SMS only. | Twilio / Gupshup / Karix. | **Standalone Required**. Udhyam PAY must brand its own checkout reminders. |
| **Document Storage** | Short-term cache. | Private AWS S3 / GCS with CMEK. | **Standalone Required**. Long-term compliance archival belongs to Udhyam PAY. |

---

## 5. Aggregator API Access Checklist

This checklist tracks the precise technical and operational requirements to request from the aggregator vendor during preliminary discussions:

| Category | Specific Item | Current Status | Notes / Clarification Required |
| :--- | :--- | :--- | :--- |
| **Technical Access** | Official OpenAPI / Swagger 3.0 specification | `[?] Requires Clarification` | Essential for generating type-safe TypeScript client. |
| | Sandbox environment Base URL & test credentials | `[!] Unknown / Blocker` | Awaiting vendor credential issuance. |
| | Postman Collection with functional request/response examples | `[?] Requires Clarification` | Speeds up contract verification. |
| | API Rate Limits, burst thresholds, and throttling behavior | `[?] Requires Clarification` | Must configure our circuit breaker and queue accordingly. |
| | Webhook specifications, event catalogs, and retry schedule | `[?] Requires Clarification` | Need HMAC signature header name and replay tolerance. |
| | Sandbox test scenarios (deterministic approvals, declines, timeouts)| `[?] Requires Clarification` | Need test phone numbers / PANs for each scenario. |
| **Lender Connectivity** | Complete list of active partner Banks and NBFCs | `[!] Unknown / Blocker` | Must verify coverage for consumer durable electronics. |
| | Supported loan ticket sizes (min / max) and tenures (3, 6, 9, 12M)| `[?] Requires Clarification` | Udhyam target: Rs 10,000 to Rs 2,50,000; 3 to 18 months. |
| | Support for 0% Subvented EMI (Merchant / Brand subvention) | `[?] Requires Clarification` | Critical for retail electronics sales conversion. |
| | Multi-offer return: does single submission query all lenders? | `[?] Requires Clarification` | Must support concurrent discovery mode. |
| **Loan Lifecycle** | Integration mode: Headless Server-to-Server vs Embedded Webview | `[?] Requires Clarification` | Determines whether customer PAN/KYC is handled by Udhyam. |
| | Support for white-labeling or co-branding on customer UI | `[?] Requires Clarification` | Merchant brand presence builds in-store customer trust. |
| | Handling of offline / in-store physical verification if triggered | `[?] Requires Clarification` | Should fail fast rather than leaving customer stranded in store. |
| | Key Fact Statement (KFS) generation & cooling-off period support| `[?] Requires Clarification` | Mandatory compliance under RBI DLG rules. |
| | Exact disbursement flow: Lender direct to customer or merchant escrow| `[?] Requires Clarification` | Point-of-sale checkout financing requires merchant settlement. |
| **Commercials & Legal** | Setup fees, integration costs, and ongoing maintenance charges | `[!] Unknown / Blocker` | Need commercial schedule from vendor. |
| | Per-application API pricing vs Success-only disbursement fee | `[!] Unknown / Blocker` | Success-fee model preferred to align incentives. |
| | Bureau inquiry and KYC verification pass-through costs | `[!] Unknown / Blocker` | Must know who absorbs failed inquiry costs. |
| | Tripartite LSP agreement template approved by partner REs | `[!] Unknown / Blocker` | Regulatory prerequisite before production traffic. |
| | Data retention, deletion, and DPDP Act compliance commitments | `[?] Requires Clarification` | Vendor must guarantee data localization within India. |

