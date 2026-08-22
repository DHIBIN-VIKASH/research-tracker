// ============================================================================
// fixtures.mjs — the regression corpus. This file IS the specification.
// ============================================================================
//
// Every case here is either (a) a real email that once produced a wrong answer
// in production, or (b) a phrasing that a plausible future edit would break.
//
// RULES OF THE CORPUS
//
//   · A fixture is added BEFORE the fix that makes it pass. Fix-first means
//     you never learn whether the fix was the thing that worked.
//   · A fixture is never deleted to make the suite green. If a case is genuinely
//     wrong, change its `expect` and say why in `note`.
//   · `known` marks a case that currently FAILS because of a documented bug.
//     The runner reports it separately and does not fail the build. When the bug
//     is fixed the case reports XPASS and you delete the `known` field.
//
// SHAPE
//   {
//     id:    stable slug, referenced in commit messages
//     name:  one line, describes the DISCRIMINATION being tested
//     email: { from?, subject, body }
//     expect: any subset of
//             { relevant, status, urgent, ignore, ambiguous, msId, journal }
//     knownJournals: optional array passed to extractJournal
//     known: optional string — bug ID + description; marks an expected failure
//     note:  optional provenance
//   }
//
// Only the keys present in `expect` are asserted. Omitting a key means
// "don't care", which keeps fixtures focused on one discrimination each.
// ============================================================================

export const GROUPS = [

  // =========================================================================
  {
    title: 'ACCEPTANCE — the highest-stakes call',
    cases: [
      {
        id: 'accept-plain',
        name: 'plain acceptance',
        email: {
          subject: 'Decision on JOSR-D-25-00417',
          body: 'Dear Dr Vikash, I am pleased to inform you that your manuscript "Outcomes of Spinal Fusion" has been accepted for publication in the Journal of Orthopaedic Surgery and Research.',
        },
        expect: { status: 'Accepted' },
      },
      {
        id: 'accept-for-review-is-not-acceptance',
        name: '"accepted for review" is NOT an acceptance',
        email: {
          subject: 'Submission received JOSR-D-25-00417',
          body: 'Thank you for your submission. Your manuscript has been accepted for review and assigned to an editor.',
        },
        expect: { status: 'Submitted' },
      },
      {
        id: 'cannot-accept-is-rejection',
        name: '"cannot accept" is a rejection, not an acceptance',
        email: {
          subject: 'Decision on ESJ-D-25-00112',
          body: 'We regret to inform you that we cannot accept your manuscript for publication.',
        },
        expect: { status: 'Rejected' },
      },
      {
        id: 'accept-conditional',
        name: 'conditional acceptance kept distinct from outright acceptance',
        email: {
          subject: 'Decision on SPINE-25-0442',
          body: 'Your manuscript has been conditionally accepted subject to minor revision of the statistics section.',
        },
        expect: { status: 'Accepted (Conditional)' },
      },
      {
        id: 'accept-if-accepted-boilerplate',
        name: '"if accepted" boilerplate in a submission receipt is not an acceptance',
        email: {
          subject: 'Submission confirmation IJO-25-0033',
          body: 'Thank you for your submission. If accepted, your article will be published under a CC-BY licence. Your manuscript has been received.',
        },
        expect: { status: 'Submitted' },
      },
    ],
  },

  // =========================================================================
  {
    title: 'REJECTION vs REVISION — the classic confusion',
    cases: [
      {
        id: 'revision-containing-rejection-word',
        name: 'revision invite quoting a reviewer who recommended rejection',
        email: {
          subject: 'Decision on JOSR-D-25-00417',
          body: 'Although one reviewer recommended rejection, the editor invites you to submit a revised manuscript addressing the comments below. Please address the reviewers comments within 60 days.',
        },
        expect: { status: 'Revision Requested', urgent: true },
      },
      {
        id: 'reject-plain-post-review',
        name: 'plain post-review rejection',
        email: {
          subject: 'Decision on ASJ-D-25-00901',
          body: 'We regret to inform you that after careful consideration your manuscript has been rejected. The reviewers comments are appended.',
        },
        expect: { status: 'Rejected' },
      },
      {
        id: 'reject-with-appeal-footer',
        name: 'genuine rejection carrying the standard appeal footer',
        email: {
          subject: 'Decision on JOSR-D-25-00417',
          body: 'Dear Dr Vikash,\n\nI regret to inform you that we are unable to accept your manuscript for publication in this journal.\n\n--\nIf you wish to appeal the rejection, please contact the editorial office within 30 days.',
        },
        expect: { status: 'Rejected' },
      },
      {
        id: 'reject-boilerplate-if-rejected',
        name: '"if your manuscript is rejected" in a receipt is not a rejection',
        email: {
          subject: 'Submission confirmation IJO-25-0033',
          body: 'Thank you for your submission. Please note: if your manuscript is rejected you may appeal within 30 days. Your manuscript has been received and will be processed shortly.',
        },
        expect: { status: 'Submitted' },
      },
      {
        id: 'reject-and-resubmit',
        name: 'reject-with-invitation-to-resubmit is still a live paper, not a dead one',
        email: {
          subject: 'Decision on ESJ-D-25-00112',
          body: 'We are unable to accept your manuscript in its present form. However, the reviewers saw merit in the work and we would welcome a resubmission as a new submission following substantial rework.',
        },
        expect: { status: 'Rejected' },
        note: 'Lands as Rejected, which is defensible. Flagged because the workflow differs: a resubmission invitation is worth acting on, an ordinary rejection means pick a new journal. Consider a distinct status.',
      },
      {
        id: 'revision-major',
        name: 'major revision',
        email: {
          subject: 'JOSR-D-25-00417 - Major Revision Required',
          body: 'Your manuscript requires major revision before it can be considered further.',
        },
        expect: { status: 'Major Revision Requested', urgent: true },
      },
      {
        id: 'revision-minor',
        name: 'minor revision',
        email: {
          subject: 'Decision: Minor Revision - ESJ-D-25-00112',
          body: 'The reviewers have suggested minor revision. Please address these points.',
        },
        expect: { status: 'Minor Revision Requested', urgent: true },
      },
      {
        id: 'revision-received-is-not-requested',
        name: 'revision RECEIPT must not read as a revision REQUEST',
        email: {
          subject: 'ESJ-D-25-00112R1 received',
          body: 'Thank you for submitting your revised manuscript. Your revised submission has been received and forwarded to the editor.',
        },
        expect: { status: 'Revision Submitted', urgent: false },
      },
    ],
  },

  // =========================================================================
  {
    title: 'DESK REJECTION — no review happened, paper can move immediately',
    cases: [
      {
        id: 'desk-not-to-proceed',
        name: '"decided not to proceed ... without external review"',
        email: {
          subject: 'Your submission to Asian Spine Journal',
          body: 'After editorial screening we have decided not to proceed with your manuscript without external review, as it falls outside our current scope.',
        },
        expect: { status: 'Desk Rejected' },
        note: 'Regression: the original pattern required "not proceed" and missed "not TO proceed", silently dropping desk rejects.',
      },
      {
        id: 'desk-not-be-proceeding',
        name: '"will not be proceeding" phrasing variant',
        email: {
          subject: 'Decision on GSJ-26-1102',
          body: 'Following editorial assessment we will not be proceeding with your submission. It has not been sent for peer review.',
        },
        expect: { status: 'Desk Rejected' },
      },
      {
        id: 'desk-vs-full-reject',
        name: 'rejection AFTER review is not a desk rejection',
        email: {
          subject: 'Decision on ASJ-D-25-00901',
          body: 'Your manuscript was assessed by two external reviewers. We regret to inform you that it has been rejected.',
        },
        expect: { status: 'Rejected' },
      },
    ],
  },

  // =========================================================================
  {
    title: 'ACTION REQUIRED / UNSUBMITTED — the alerts that actually matter',
    cases: [
      {
        id: 'unsubmitted-scholarone',
        name: 'ScholarOne reverting a live submission to draft',
        email: {
          subject: 'GSJ-26-1643 has been unsubmitted',
          body: 'Your manuscript GSJ-26-1643 has been unsubmitted and returned to your author centre. Please correct the flagged items and resubmit.',
        },
        expect: { status: 'Unsubmitted (Action Required)', urgent: true },
        note: 'Real email. Before the Unsubmitted rule existed this matched NO rule, produced no status, and was silently discarded.',
      },
      {
        id: 'unsubmitted-threat-is-not-event',
        name: '"may be unsubmitted if" is a threat, not an event',
        email: {
          subject: 'Outstanding documents GSJ-26-1643',
          body: 'Your submission may be unsubmitted if the ethics approval is not provided within 14 days.',
        },
        expect: { status: 'Action Required', urgent: true },
      },
      {
        id: 'urgent-under-a-process-status',
        name: 'ACTION REQUIRED buried under an "under review" status still raises the alert',
        email: {
          subject: 'JOSR-D-25-00417: your manuscript is under review',
          body: 'Your manuscript has been sent out for peer review.\n\nACTION REQUIRED: the copyright transfer form must be signed within 7 days.',
        },
        expect: { status: 'Under Review', urgent: true },
      },
      {
        id: 'no-action-required-negation',
        name: '"no action is required" must not raise an alert',
        email: {
          subject: 'Status update JOSR-D-25-00417',
          body: 'Your manuscript is progressing normally. No action is required from you at this time.',
        },
        expect: { urgent: false },
      },
      {
        id: 'copyright-form-chase',
        name: 'copyright form chase is urgent',
        email: {
          subject: 'Reminder: copyright form outstanding',
          body: 'Please sign the copyright agreement. Your submission will be withdrawn unless the form is returned within 7 days.',
        },
        expect: { status: 'Action Required', urgent: true },
      },
    ],
  },

  // =========================================================================
  {
    title: 'WITHDRAWAL — a false terminal state makes a live paper look dead',
    cases: [
      {
        id: 'withdrawal-threat',
        name: 'threatened withdrawal is NOT a withdrawal',
        email: {
          subject: 'Reminder: copyright form outstanding',
          body: 'Please sign the copyright agreement. Your submission will be withdrawn unless the form is returned within 7 days.',
        },
        expect: { status: 'Action Required' },
      },
      {
        id: 'withdrawal-real',
        name: 'actual withdrawal still detected',
        email: {
          subject: 'Withdrawal confirmed ESJ-D-25-00112',
          body: 'As requested, your manuscript has been withdrawn from consideration.',
        },
        expect: { status: 'Withdrawn' },
      },
      {
        id: 'withdrawal-instructions',
        name: '"to withdraw your manuscript, please contact" is instructions, not an event',
        email: {
          subject: 'Submission received JOSR-D-25-00417',
          body: 'Your manuscript has been received. To withdraw your manuscript, please contact the editorial office.',
        },
        expect: { status: 'Submitted' },
      },
    ],
  },

  // =========================================================================
  {
    title: 'REVIEWER INVITATIONS — someone else\'s paper, must be dropped',
    cases: [
      {
        id: 'reviewer-invite',
        name: 'invitation to review is flagged ignore',
        email: {
          subject: 'Invitation to review manuscript JOSR-D-25-00988',
          body: 'Dear Dr Muthu, we would be grateful if you would agree to review the manuscript titled "Biomechanics of..." for our journal.',
        },
        expect: { ignore: true },
      },
      {
        id: 'reviewer-request-plain',
        name: '"request to review a manuscript" phrasing',
        email: {
          subject: 'Request to review a manuscript',
          body: 'You have been requested to review a manuscript for the European Spine Journal.',
        },
        expect: { ignore: true },
        note: 'Regression: this wording matched none of the invite patterns and landed in Needs Attention as generic noise.',
      },
      {
        id: 'reviewer-invite-with-decision-words',
        name: 'reviewer invite containing decision vocabulary is still ignored',
        email: {
          subject: 'Invitation to review ESJ-D-25-00777',
          body: 'We invite you to review this manuscript. A recommendation of major revision or rejection may be appropriate.',
        },
        expect: { ignore: true },
      },
      {
        id: 'your-manuscript-under-review-not-ignored',
        name: 'YOUR paper being under review must NOT be swallowed by the ignore rule',
        email: {
          subject: 'JOSR-D-25-00417 status',
          body: 'Your manuscript is under review. Reviewers have been assigned.',
        },
        expect: { ignore: false, status: 'Under Review' },
      },
    ],
  },

  // =========================================================================
  {
    title: 'TRANSFERS — tracking a paper across journals',
    cases: [
      {
        id: 'transfer-offered',
        name: 'transfer offer is a decision you must make on a deadline',
        email: {
          subject: 'Transfer your manuscript ESJ-D-25-00112',
          body: 'We are unable to publish your manuscript, but we would like to offer you the opportunity to transfer it, along with the reviewer reports, to Global Spine Journal. Please respond within 30 days.',
        },
        expect: { status: 'Transfer Offered', urgent: true },
      },
      {
        id: 'transfer-completed',
        name: 'completed transfer opens a new submission, does not reject the old one',
        email: {
          subject: 'Your manuscript has been transferred',
          body: 'Your manuscript ESJ-D-25-00112 has been transferred to Global Spine Journal and is now under consideration there as GSJ-26-1643.',
        },
        expect: { status: 'Transferred' },
      },
    ],
  },

  // =========================================================================
  {
    title: 'QUOTED HISTORY — last month\'s status must not beat this month\'s',
    cases: [
      {
        id: 'quoted-old-status',
        name: 'acceptance today, "under review" quoted below',
        email: {
          subject: 'Decision on JOSR-D-25-00417',
          body: 'I am pleased to inform you that your manuscript has been accepted for publication.\n\nOn 3 May 2025, the editorial office wrote:\n> Your manuscript is under review. Reviewers have been assigned.',
        },
        expect: { status: 'Accepted' },
      },
      {
        id: 'quoted-old-decision-in-colleague-reply',
        name: 'colleague replying under a decision subject line',
        email: {
          from: 'satish.muthu@example.edu',
          subject: 'Re: JOSR-D-25-00417 Major Revision Required',
          body: 'Dhibin, I have added the GRADE table. Please upload tonight.\n\n-----Original Message-----\nFrom: Editorial Office\nYour manuscript requires major revision.',
        },
        expect: { status: 'Major Revision Requested', urgent: true },
        note: 'Subject-line match survives quote stripping. Acceptable (status is still true) but it re-fires on every reply in the thread. Dedupe must happen in the caller, not here.',
      },
    ],
  },

  // =========================================================================
  {
    title: 'MANUSCRIPT ID extraction',
    cases: [
      {
        id: 'msid-em-subject',
        name: 'Editorial Manager format from subject',
        email: { subject: 'Decision on JOSR-D-25-00417', body: '' },
        expect: { msId: 'JOSR-D-25-00417' },
      },
      {
        id: 'msid-labelled-body',
        name: 'labelled manuscript number from body',
        email: { subject: 'A decision has been reached', body: 'Manuscript Number: ESJ-D-24-01123' },
        expect: { msId: 'ESJ-D-24-01123' },
      },
      {
        id: 'msid-scholarone',
        name: 'ScholarOne format',
        email: { subject: 'SPINE-25-0442 decision', body: '' },
        expect: { msId: 'SPINE-25-0442' },
      },
      {
        id: 'msid-revision-suffix',
        name: 'R1 suffix normalises to the base ID (a revision is the same paper)',
        email: { subject: 'Decision on JOSR-D-25-00417R1', body: '' },
        expect: { msId: 'JOSR-D-25-00417' },
      },
      {
        id: 'msid-baishideng-numeric',
        name: 'bare numeric ID, label-anchored (Baishideng / World Journal family)',
        email: { subject: 'Decision', body: 'Manuscript NO: 126786\n\nYour manuscript has been received.' },
        expect: { msId: '126786' },
        note: 'Regression: every other pattern requires the ID to start with a letter, so these fell through to "no manuscript ID".',
      },
      {
        id: 'msid-subject-beats-body',
        name: 'subject wins over body (prevents cross-contamination from forwarded threads)',
        email: { subject: 'Decision on JOSR-D-25-00417', body: 'Regarding your other paper ESJ-D-24-01123 ...' },
        expect: { msId: 'JOSR-D-25-00417' },
      },
      {
        id: 'msid-absent',
        name: 'no ID returns null rather than guessing',
        email: { subject: 'Newsletter', body: 'Read our latest issue' },
        expect: { msId: null },
      },
      {
        id: 'msid-ms-ref-no',
        name: 'Editorial Manager "Ms. Ref. No." field',
        email: { subject: 'Decision', body: 'Ms. Ref. No.: JOSR-D-25-00417\n\nYour manuscript has been accepted.' },
        expect: { msId: 'JOSR-D-25-00417' },
      },
    ],
  },

  // =========================================================================
  {
    title: 'RELEVANCE filter — dropping mail is as dangerous as misreading it',
    cases: [
      {
        id: 'relevance-call-for-papers',
        name: 'call for papers dropped',
        email: { from: 'noreply@elsevier.com', subject: 'Call for Papers: Special Issue', body: 'Submit your work. Unsubscribe here.' },
        expect: { relevant: false },
      },
      {
        id: 'relevance-toc-alert',
        name: 'table of contents alert dropped',
        email: { from: 'alerts@springer.com', subject: 'Table of Contents Alert', body: 'New issue available. Unsubscribe.' },
        expect: { relevant: false },
      },
      {
        id: 'relevance-real-decision',
        name: 'real decision email kept',
        email: { from: 'em@editorialmanager.com', subject: 'Decision on JOSR-D-25-00417', body: 'Your manuscript has been accepted.' },
        expect: { relevant: true },
      },
      {
        id: 'relevance-manuscript-number-overrides-unsubscribe',
        name: 'labelled "Manuscript Number" beats an unsubscribe footer',
        email: { from: 'x@journal.com', subject: 'Decision', body: 'Manuscript Number: JOSR-D-25-00417. Accepted. Unsubscribe here.' },
        expect: { relevant: true },
      },
      {
        id: 'relevance-ms-ref-no-overrides-unsubscribe',
        name: 'Editorial Manager "Ms. Ref. No." beats an unsubscribe footer',
        email: { from: 'em@editorialmanager.com', subject: 'Decision on your submission', body: 'Ms. Ref. No.: JOSR-D-25-00417\n\nYour manuscript has been accepted.\n\nTo stop receiving these emails, unsubscribe here.' },
        expect: { relevant: true },
      },
    ],
  },

  // =========================================================================
  {
    title: 'AMBIGUITY — refusing to answer is a valid answer',
    cases: [
      {
        id: 'ambiguous-accept-vs-reject',
        name: 'accept and reject language at similar strength refuses to guess',
        email: {
          subject: 'Decision on JOSR-D-25-00417',
          body: 'We are pleased to inform you that your manuscript has been accepted. We regret to inform you that the second submission was rejected.',
        },
        expect: { ambiguous: true },
        note: 'Contrived, but this is exactly the shape of a batched decision email covering two papers. Guessing here is the worst error the system can make.',
      },
      {
        id: 'unambiguous-single-decision',
        name: 'a clean single decision is NOT flagged ambiguous',
        email: {
          subject: 'Decision on JOSR-D-25-00417',
          body: 'I am pleased to inform you that your manuscript has been accepted for publication.',
        },
        expect: { ambiguous: false, status: 'Accepted' },
      },
    ],
  },

  // =========================================================================
  {
    title: 'JOURNAL extraction — display metadata, low stakes',
    cases: [
      {
        id: 'journal-known-wins',
        name: 'a journal you already track wins outright',
        email: { subject: 'Decision', body: 'from the European Spine Journal editorial office' },
        knownJournals: ['European Spine Journal'],
        expect: { journal: 'European Spine Journal' },
      },
      {
        id: 'journal-of-pattern',
        name: '"Journal of X" pattern',
        email: { subject: 'Decision', body: 'published in the Journal of Orthopaedic Surgery' },
        expect: { journal: 'Journal of Orthopaedic Surgery' },
      },
    ],
  },
];

/** Flat list, for counting and for `--only <id>`. */
export const ALL_CASES = GROUPS.flatMap((g) =>
  g.cases.map((c) => ({ ...c, group: g.title }))
);
