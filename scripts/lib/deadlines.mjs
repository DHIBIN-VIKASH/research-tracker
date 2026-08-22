// ============================================================================
// deadlines.mjs — find the date you must act by, and warn before it passes
// ============================================================================
//
// WHY THIS IS THE HIGHEST-VALUE PIECE OF THE WHOLE SYSTEM
// -------------------------------------------------------
// Papers are rarely lost to bad science. They are lost to a 60-day revision
// window that quietly expired while you were on postings. A revision deadline
// missed means the manuscript is treated as a NEW submission — you go back to
// the end of the queue, months gone, sometimes with a different editor.
//
// So this module answers one question per email: is there a date by which
// Dhibin or his professor must DO something? Everything else is secondary.
//
// TWO WAYS A DEADLINE APPEARS
//   Absolute : "please submit your revision by 15 September 2025"
//   Relative : "within 60 days"  -> anchored to the email's received date
//
// Relative deadlines are the common case and the dangerous one, because
// nothing in the email states the actual date — you have to compute it, which
// is exactly the arithmetic a busy person skips.
// ============================================================================

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

// Statuses where a deadline is meaningful. A deadline attached to a rejected
// paper is noise; a deadline attached to a revision request is the whole game.
export const DEADLINE_RELEVANT_STATUSES = new Set([
  'Revision Requested',
  'Minor Revision Requested',
  'Major Revision Requested',
  'Accepted (Conditional)',
  'In Production (Proofs)',
  'Action Required',
]);

/**
 * Extract an action deadline from an email.
 *
 * @param {{subject?:string, body?:string, receivedAt?:Date}} email
 * @returns {{date: Date, kind: 'absolute'|'relative', raw: string,
 *            days: number|null, confidence: number}|null}
 */
export function extractDeadline(email) {
  const received = email.receivedAt instanceof Date ? email.receivedAt : new Date();
  // Deadlines live in the body, and near the top. Signatures and legal footers
  // contain dates that are not deadlines.
  const text = `${email.subject || ''}\n${(email.body || '').slice(0, 6000)}`;

  const candidates = [];

  // ---- Relative: "within 60 days" ---------------------------------------
  // Highest confidence when tied to an action verb, because "published within
  // 30 days of acceptance" is a statement of fact, not a task for you.
  const relPatterns = [
    { re: /(?:submit|return|upload|complete|revise|respond|reply|correct)[^.]{0,60}within\s+(\d{1,3})\s+(day|week|month)s?/i, conf: 0.95 },
    { re: /within\s+(\d{1,3})\s+(day|week|month)s?[^.]{0,60}(?:submit|return|upload|complete|revise|respond)/i, conf: 0.93 },
    { re: /(?:you\s+have|allow(?:ed)?)\s+(\d{1,3})\s+(day|week|month)s?\s+to\s+(?:submit|revise|respond|return|complete)/i, conf: 0.95 },
    { re: /(?:deadline|due)[^.]{0,30}(\d{1,3})\s+(day|week|month)s?/i, conf: 0.85 },
    { re: /within\s+(\d{1,3})\s+(day|week|month)s?/i, conf: 0.7 }, // bare fallback
  ];

  for (const { re, conf } of relPatterns) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const days = unit.startsWith('day') ? n : unit.startsWith('week') ? n * 7 : n * 30;
      // Sanity bound. "within 365 days" is boilerplate; "within 2 days" is real.
      if (days >= 1 && days <= 240) {
        const date = new Date(received.getTime() + days * 86400000);
        candidates.push({ date, kind: 'relative', raw: m[0].trim(), days, confidence: conf });
        break; // first (most specific) relative match wins
      }
    }
  }

  // ---- Absolute: "by 15 September 2025" ---------------------------------
  const absPatterns = [
    // by/before/no later than + 15 September 2025
    { re: /(?:by|before|no\s+later\s+than|not\s+later\s+than|due\s+(?:on|by))\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\,?\s+(\d{4})/i, order: 'dmy', conf: 0.95 },
    // by September 15, 2025
    { re: /(?:by|before|no\s+later\s+than|not\s+later\s+than|due\s+(?:on|by))\s+([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\,?\s+(\d{4})/i, order: 'mdy', conf: 0.95 },
    // deadline: 15/09/2025  or  2025-09-15
    { re: /(?:deadline|due\s+date)\s*[:\-]?\s*(\d{4})-(\d{2})-(\d{2})/i, order: 'ymd', conf: 0.93 },
    { re: /(?:deadline|due\s+date)\s*[:\-]?\s*(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/i, order: 'dmy-num', conf: 0.8 },
  ];

  for (const { re, order, conf } of absPatterns) {
    const m = text.match(re);
    if (!m) continue;
    const date = buildDate(m, order);
    if (!date) continue;
    // Reject dates in the past or absurdly far out — almost always a
    // copyright-year or an unrelated date caught by accident.
    const ahead = (date - received) / 86400000;
    if (ahead > -2 && ahead < 400) {
      candidates.push({ date, kind: 'absolute', raw: m[0].trim(), days: Math.round(ahead), confidence: conf });
      break;
    }
  }

  if (!candidates.length) return null;

  // Absolute beats relative at equal confidence: an explicit date is what the
  // editorial system will actually enforce.
  candidates.sort((a, b) =>
    b.confidence - a.confidence || (a.kind === 'absolute' ? -1 : 1)
  );
  return candidates[0];
}

function buildDate(m, order) {
  let d, mo, y;
  if (order === 'dmy') {
    d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3];
  } else if (order === 'mdy') {
    mo = MONTHS[m[1].toLowerCase()]; d = +m[2]; y = +m[3];
  } else if (order === 'ymd') {
    y = +m[1]; mo = +m[2] - 1; d = +m[3];
  } else if (order === 'dmy-num') {
    // Ambiguous 05/09/2025. Assume day-first: the user is in India, and every
    // journal outside the US writes day-first. Flagged by lower confidence.
    d = +m[1]; mo = +m[2] - 1; y = +m[3];
  }
  if (mo === undefined || Number.isNaN(mo) || !d || !y) return null;
  const date = new Date(Date.UTC(y, mo, d, 23, 59, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Which alerts are due for a paper right now?
 *
 * Escalating cadence rather than a single reminder. One email 7 days out is
 * easy to archive and forget; the ladder makes the last 48 hours impossible
 * to ignore.
 */
export const ALERT_LADDER = [14, 7, 3, 1, 0];

/**
 * @param {{deadline: Date, deadlineAlertsSent?: number[]}} paper
 * @param {Date} now
 * @returns {{due: boolean, daysLeft: number, milestone: number|null, overdue: boolean}}
 */
export function alertsDue(paper, now = new Date()) {
  if (!paper.deadline) return { due: false, daysLeft: null, milestone: null, overdue: false };

  const deadline = paper.deadline instanceof Date ? paper.deadline : paper.deadline.toDate?.() || new Date(paper.deadline);
  const daysLeft = Math.ceil((deadline - now) / 86400000);
  const sent = paper.deadlineAlertsSent || [];

  if (daysLeft < 0) {
    // Overdue: alert once, then stop nagging. Repeated identical mail trains
    // you to ignore the channel, which defeats the point.
    return { due: !sent.includes(-1), daysLeft, milestone: -1, overdue: true };
  }

  // Fire the tightest un-sent milestone that we have reached.
  for (const m of ALERT_LADDER) {
    if (daysLeft <= m && !sent.includes(m)) {
      return { due: true, daysLeft, milestone: m, overdue: false };
    }
  }
  return { due: false, daysLeft, milestone: null, overdue: false };
}

/** Human-friendly urgency band, used for colour and sorting in the UI. */
export function urgencyOf(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'none';
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 3) return 'critical';
  if (daysLeft <= 7) return 'urgent';
  if (daysLeft <= 14) return 'soon';
  return 'ok';
}
