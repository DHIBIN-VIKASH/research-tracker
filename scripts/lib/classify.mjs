// ============================================================================
// classify.mjs — turn a journal email into (manuscript ID, journal, status)
// ============================================================================
//
// This module is the single most dangerous part of the system, so it is built
// to be paranoid rather than clever.
//
// The failure mode we are designing against is NOT "the script misses an
// email". A miss is cheap — you notice the status is stale and fix it. The
// expensive failure is a CONFIDENT WRONG ANSWER: an email saying "we invite
// you to submit a revised manuscript" being filed as "Rejected", or worse, a
// decision for paper A being written onto paper B because two titles looked
// similar.
//
// Three defences, in order of importance:
//
//   1. MATCH ON MANUSCRIPT ID, NEVER ON TITLE.
//      Every editorial system (Editorial Manager, ScholarOne, eJournalPress)
//      stamps a manuscript number in the subject or body. That is an exact
//      key. Fuzzy title matching is how you silently corrupt a tracker, so
//      this module does not do it at all.
//
//   2. ANTI-PATTERNS BEAT PATTERNS.
//      "reject" appears inside "we are pleased to inform you that... after
//      considering the reviewers who recommended rejection...". Every rule
//      carries `notIf` patterns that veto a match. A vetoed rule scores zero.
//
//   3. AMBIGUITY IS AN OUTCOME, NOT AN ERROR.
//      If two rules of different meaning both fire strongly, the classifier
//      returns `ambiguous` and the caller routes the email to the `unmatched`
//      queue for a human. Refusing to answer is a valid, safe answer.
//
// Everything returns a `rule` name and the exact `evidence` string that
// triggered it, so any status on your dashboard can be traced back to the
// sentence in the email that caused it.
// ============================================================================

// ---------------------------------------------------------------------------
// MANUSCRIPT ID EXTRACTION
// ---------------------------------------------------------------------------
// Patterns are ordered most-specific first. Real-world examples:
//   Editorial Manager : JOSR-D-25-00417, ESJ-D-24-01123R1
//   ScholarOne        : JBJS-25-0442, SPINE-D-25-00112.R1
//   eJournalPress     : Manuscript ID: ABC-2025-000123
//   Generic labelled  : "Manuscript Number: XYZ-1234"
//
// The labelled forms are checked FIRST because they are unambiguous. The
// bare-pattern fallbacks are riskier (they can match a DOI fragment or a
// grant number), so they demand more structure.
// ---------------------------------------------------------------------------

const MS_ID_PATTERNS = [
  // "Manuscript Number: JOSR-D-25-00417"  /  "MS ID: ..."  /  "Manuscript ID ..."
  {
    name: 'labelled',
    re: /(?:manuscript|ms\.?)\s*(?:number|no\.?|id|ref(?:erence)?)\s*[:#\-]?\s*([A-Z][A-Z0-9]{1,15}(?:[-_.][A-Z0-9]{1,10}){1,5})/i,
    confidence: 0.98,
  },
  // "Paper #JOSR-D-25-00417" / "Submission ID: ..."
  {
    name: 'labelled-alt',
    re: /(?:paper|submission|article)\s*(?:number|no\.?|id)?\s*[:#]\s*([A-Z][A-Z0-9]{1,15}(?:[-_.][A-Z0-9]{1,10}){1,5})/i,
    confidence: 0.94,
  },
  // Editorial Manager canonical shape: PREFIX-D-YY-NNNNN with optional R<n>
  {
    name: 'editorial-manager',
    re: /\b([A-Z]{2,10}-[A-Z]-\d{2}-\d{3,6}(?:R\d{1,2})?)\b/,
    confidence: 0.96,
  },
  // ScholarOne-ish: PREFIX-YY-NNNN(.R1)
  {
    name: 'scholarone',
    re: /\b([A-Z]{2,10}-\d{2}-\d{3,6}(?:\.R\d{1,2})?)\b/,
    confidence: 0.9,
  },
  // Bracketed IDs common in subject lines: [JOSR-2025-00123]
  {
    name: 'bracketed',
    re: /[[(]\s*([A-Z]{2,10}[-_]\d{3,6}[-_]?\d{0,6}(?:R\d{1,2})?)\s*[\])]/,
    confidence: 0.85,
  },
];

/**
 * Pull a manuscript identifier out of an email.
 * Subject is searched before body: subjects are terse and rarely quote another
 * paper's ID, whereas bodies often contain forwarded threads about other
 * manuscripts. Searching subject-first prevents cross-contamination.
 *
 * @returns {{id: string, confidence: number, pattern: string, source: string}|null}
 */
export function extractManuscriptId(subject = '', body = '') {
  for (const zone of [
    { text: subject, label: 'subject', boost: 0 },
    // Only the first stretch of the body: signatures, footers and quoted
    // history live further down and are a common source of stale IDs.
    { text: (body || '').slice(0, 4000), label: 'body', boost: -0.05 },
  ]) {
    if (!zone.text) continue;
    for (const p of MS_ID_PATTERNS) {
      const m = zone.text.match(p.re);
      if (m && m[1]) {
        return {
          id: normaliseId(m[1]),
          confidence: Math.max(0, p.confidence + zone.boost),
          pattern: p.name,
          source: zone.label,
        };
      }
    }
  }
  return null;
}

/**
 * Normalise an ID for comparison.
 *
 * Critically this STRIPS the revision suffix (R1, .R2). When you resubmit,
 * "ESJ-D-25-00112" becomes "ESJ-D-25-00112R1" — the same manuscript with a new
 * label. Without stripping, a revision would look like a brand-new paper and
 * land in the unmatched queue every single time.
 */
export function normaliseId(raw) {
  return String(raw)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[._]/g, '-')
    .replace(/-?R\d{1,2}$/, ''); // drop revision suffix
}

// ---------------------------------------------------------------------------
// STATUS RULES
// ---------------------------------------------------------------------------
// Ordered by `priority` (higher wins when several rules fire). Priorities
// encode editorial reality:
//
//   Final decisions (accept/reject) outrank process noise. An email that says
//   "your manuscript has been accepted" while also containing the boilerplate
//   "you may check the status at any time" must resolve to Accepted.
//
//   Revision requests outrank generic "under review", because a revision email
//   almost always recaps the review process before making its request.
//
// `weight` feeds confidence. `notIf` vetoes. `terminal: true` marks a status
// that should never be silently walked back — if a paper is Published and an
// email suggests "Under Review", the caller treats that as suspicious.
// ---------------------------------------------------------------------------

const RULES = [
  // ----- PUBLISHED -------------------------------------------------------
  {
    status: 'Published',
    priority: 100,
    terminal: true,
    weight: 0.95,
    patterns: [
      /\b(?:now|has been)\s+published\s+(?:online|in|as)/i,
      /your\s+article\s+(?:is\s+)?(?:now\s+)?(?:available|published)\s+online/i,
      /\bissue\s+assignment\b/i,
      /article\s+publishing\s+charge.*(?:paid|receipt)/i,
      /\bversion\s+of\s+record\b/i,
    ],
    notIf: [
      /before\s+(?:it\s+can\s+be\s+)?published/i,
      /will\s+be\s+published\s+(?:once|after|upon)/i,
    ],
  },

  // ----- PROOFS / IN PRODUCTION -----------------------------------------
  {
    status: 'In Production (Proofs)',
    priority: 90,
    weight: 0.9,
    patterns: [
      /\b(?:page\s+)?proofs?\s+(?:are\s+)?(?:ready|available|attached)/i,
      /correct\s+your\s+proof/i,
      /\bproof\s+correction/i,
      /in\s+production/i,
      /author\s+proof/i,
      /\bcopyedit(?:ing|ed)?\b/i,
    ],
    notIf: [/proof\s+of\s+(?:payment|identity|funding)/i],
  },

  // ----- ACCEPTED --------------------------------------------------------
  // The highest-stakes rule to get right. Note the anti-patterns: journals
  // routinely write "accepted for review" or "we cannot accept" — neither is
  // an acceptance.
  {
    status: 'Accepted',
    priority: 85,
    terminal: true,
    weight: 0.95,
    patterns: [
      /pleased\s+to\s+(?:inform|tell)\s+you\s+that\s+your\s+(?:manuscript|paper|article|submission)[^.]{0,80}\b(?:has\s+been\s+)?accept/i,
      /your\s+(?:manuscript|paper|article|submission)[^.]{0,80}\bhas\s+been\s+accepted\b/i,
      /\bdecision:\s*accept/i,
      /\baccept(?:ed)?\s+(?:for\s+)?publication\b/i,
      /\bacceptance\s+(?:letter|of\s+your\s+manuscript)/i,
      /happy\s+to\s+(?:inform|accept)/i,
    ],
    notIf: [
      /accept(?:ed)?\s+for\s+review/i,
      /cannot\s+accept/i,
      /not\s+(?:be\s+)?accept/i,
      /unable\s+to\s+accept/i,
      /accept(?:ance)?\s+(?:is\s+)?(?:subject\s+to|conditional|pending)/i,
      /if\s+accepted/i,
      /terms\s+(?:and\s+conditions|of\s+use)/i,
    ],
  },

  // ----- ACCEPTED WITH MINOR CONDITIONS ---------------------------------
  {
    status: 'Accepted (Conditional)',
    priority: 84,
    weight: 0.8,
    patterns: [
      /accept(?:ed|ance)?\s+(?:subject\s+to|conditional\s+(?:on|upon)|pending)\s+(?:minor\s+)?(?:revision|correction|change)/i,
      /conditionally\s+accept/i,
      /accept\s+(?:with|after)\s+minor\s+revision/i,
    ],
    notIf: [],
  },

  // ----- REJECTED --------------------------------------------------------
  // Anti-patterns matter enormously here. Reviewer *recommendations* of
  // rejection appear inside revision letters, and "rejected" shows up in
  // instructions ("if your paper is rejected you may appeal").
  {
    status: 'Rejected',
    priority: 80,
    terminal: true,
    weight: 0.93,
    patterns: [
      /\bregret\s+to\s+inform\s+you/i,
      /\bdecision:\s*reject/i,
      /(?:manuscript|paper|article|submission)[^.]{0,80}\b(?:has\s+been\s+|was\s+)?reject(?:ed)?\b/i,
      /not\s+(?:be\s+)?(?:able\s+to\s+)?(?:accept|proceed|consider)[^.]{0,60}(?:publication|further)/i,
      /unable\s+to\s+(?:accept|publish|consider)\s+your/i,
      /does\s+not\s+meet\s+(?:the\s+)?(?:priority|criteria|standard)/i,
      /\bdeclin(?:e|ed|ing)\s+to\s+(?:publish|consider|review)/i,
      /not\s+suitable\s+for\s+publication\s+in/i,
    ],
    notIf: [
      /reviewer[^.]{0,40}recommend[^.]{0,40}reject/i, // a recommendation, not the decision
      /if\s+(?:your\s+)?(?:manuscript|paper)\s+is\s+rejected/i,
      /in\s+the\s+event\s+of\s+rejection/i,
      /appeal\s+(?:a|the)\s+rejection/i,
      /rejection\s+rate/i,
      /previously\s+rejected/i,
    ],
  },

  // ----- DESK REJECT -----------------------------------------------------
  // Separated from ordinary rejection because it means something different
  // for your workflow: no review happened, so the paper can go straight out
  // to another journal without waiting on reviewer feedback.
  {
    status: 'Desk Rejected',
    priority: 82,
    terminal: true,
    weight: 0.9,
    patterns: [
      /\bdesk\s+reject/i,
      // "not to proceed" / "not proceed" / "not be proceeding" — journals phrase
      // this many ways, and missing the "to" was silently dropping desk rejects.
      /without\s+(?:external\s+|formal\s+|peer\s+)?review[^.]{0,80}(?:reject|declin|not\s+(?:to\s+|be\s+)?proceed)/i,
      /(?:reject|declin|not\s+(?:to\s+|be\s+)?proceed(?:ing)?)[^.]{0,80}without\s+(?:external\s+|formal\s+|peer\s+)?(?:review|assessment)/i,
      /editorial\s+(?:screening|assessment|review)[^.]{0,90}(?:not\s+(?:to\s+|be\s+)?proceed|declin|reject|unable)/i,
      /not\s+(?:been\s+)?sent\s+(?:out\s+)?(?:for|to)\s+(?:external\s+|peer\s+)?review[^.]{0,60}(?:reject|declin|not\s+proceed)/i,
    ],
    notIf: [],
  },

  // ----- MAJOR REVISION --------------------------------------------------
  {
    status: 'Major Revision Requested',
    priority: 75,
    weight: 0.9,
    patterns: [
      /\bmajor\s+revision/i,
      /\bdecision:\s*major/i,
      /substantial\s+revision/i,
      /extensively\s+revis/i,
    ],
    notIf: [/major\s+revision\s+(?:was\s+)?(?:submitted|completed|received)/i],
  },

  // ----- MINOR REVISION --------------------------------------------------
  {
    status: 'Minor Revision Requested',
    priority: 74,
    weight: 0.9,
    patterns: [/\bminor\s+revision/i, /\bdecision:\s*minor/i, /minor\s+(?:changes|corrections)\s+(?:are\s+)?(?:required|needed)/i],
    notIf: [/minor\s+revision\s+(?:was\s+)?(?:submitted|completed|received)/i],
  },

  // ----- REVISION (unspecified) -----------------------------------------
  {
    status: 'Revision Requested',
    priority: 70,
    weight: 0.82,
    patterns: [
      /invite\s+you\s+to\s+submit\s+a\s+revis/i,
      /revise\s+(?:and\s+resubmit|your\s+manuscript)/i,
      /\brevised\s+(?:manuscript|version)\s+(?:is\s+)?(?:required|requested|invited)/i,
      /address\s+the\s+reviewers?'?\s+comments/i,
      /reviewers?'?\s+comments\s+(?:are\s+)?(?:attached|below|enclosed)/i,
      /resubmit\s+(?:your|the)\s+(?:manuscript|paper)/i,
    ],
    notIf: [
      /thank\s+you\s+for\s+(?:submitting|your)\s+revis/i, // that is a receipt, not a request
      /we\s+have\s+received\s+your\s+revis/i,
    ],
  },

  // ----- REVISION SUBMITTED ---------------------------------------------
  {
    status: 'Revision Submitted',
    priority: 68,
    weight: 0.85,
    patterns: [
      /(?:received|thank\s+you\s+for)[^.]{0,40}your\s+revised\s+(?:manuscript|submission|version)/i,
      /revised\s+(?:manuscript|submission)\s+(?:has\s+been\s+)?received/i,
      /resubmission\s+received/i,
    ],
    notIf: [],
  },

  // ----- WITH EDITOR / DECISION PENDING ---------------------------------
  {
    status: 'Awaiting Editor Decision',
    priority: 60,
    weight: 0.75,
    patterns: [
      /\bwith\s+editor\b/i,
      /editor\s+(?:decision|assignment)\s+pending/i,
      /reviews?\s+(?:are\s+)?complete[^.]{0,60}decision/i,
      /awaiting\s+(?:the\s+)?(?:editor|eic|editorial)\s+decision/i,
      /\brecommendation\s+(?:has\s+been\s+)?submitted\s+to\s+the\s+editor/i,
    ],
    notIf: [],
  },

  // ----- UNDER REVIEW ----------------------------------------------------
  {
    status: 'Under Review',
    priority: 50,
    weight: 0.8,
    patterns: [
      /\bunder\s+review\b/i,
      /(?:sent|assigned)\s+(?:out\s+)?(?:for|to)\s+(?:peer\s+)?review/i,
      /reviewers?\s+(?:have\s+been\s+)?(?:assigned|invited|secured)/i,
      /\bin\s+peer\s+review\b/i,
      /review\s+(?:process\s+)?(?:has\s+)?(?:begun|started|in\s+progress)/i,
    ],
    notIf: [/review\s+(?:is\s+)?complete/i, /under\s+review\s+(?:for\s+)?(?:another|a\s+different)/i],
  },

  // ----- REVIEWER INVITE (NOT ABOUT YOUR PAPER) -------------------------
  // Deliberately classified so it can be DISCARDED. Reviewer invitations look
  // structurally identical to submission mail — same sender, same manuscript
  // ID format — but the manuscript is someone else's. Without this rule the
  // system would happily invent papers you never wrote.
  {
    status: '__IGNORE_REVIEW_INVITE__',
    priority: 120, // beats everything: identify and drop before anything else
    weight: 0.9,
    ignore: true,
    patterns: [
      /invitation\s+to\s+review/i,
      /invite\s+you\s+to\s+review\s+(?:the\s+)?(?:above|following|attached)?\s*manuscript/i,
      /would\s+you\s+be\s+(?:willing|available)\s+to\s+review/i,
      /agree(?:d)?\s+to\s+review\s+(?:the\s+)?manuscript/i,
      /reviewer\s+(?:invitation|assignment)\s+(?:for|reminder)/i,
      /thank\s+you\s+for\s+(?:agreeing\s+to\s+)?review(?:ing)?\s+(?:the\s+)?manuscript/i,
      /your\s+review\s+is\s+(?:due|overdue)/i,
    ],
    notIf: [/your\s+manuscript\s+is\s+under\s+review/i],
  },

  // ----- SUBMITTED / RECEIPT --------------------------------------------
  {
    status: 'Submitted',
    priority: 40,
    weight: 0.8,
    patterns: [
      /(?:thank\s+you\s+for|we\s+(?:have\s+)?(?:received|acknowledge))[^.]{0,60}(?:submission|submitting)/i,
      /submission\s+(?:confirmation|received|acknowledgement)/i,
      /has\s+been\s+(?:successfully\s+)?(?:submitted|received)/i,
      /\bmanuscript\s+received\b/i,
    ],
    notIf: [/revised/i],
  },

  // ----- ACTION REQUIRED FROM YOU ---------------------------------------
  // Low priority but flagged separately so the dashboard can shout. These are
  // the emails that quietly kill submissions when they sit unread.
  {
    status: 'Action Required',
    priority: 45,
    weight: 0.7,
    urgent: true,
    patterns: [
      /action\s+(?:is\s+)?required/i,
      /(?:incomplete|unsuccessful)\s+submission/i,
      /please\s+(?:complete|provide|upload|sign)[^.]{0,60}(?:within|by)\s+\d+\s+(?:day|week)/i,
      /(?:copyright|licence|license)\s+(?:form|agreement)[^.]{0,40}(?:sign|complete|required)/i,
      /your\s+submission\s+(?:will\s+be\s+)?(?:withdrawn|removed)\s+(?:if|unless)/i,
      /reminder[^.]{0,60}(?:overdue|outstanding|awaiting\s+your)/i,
    ],
    notIf: [/no\s+action\s+(?:is\s+)?(?:required|needed)/i],
  },

  // ----- WITHDRAWN -------------------------------------------------------
  {
    status: 'Withdrawn',
    priority: 88,
    terminal: true,
    weight: 0.85,
    patterns: [/(?:manuscript|submission)[^.]{0,60}(?:has\s+been\s+)?withdrawn/i, /withdrawal\s+(?:confirmed|request\s+processed)/i],
    // CRITICAL ANTI-PATTERNS. Journals routinely THREATEN withdrawal to chase a
    // signature: "your submission will be withdrawn unless the copyright form is
    // returned". Without these vetoes that email marks a live paper Withdrawn —
    // a false terminal state that makes an active submission look dead.
    // Only past-tense, unconditional withdrawal counts.
    notIf: [
      /if\s+you\s+(?:wish|want|would\s+like)\s+to\s+withdraw/i,
      /(?:will|may|shall|could|might)\s+be\s+withdrawn/i,
      /withdrawn\s+(?:if|unless|should\s+you)/i,
      /(?:unless|failing\s+which|otherwise)[^.]{0,80}withdrawn/i,
      /risk\s+of\s+withdrawal/i,
      /to\s+withdraw\s+(?:your|the)\s+(?:manuscript|submission),?\s+(?:please|click|contact)/i,
    ],
  },
];

// Statuses that represent a settled outcome. Used by the caller to detect
// implausible regressions (Published -> Under Review) which almost always mean
// a mis-parse or an old email arriving late.
export const TERMINAL_STATUSES = new Set(
  RULES.filter((r) => r.terminal).map((r) => r.status)
);

// Rough forward ordering of the publication pipeline. Index = how far along.
// Used only to WARN about backward jumps, never to block them — appeals and
// resubmissions genuinely do move backwards.
export const STATUS_ORDER = [
  'Yet to start',
  'Submitted',
  'Under Review',
  'Awaiting Editor Decision',
  'Revision Requested',
  'Minor Revision Requested',
  'Major Revision Requested',
  'Revision Submitted',
  'Accepted (Conditional)',
  'Accepted',
  'In Production (Proofs)',
  'Published',
];

/**
 * Classify one email.
 *
 * @param {{subject?: string, body?: string, from?: string}} email
 * @returns {{
 *   status: string|null,
 *   confidence: number,
 *   rule: string|null,
 *   evidence: string|null,
 *   ambiguous: boolean,
 *   ignore: boolean,
 *   urgent: boolean,
 *   competing: Array<{status: string, score: number}>
 * }}
 */
export function classifyStatus(email) {
  const subject = email.subject || '';
  const body = stripQuotedReplies(email.body || '');
  // Subject text is weighted more heavily: journals put the decision in the
  // subject line ("Decision on JOSR-D-25-00417") and bodies contain history.
  const haystack = `${subject}\n${subject}\n${body}`;

  const hits = [];

  for (const rule of RULES) {
    // Veto first — cheaper and safer.
    const veto = rule.notIf?.find((re) => re.test(haystack));
    if (veto) continue;

    const match = rule.patterns.map((re) => haystack.match(re)).find(Boolean);
    if (!match) continue;

    const inSubject = rule.patterns.some((re) => re.test(subject));
    hits.push({
      status: rule.status,
      priority: rule.priority,
      // Subject hits get a confidence bump; they are far less likely to be
      // quoting an unrelated thread.
      score: rule.weight + (inSubject ? 0.05 : 0) + rule.priority / 1000,
      confidence: Math.min(0.99, rule.weight + (inSubject ? 0.05 : 0)),
      evidence: snippet(haystack, match.index, match[0]),
      ignore: !!rule.ignore,
      urgent: !!rule.urgent,
    });
  }

  if (hits.length === 0) {
    return {
      status: null, confidence: 0, rule: null, evidence: null,
      ambiguous: false, ignore: false, urgent: false, competing: [],
    };
  }

  hits.sort((a, b) => b.priority - a.priority || b.score - a.score);
  const top = hits[0];

  // A reviewer invitation short-circuits everything.
  if (top.ignore) {
    return {
      status: null, confidence: top.confidence, rule: top.status,
      evidence: top.evidence, ambiguous: false, ignore: true,
      urgent: false, competing: [],
    };
  }

  // ---- Ambiguity check -------------------------------------------------
  // Two rules of MEANINGFULLY different outcome firing at similar strength is
  // the signature of a confusing email. Rather than pick, we refuse.
  const runnerUp = hits.find((h) => h.status !== top.status && !h.ignore);
  let ambiguous = false;
  if (runnerUp) {
    const closeInScore = top.score - runnerUp.score < 0.12;
    const bothDecisive = isDecisive(top.status) && isDecisive(runnerUp.status);
    // Accept vs Reject at similar strength: never guess. That is the single
    // most damaging error this system could make.
    if (bothDecisive && closeInScore) ambiguous = true;
  }

  return {
    status: top.status,
    confidence: ambiguous ? Math.min(top.confidence, 0.5) : top.confidence,
    rule: top.status,
    evidence: top.evidence,
    ambiguous,
    ignore: false,
    urgent: top.urgent,
    competing: hits.slice(0, 4).map((h) => ({ status: h.status, score: +h.score.toFixed(3) })),
  };
}

// A "decisive" status is one that changes what you do next. Confusing two of
// these is costly; confusing two process statuses is not.
function isDecisive(status) {
  return [
    'Accepted', 'Accepted (Conditional)', 'Rejected', 'Desk Rejected',
    'Major Revision Requested', 'Minor Revision Requested',
    'Revision Requested', 'Published', 'Withdrawn',
  ].includes(status);
}

/**
 * Remove quoted reply history.
 *
 * Journal threads accumulate. Without this, last month's "Under Review" text
 * sits in today's acceptance email and competes with it. We cut at the first
 * quote marker and keep only the fresh content.
 */
export function stripQuotedReplies(body) {
  if (!body) return '';
  const cutMarkers = [
    /^\s*On .{5,80}\bwrote:\s*$/im,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*_{5,}\s*$/m,
    /^\s*From:\s.+$/im,
    /^\s*>{1,}\s?/m,
  ];
  let cut = body.length;
  for (const re of cutMarkers) {
    const m = body.match(re);
    if (m && m.index !== undefined && m.index < cut && m.index > 120) cut = m.index;
  }
  return body.slice(0, cut);
}

/** Extract a readable window of text around a match, for the audit trail. */
function snippet(text, index, matched, pad = 90) {
  if (index === undefined || index === null) return matched;
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + matched.length + pad);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

// ---------------------------------------------------------------------------
// JOURNAL NAME EXTRACTION
// ---------------------------------------------------------------------------
// Best-effort and intentionally low-stakes: the journal is metadata for
// display, not a matching key, so a miss costs nothing.
// ---------------------------------------------------------------------------

export function extractJournal(email, knownJournals = []) {
  const hay = `${email.subject || ''}\n${(email.body || '').slice(0, 3000)}`;

  // A journal you already track wins outright — it is ground truth.
  for (const j of knownJournals) {
    if (j && j.length > 4 && hay.toLowerCase().includes(j.toLowerCase())) return j;
  }

  const patterns = [
    /\b((?:international\s+|european\s+|asian\s+|indian\s+|american\s+|british\s+|world\s+)?journal\s+of\s+[A-Z][A-Za-z&'-]+(?:\s+(?:and|of|&|for)?\s*[A-Z][A-Za-z&'-]+){0,4})/i,
    /\b([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3}\s+Journal)\b/,
    /\b(Spine|Cureus|BMJ(?:\s+Open)?|PLOS\s+\w+|Scientific\s+Reports|Nature\s+\w+|Lancet(?:\s+\w+)?)\b/i,
  ];
  for (const re of patterns) {
    const m = hay.match(re);
    if (m && m[1]) return m[1].replace(/\s+/g, ' ').trim();
  }

  // Fall back to the sender's domain: em.jospine.com -> "jospine"
  const from = email.from || '';
  const dm = from.match(/@([\w.-]+)/);
  if (dm) {
    const host = dm[1].replace(/^(?:em|mail|noreply|no-reply|editorialmanager)\./i, '');
    const brand = host.split('.')[0];
    if (brand && brand.length > 2 && !/^(gmail|yahoo|outlook|hotmail)$/i.test(brand)) {
      return brand;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// RELEVANCE FILTER
// ---------------------------------------------------------------------------
// Runs before anything else to keep the volume of processed mail small and
// the false-positive surface low. A newsletter from a publisher must never
// reach the classifier.
// ---------------------------------------------------------------------------

const PUBLISHER_HINTS = [
  'editorialmanager', 'scholarone', 'manuscriptcentral', 'ejournalpress',
  'elsevier', 'springer', 'wiley', 'taylorandfrancis', 'tandfonline',
  'sagepub', 'bmj', 'plos', 'frontiersin', 'mdpi', 'lww', 'jamanetwork',
  'nature.com', 'cureus', 'researchsquare', 'aries', 'snapp',
];

const NEWSLETTER_MARKERS = [
  /\bunsubscribe\b/i, /call\s+for\s+papers/i, /special\s+issue\s+(?:invitation|proposal)/i,
  /table\s+of\s+contents\s+alert/i, /\bnewsletter\b/i, /citation\s+alert/i,
  /webinar/i, /\bconference\s+(?:registration|announcement)/i,
  /discount\s+(?:on|for)/i, /\bimpact\s+factor\s+(?:announcement|news)/i,
];

/**
 * Decide whether an email is worth classifying at all.
 * @returns {{relevant: boolean, reason: string}}
 */
export function isRelevant(email) {
  const from = (email.from || '').toLowerCase();
  const subject = email.subject || '';
  const body = (email.body || '').slice(0, 3000);
  const hay = `${subject}\n${body}`;

  // Marketing/newsletter mail is dropped even from real publisher domains —
  // "Call for Papers" from Elsevier is not a status update.
  const nl = NEWSLETTER_MARKERS.find((re) => re.test(hay));
  const looksTransactional = /(?:manuscript|submission)\s*(?:number|id|ref)/i.test(hay);
  if (nl && !looksTransactional) {
    return { relevant: false, reason: `newsletter-marker:${nl.source.slice(0, 30)}` };
  }

  const fromPublisher = PUBLISHER_HINTS.some((h) => from.includes(h));
  const hasMsId = !!extractManuscriptId(subject, body);
  const editorialWords =
    /\b(?:manuscript|submission|peer\s+review|editor(?:ial)?\s+(?:office|decision)|reviewer)\b/i.test(hay);

  if (fromPublisher || hasMsId) return { relevant: true, reason: fromPublisher ? 'publisher-domain' : 'manuscript-id' };
  if (editorialWords && /\bdecision|review|revis|accept|reject\b/i.test(hay)) {
    return { relevant: true, reason: 'editorial-language' };
  }
  return { relevant: false, reason: 'no-editorial-signal' };
}

export const __testing__ = { RULES, MS_ID_PATTERNS };
