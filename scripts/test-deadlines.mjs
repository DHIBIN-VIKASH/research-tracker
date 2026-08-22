#!/usr/bin/env node
// ============================================================================
// test-deadlines.mjs — deadline extraction and the alert ladder
// ============================================================================
// A wrong deadline is worse than no deadline: it either cries wolf (and trains
// you to ignore alerts) or reassures you while the real window closes.
// ============================================================================

import { extractDeadline, alertsDue, urgencyOf, ALERT_LADDER } from './lib/deadlines.mjs';

let passed = 0, failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = String(actual) === String(expected);
  if (ok) { passed++; console.log(`  \x1b[32m✔\x1b[0m ${name}`); }
  else {
    failed++; failures.push({ name, actual, expected });
    console.log(`  \x1b[31m✖\x1b[0m ${name}\n      expected: ${expected}\n      actual  : ${actual}`);
  }
}
const section = (t) => console.log(`\n\x1b[36m${'─'.repeat(68)}\n  ${t}\n${'─'.repeat(68)}\x1b[0m`);

const RECEIVED = new Date('2026-08-01T10:00:00Z');
const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);

// ===========================================================================
section('RELATIVE deadlines (anchored to email receipt)');
// ===========================================================================

check('"within 60 days" to submit',
  iso(extractDeadline({ subject: 'Major revision', body: 'Please submit your revised manuscript within 60 days.', receivedAt: RECEIVED })?.date),
  '2026-09-30');

check('"within 2 weeks"',
  iso(extractDeadline({ subject: 'Proofs', body: 'Please return the corrected proofs within 2 weeks.', receivedAt: RECEIVED })?.date),
  '2026-08-15');

check('"you have 21 days to respond"',
  iso(extractDeadline({ subject: 'Revision', body: 'You have 21 days to submit your revision.', receivedAt: RECEIVED })?.date),
  '2026-08-22');

check('absurd window (365 days) ignored as boilerplate',
  extractDeadline({ subject: 'Info', body: 'Articles are archived within 365 days.', receivedAt: RECEIVED }),
  'null');

// ===========================================================================
section('ABSOLUTE deadlines');
// ===========================================================================

check('"by 15 September 2026"',
  iso(extractDeadline({ subject: 'Revision', body: 'Please resubmit by 15 September 2026.', receivedAt: RECEIVED })?.date),
  '2026-09-15');

check('"by September 15, 2026" (US order)',
  iso(extractDeadline({ subject: 'Revision', body: 'Please resubmit by September 15, 2026.', receivedAt: RECEIVED })?.date),
  '2026-09-15');

check('"Deadline: 2026-09-15"',
  iso(extractDeadline({ subject: 'Revision', body: 'Deadline: 2026-09-15 for the revised version.', receivedAt: RECEIVED })?.date),
  '2026-09-15');

check('past date rejected (stale/copyright noise)',
  extractDeadline({ subject: 'Info', body: 'Please submit by 15 September 2019.', receivedAt: RECEIVED }),
  'null');

check('absolute beats relative when both present',
  iso(extractDeadline({
    subject: 'Revision required',
    body: 'Please submit your revision by 20 September 2026. Reviews are normally returned within 30 days.',
    receivedAt: RECEIVED,
  })?.date),
  '2026-09-20');

check('no deadline returns null',
  extractDeadline({ subject: 'Under review', body: 'Your manuscript is under review.', receivedAt: RECEIVED }),
  'null');

// ===========================================================================
section('ALERT LADDER — each milestone fires exactly once');
// ===========================================================================

const now = new Date('2026-08-01T09:00:00Z');
const inDays = (n) => new Date(now.getTime() + n * 86400000 + 3600000);

check('10 days out → 14-day rung fires',
  alertsDue({ deadline: inDays(10), deadlineAlertsSent: [] }, now).milestone, 14);

check('10 days out, 14 already sent → silent',
  alertsDue({ deadline: inDays(10), deadlineAlertsSent: [14] }, now).due, false);

check('5 days out, 14 sent → 7-day rung fires',
  alertsDue({ deadline: inDays(5), deadlineAlertsSent: [14] }, now).milestone, 7);

check('2 days out → 3-day rung fires',
  alertsDue({ deadline: inDays(2), deadlineAlertsSent: [14, 7] }, now).milestone, 3);

check('overdue → fires once',
  alertsDue({ deadline: inDays(-3), deadlineAlertsSent: [14, 7, 3, 1, 0] }, now).milestone, -1);

check('overdue already alerted → stops nagging',
  alertsDue({ deadline: inDays(-5), deadlineAlertsSent: [-1] }, now).due, false);

check('30 days out → nothing yet',
  alertsDue({ deadline: inDays(30), deadlineAlertsSent: [] }, now).due, false);

check('no deadline → nothing',
  alertsDue({ deadline: null }, now).due, false);

// ===========================================================================
section('URGENCY bands');
// ===========================================================================

check('-1 → overdue', urgencyOf(-1), 'overdue');
check('2 → critical', urgencyOf(2), 'critical');
check('5 → urgent', urgencyOf(5), 'urgent');
check('12 → soon', urgencyOf(12), 'soon');
check('40 → ok', urgencyOf(40), 'ok');

console.log(`\n${'═'.repeat(68)}\n  ${passed} passed, ${failed} failed\n${'═'.repeat(68)}`);
if (failed) {
  for (const f of failures) console.log(`  · ${f.name}: want ${f.expected}, got ${f.actual}`);
  process.exit(1);
}
console.log('\n  Deadline logic sound.\n');
