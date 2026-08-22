#!/usr/bin/env node
// ============================================================================
// test-classifier.mjs — adversarial tests for the classification logic
// ============================================================================
//
// Run before trusting the sync unattended, and again any time you edit a rule:
//   node scripts/test-classifier.mjs
//
// These are not happy-path tests. Nearly every case here is drawn from a way
// real editorial email trips up naive keyword matching:
//
//   · rejection language quoted inside a revision invitation
//   · "accepted for review" (not an acceptance)
//   · reviewer invitations for OTHER people's manuscripts
//   · last month's status quoted at the bottom of this month's decision
//   · desk rejection vs post-review rejection
//   · revision suffixes (R1/R2) that must resolve to the same manuscript
//
// A failure here is a bug that would silently corrupt your tracker. Treat red
// output as a blocker, not a warning.
// ============================================================================

import { classifyStatus, extractManuscriptId, normaliseId, isRelevant, extractJournal } from './lib/classify.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { passed++; console.log(`  \x1b[32m✔\x1b[0m ${name}`); }
  else {
    failed++;
    failures.push({ name, actual, expected });
    console.log(`  \x1b[31m✖\x1b[0m ${name}`);
    console.log(`      expected: ${expected}`);
    console.log(`      actual  : ${actual}`);
  }
}

function section(title) {
  console.log(`\n\x1b[36m${'─'.repeat(70)}\n  ${title}\n${'─'.repeat(70)}\x1b[0m`);
}

// ===========================================================================
section('STATUS: acceptance — the highest-stakes call');
// ===========================================================================

check('plain acceptance',
  classifyStatus({
    subject: 'Decision on JOSR-D-25-00417',
    body: 'Dear Dr Vikash, I am pleased to inform you that your manuscript "Outcomes of Spinal Fusion" has been accepted for publication in the Journal of Orthopaedic Surgery and Research.',
  }).status,
  'Accepted');

check('"accepted for review" is NOT an acceptance',
  classifyStatus({
    subject: 'Submission received JOSR-D-25-00417',
    body: 'Thank you for your submission. Your manuscript has been accepted for review and assigned to an editor.',
  }).status,
  'Submitted');

check('"cannot accept" is not an acceptance',
  classifyStatus({
    subject: 'Decision on ESJ-D-25-00112',
    body: 'We regret to inform you that we cannot accept your manuscript for publication.',
  }).status,
  'Rejected');

check('conditional acceptance is distinguished',
  classifyStatus({
    subject: 'Decision on SPINE-25-0442',
    body: 'Your manuscript has been conditionally accepted subject to minor revision of the statistics section.',
  }).status,
  'Accepted (Conditional)');

// ===========================================================================
section('STATUS: rejection vs revision — the classic confusion');
// ===========================================================================

check('revision invite containing the word "rejection" is a REVISION not a rejection',
  classifyStatus({
    subject: 'Decision on JOSR-D-25-00417',
    body: 'Although one reviewer recommended rejection, the editor invites you to submit a revised manuscript addressing the comments below. Please address the reviewers comments within 60 days.',
  }).status,
  'Revision Requested');

check('threatened withdrawal is NOT a withdrawal (live paper must not look dead)',
  classifyStatus({
    subject: 'Reminder: copyright form outstanding',
    body: 'Please sign the copyright agreement. Your submission will be withdrawn unless the form is returned within 7 days.',
  }).status,
  'Action Required');

check('actual withdrawal still detected',
  classifyStatus({
    subject: 'Withdrawal confirmed ESJ-D-25-00112',
    body: 'As requested, your manuscript has been withdrawn from consideration.',
  }).status,
  'Withdrawn');

check('major revision detected',
  classifyStatus({
    subject: 'JOSR-D-25-00417 - Major Revision Required',
    body: 'Your manuscript requires major revision before it can be considered further.',
  }).status,
  'Major Revision Requested');

check('minor revision detected',
  classifyStatus({
    subject: 'Decision: Minor Revision - ESJ-D-25-00112',
    body: 'The reviewers have suggested minor revision. Please address these points.',
  }).status,
  'Minor Revision Requested');

check('desk rejection separated from ordinary rejection',
  classifyStatus({
    subject: 'Your submission to Asian Spine Journal',
    body: 'After editorial screening we have decided not to proceed with your manuscript without external review, as it falls outside our current scope.',
  }).status,
  'Desk Rejected');

check('plain post-review rejection',
  classifyStatus({
    subject: 'Decision on ASJ-D-25-00901',
    body: 'We regret to inform you that after careful consideration your manuscript has been rejected. The reviewers comments are appended.',
  }).status,
  'Rejected');

check('boilerplate "if your paper is rejected" does not trigger rejection',
  classifyStatus({
    subject: 'Submission confirmation IJO-25-0033',
    body: 'Thank you for your submission. Please note: if your manuscript is rejected you may appeal within 30 days. Your manuscript has been received and will be processed shortly.',
  }).status,
  'Submitted');

// ===========================================================================
section('STATUS: reviewer invitations must be IGNORED, not tracked');
// ===========================================================================

check('reviewer invitation is flagged ignore',
  classifyStatus({
    subject: 'Invitation to review manuscript JOSR-D-25-00988',
    body: 'Dear Dr Muthu, we would be grateful if you would agree to review the manuscript titled "Biomechanics of..." for our journal.',
  }).ignore,
  true);

check('reviewer reminder is flagged ignore',
  classifyStatus({
    subject: 'Reminder: your review is due',
    body: 'Thank you for agreeing to review the manuscript ESJ-D-25-00777. Your review is due in 3 days.',
  }).ignore,
  true);

check('"your manuscript is under review" is NOT a reviewer invite',
  classifyStatus({
    subject: 'Status update JOSR-D-25-00417',
    body: 'Your manuscript is under review. We will contact you when a decision is reached.',
  }).ignore,
  false);

// ===========================================================================
section('STATUS: quoted history must not override fresh content');
// ===========================================================================

check('acceptance wins over quoted "under review" history',
  classifyStatus({
    subject: 'Decision on JOSR-D-25-00417',
    body: `I am pleased to inform you that your manuscript has been accepted for publication.

On Mon, 12 May 2025, Editorial Office wrote:
> Your manuscript is currently under review and has been sent out for peer review.
> Reviewers have been assigned.`,
  }).status,
  'Accepted');

// ===========================================================================
section('STATUS: process states');
// ===========================================================================

check('under review',
  classifyStatus({ subject: 'JOSR-D-25-00417', body: 'Your manuscript has been sent out for peer review.' }).status,
  'Under Review');

check('awaiting editor decision',
  classifyStatus({ subject: 'ESJ-D-25-00112', body: 'All reviews are complete and the manuscript is now with editor for a decision.' }).status,
  'Awaiting Editor Decision');

check('proofs',
  classifyStatus({ subject: 'Proofs ready for JOSR-D-25-00417', body: 'Your page proofs are ready. Please correct your proof within 48 hours.' }).status,
  'In Production (Proofs)');

check('published',
  classifyStatus({ subject: 'Your article is now published', body: 'Your article is now available online as the version of record.' }).status,
  'Published');

check('revision submitted receipt is not a revision request',
  classifyStatus({ subject: 'JOSR-D-25-00417R1', body: 'Thank you for submitting your revised manuscript. We have received your revised submission.' }).status,
  'Revision Submitted');

check('urgent action flagged',
  classifyStatus({
    subject: 'Action required: copyright form',
    body: 'Please sign the copyright agreement form within 7 days. Your submission will be withdrawn unless completed.',
  }).urgent,
  true);

// ===========================================================================
section('MANUSCRIPT ID extraction');
// ===========================================================================

check('Editorial Manager format from subject',
  extractManuscriptId('Decision on JOSR-D-25-00417', '')?.id, 'JOSR-D-25-00417');

check('labelled manuscript number from body',
  extractManuscriptId('A decision has been reached', 'Manuscript Number: ESJ-D-24-01123')?.id, 'ESJ-D-24-01123');

check('ScholarOne format',
  extractManuscriptId('SPINE-25-0442 decision', '')?.id, 'SPINE-25-0442');

check('revision suffix R1 normalises to base ID',
  extractManuscriptId('Decision on JOSR-D-25-00417R1', '')?.id, 'JOSR-D-25-00417');

check('dotted revision suffix normalises too',
  normaliseId('SPINE-D-25-00112.R2'), 'SPINE-D-25-00112');

check('subject beats body (avoids cross-contamination)',
  extractManuscriptId('Decision on JOSR-D-25-00417', 'Regarding your other paper ESJ-D-24-01123 ...')?.id,
  'JOSR-D-25-00417');

check('no ID returns null',
  extractManuscriptId('Newsletter', 'Read our latest issue'), null);

// ===========================================================================
section('RELEVANCE filter');
// ===========================================================================

check('call for papers rejected',
  isRelevant({ from: 'noreply@elsevier.com', subject: 'Call for Papers: Special Issue', body: 'Submit your work. Unsubscribe here.' }).relevant,
  false);

check('table of contents alert rejected',
  isRelevant({ from: 'alerts@springer.com', subject: 'Table of Contents Alert', body: 'New issue available. Unsubscribe.' }).relevant,
  false);

check('real decision email accepted',
  isRelevant({ from: 'em@editorialmanager.com', subject: 'Decision on JOSR-D-25-00417', body: 'Your manuscript has been accepted.' }).relevant,
  true);

check('newsletter WITH a manuscript number still processed',
  isRelevant({ from: 'x@journal.com', subject: 'Decision', body: 'Manuscript Number: JOSR-D-25-00417. Accepted. Unsubscribe here.' }).relevant,
  true);

// ===========================================================================
section('JOURNAL extraction');
// ===========================================================================

check('known journal wins',
  extractJournal({ subject: 'Decision', body: 'from the European Spine Journal editorial office' }, ['European Spine Journal']),
  'European Spine Journal');

check('journal-of pattern',
  extractJournal({ subject: 'Decision', body: 'published in the Journal of Orthopaedic Surgery' }, []),
  'Journal of Orthopaedic Surgery');

// ===========================================================================
// Report
// ===========================================================================

console.log(`\n${'═'.repeat(70)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('═'.repeat(70));

if (failed) {
  console.log('\n  Failing cases:');
  for (const f of failures) console.log(`    · ${f.name}\n        want ${f.expected} / got ${f.actual}`);
  console.log('\n  Do NOT run the sync live until these pass.\n');
  process.exit(1);
}
console.log('\n  Classifier behaving correctly on adversarial cases.\n');
