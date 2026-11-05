// ============================================================
// Versión inglesa de «Soporte y reporte de errores» (1.6.7). El texto
// español (support.ts) es el que manda; este lo traduce fielmente.
// ============================================================

import { SUPPORT_VERSION } from './versions.ts';

export function supportDocumentEn({
  appVersion,
  installId,
  effectiveDate,
}: {
  appVersion: string;
  installId: string;
  effectiveDate: string;
}): string {
  return `# Support and bug reports

**Version ${SUPPORT_VERSION} · ${effectiveDate}**

> This is an English translation provided for convenience. In case of any discrepancy, the Spanish version prevails.

## 1. What this channel covers

This channel handles **malfunctions**, **questions about using** the Application and **requests related to your account and your data**.

**Shortcuts inside Frame:** “Information and what’s new” (in Settings) explains what each part of Frame does; **usage questions** and **improvement proposals** are sent by email, just like reports; and failures that break a screen **are reported automatically**, without any of your data, so they can be fixed in the next version.

Frame is maintained by Asvent, a small team. Every message is logged and reviewed. **We don’t guarantee an individual reply to every message**, but we do guarantee that every report describing a reproducible failure enters the work queue.

The times below are **service goals, not contractual commitments**: a failure that prevents using the Application is handled first; one that affects a specific feature with a workaround available, afterwards; a feature proposal is evaluated when planning the next version.

## 2. Before you write

Three checks solve a considerable share of cases:

- Make sure you’re using the **latest version** available, since the failure may already be fixed.
- Check whether the problem persists **after closing and reopening the application**.
- If the failure affects Gmail, YouTube or Classroom, check whether the same service works in your browser: if it doesn’t work there either, the problem is Google’s and not Frame’s.

## 3. How to write a report that can be solved

A failure that can be reproduced is half solved. Send an email to the support address with this structure:

**Subject:** \`Frame report ${appVersion} — [one-line summary]\`

**Message body:**

### 1. What you expected to happen
One sentence.

### 2. What happened instead
Precisely. “The floating window closed by itself a minute after starting the session” is useful; “it doesn’t work” forces three emails before we can start.

### 3. Exact steps to reproduce it
Numbered, from a known situation —for example, “with the application just opened”— up to the moment of the failure. Include which screen, which button and in what order.

### 4. Frequency
Always, intermittently, or just once.

### 5. Your account identifier
Yours is **${installId}**. You can see it in Settings, next to your profile (one click copies it), and at the top of the “System information” screen.

### 6. Environment
Frame version, Windows version and, if the failure is about performance, the computer’s specifications.

### 7. Evidence
A screenshot or a short recording, if the failure is visible. Cover or crop any personal data that appears.

### 8. When it started
If it used to work, say since which version or since which change it stopped working. It’s the piece of information that shortens the diagnosis the most.

## 4. If you propose a feature

Describe **the problem you want to solve before the solution you imagine**. Explain at what point of your studying it appears, what you do today to work around it and what it costs you. There’s almost always more than one way to solve a problem, and the first one that comes to mind is rarely the best. Proposals that arrive framed as a problem are considerably more likely to end up implemented than those that arrive framed as a specification.

## 5. What you must never send

**Don’t include passwords** —neither Frame’s nor any other service’s—, nor the content of your documents, recordings, emails or personal files, nor third parties’ personal data, nor screenshots showing uncovered sensitive data.

We will never need them to diagnose a failure, and if we receive them we will delete them.

The data you send will be processed exclusively to handle your report, in accordance with the Privacy Policy, and will be kept for twenty-four (24) months from the closing of the case.

## 6. Life cycle of a report

Every report goes through: **received** —it’s logged and acknowledged when possible—; **reproduced or not reproduced** —we try to replicate the failure with your steps—; **queued** —confirmed and prioritized—; **fixed** —solved in a specific version, which is stated in the version history—; or **closed without action** —when it can’t be reproduced, belongs to a third-party service or is outside the product’s scope, in which case the reason is explained.

## 7. Reporting security vulnerabilities

**7.1.** If you find a vulnerability, **don’t publish or spread it** before telling us. Write to **vt.asvent@gmail.com** with the subject \`Security — [affected component]\`, describing the finding, its potential impact and the steps to reproduce it.

**7.2. The Provider’s commitment.** We will acknowledge receipt within a target of seventy-two (72) hours, keep you informed of the progress and, if you wish, publicly credit your contribution in the version history.

**7.3. Safe harbor.** The Provider **will not take legal action** against anyone who investigates in good faith, limits themselves to their own data and their own installation, doesn’t access other users’ data, doesn’t degrade the service, doesn’t extract or keep other people’s information and respects a reasonable time for fixing before any disclosure.

**7.4.** Denial-of-service attacks, social engineering against people, unauthorized physical access and any action that causes real harm are outside this safe harbor.

## 8. Other channels

**Exercising your rights over your personal data** —access, rectification, cancellation, objection, withdrawal of consent—: vt.asvent@gmail.com. This channel is separate from technical support and is subject to the legal deadlines.

## 9. Support contact

**vt.asvent@gmail.com** · Asvent`;
}
