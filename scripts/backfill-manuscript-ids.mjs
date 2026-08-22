#!/usr/bin/env node
// ============================================================================
// backfill-manuscript-ids.mjs — bootstrap the matching keys
// ============================================================================
//
// THE PROBLEM THIS SOLVES
// -----------------------
// The daily sync matches emails to papers by manuscript ID and refuses to
// guess by title. That is the right call — but it means that on day one,
// when no paper has a manuscriptId, NOTHING matches and every email lands in
// the unmatched queue.
//
// This script bootstraps you out of that. It reads a longer stretch of Gmail
// history (a year by default), groups every editorial email by manuscript ID,
// and shows you what it found alongside your existing papers so you can wire
// the two together.
//
// IT WRITES NOTHING BY DEFAULT. It prints a report and, with --write, applies
// only the mappings you have explicitly confirmed in a mapping file. Automatic
// title matching is deliberately absent here too — this is a one-time setup
// step, and ten minutes of your attention now prevents months of silently
// wrong data later.
//
// USAGE
//   node scripts/backfill-manuscript-ids.mjs                 # report only
//   node scripts/backfill-manuscript-ids.mjs --months 24     # look further back
//   node scripts/backfill-manuscript-ids.mjs --write mapping.json
//
// mapping.json format — paper `id` from the tracker to manuscript ID(s):
//   { "1": "JOSR-D-25-00417", "2": ["ESJ-D-24-01123", "ESJ-D-25-00088"] }
// ============================================================================

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { makeGmailClient, fetchMessages, gmailLink, getAccountEmail } from './lib/gmail.mjs';
import { extractManuscriptId, extractJournal, classifyStatus, isRelevant, normaliseId } from './lib/classify.mjs';

const args = process.argv.slice(2);
const MONTHS = Number(getArg('--months') || 12);
const WRITE_FILE = getArg('--write');

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

async function main() {
  console.log('═'.repeat(74));
  console.log('  MANUSCRIPT ID BACKFILL');
  console.log('═'.repeat(74));
  console.log(`  looking back : ${MONTHS} months`);
  console.log(`  mode         : ${WRITE_FILE ? `WRITE from ${WRITE_FILE}` : 'REPORT ONLY (no writes)'}`);
  console.log('─'.repeat(74));

  const db = initFirestore();
  const papersSnap = await db.collection('papers').get();
  const papers = papersSnap.docs.map((d) => ({ firestoreId: d.id, ...d.data() }));

  // ---- Write mode: apply a mapping you have already reviewed -------------
  if (WRITE_FILE) {
    const mapping = JSON.parse(readFileSync(WRITE_FILE, 'utf8'));
    let applied = 0;

    for (const [paperId, value] of Object.entries(mapping)) {
      const paper = papers.find((p) => String(p.id) === String(paperId) || p.firestoreId === paperId);
      if (!paper) {
        console.log(`  ⚠ no paper with id "${paperId}" — skipped`);
        continue;
      }
      const ids = (Array.isArray(value) ? value : [value]).map(normaliseId).filter(Boolean);
      if (!ids.length) continue;

      await db.collection('papers').doc(paper.firestoreId).update({
        manuscriptId: ids[0],
        manuscriptIdAliases: ids.slice(1),
      });
      console.log(`  ✔ #${paper.id} ← ${ids.join(', ')}   "${truncate(paper.title, 45)}"`);
      applied++;
    }

    console.log(`\n  Applied ${applied} mapping(s). The daily sync can now match these papers.`);
    return;
  }

  // ---- Report mode -------------------------------------------------------
  const clientId = requireEnv('GMAIL_CLIENT_ID');
  const clientSecret = requireEnv('GMAIL_CLIENT_SECRET');

  // See the matching comment in sync-journal-emails.mjs — `slot` is the
  // Gmail account-switcher index (/u/<n>/) this address occupies in the
  // browser that opens these links; set it if links open slowly.
  const accounts = [
    { key: 'A', label: 'Dhibin', refreshToken: process.env.GMAIL_REFRESH_TOKEN_A, slot: 0 },
    { key: 'B', label: 'Professor', refreshToken: process.env.GMAIL_REFRESH_TOKEN_B, slot: 0 },
  ].filter((a) => a.refreshToken);

  if (!accounts.length) throw new Error('No Gmail refresh tokens configured');

  // manuscriptId -> everything we learned about it
  const discovered = new Map();

  for (const account of accounts) {
    console.log(`\n  Scanning ${account.label}'s inbox …`);
    const gmail = makeGmailClient({ clientId, clientSecret, refreshToken: account.refreshToken });
    const accountEmail = await getAccountEmail(gmail);

    const query = [
      `newer_than:${MONTHS * 30}d`,
      '-in:spam',
      '(manuscript OR submission OR "peer review" OR "editorial office" OR decision OR revision OR proof)',
    ].join(' ');

    const messages = await fetchMessages(gmail, query, 400);
    console.log(`    ${messages.length} candidate messages from ${accountEmail}`);

    for (const msg of messages) {
      if (!isRelevant(msg).relevant) continue;
      const verdict = classifyStatus(msg);
      if (verdict.ignore) continue; // reviewer invitations — other people's papers

      const hit = extractManuscriptId(msg.subject, msg.body);
      if (!hit) continue;

      if (!discovered.has(hit.id)) {
        discovered.set(hit.id, {
          id: hit.id, count: 0, journals: new Set(), accounts: new Set(),
          subjects: [], firstSeen: msg.receivedAt, lastSeen: msg.receivedAt,
          latestStatus: null, latestStatusAt: null, link: gmailLink(msg.id, accountEmail, { inInbox: (msg.labelIds || []).includes('INBOX'), slot: account.slot }),
        });
      }
      const rec = discovered.get(hit.id);
      rec.count++;
      rec.accounts.add(account.label);
      const j = extractJournal(msg, []);
      if (j) rec.journals.add(j);
      if (rec.subjects.length < 4) rec.subjects.push(truncate(msg.subject, 78));
      if (msg.receivedAt < rec.firstSeen) rec.firstSeen = msg.receivedAt;
      if (msg.receivedAt > rec.lastSeen) {
        rec.lastSeen = msg.receivedAt;
        rec.link = gmailLink(msg.id, accountEmail, { inInbox: (msg.labelIds || []).includes('INBOX'), slot: account.slot });
      }
      // Track the most recent readable status — a strong hint at where the
      // manuscript actually stands right now.
      if (verdict.status && (!rec.latestStatusAt || msg.receivedAt >= rec.latestStatusAt)) {
        rec.latestStatus = verdict.status;
        rec.latestStatusAt = msg.receivedAt;
      }
    }
  }

  // ---- Present findings --------------------------------------------------
  const found = [...discovered.values()].sort((a, b) => b.lastSeen - a.lastSeen);

  console.log(`\n${'═'.repeat(74)}`);
  console.log(`  FOUND ${found.length} DISTINCT MANUSCRIPT ID(S)`);
  console.log('═'.repeat(74));

  for (const r of found) {
    console.log(`\n  ${r.id}`);
    console.log(`    emails       : ${r.count}   inbox: ${[...r.accounts].join(' + ')}`);
    if (r.journals.size) console.log(`    journal      : ${[...r.journals].join(' / ')}`);
    console.log(`    active       : ${fmt(r.firstSeen)} → ${fmt(r.lastSeen)}`);
    if (r.latestStatus) console.log(`    latest status: ${r.latestStatus}`);
    console.log(`    subjects     :`);
    for (const s of r.subjects) console.log(`       · ${s}`);
    console.log(`    open         : ${r.link}`);
  }

  console.log(`\n${'═'.repeat(74)}`);
  console.log(`  YOUR ${papers.length} TRACKED PAPER(S)`);
  console.log('═'.repeat(74));
  for (const p of papers) {
    const has = p.manuscriptId ? `  [mapped → ${p.manuscriptId}]` : '  [UNMAPPED]';
    console.log(`\n  #${p.id}${has}`);
    console.log(`    ${truncate(p.title, 68)}`);
    console.log(`    current status: ${p.status || '(none)'}`);
  }

  // ---- Emit a starter mapping file --------------------------------------
  const unmapped = papers.filter((p) => !p.manuscriptId);
  console.log(`\n${'═'.repeat(74)}`);
  console.log('  NEXT STEP');
  console.log('═'.repeat(74));
  console.log(`
  Match each paper above to its manuscript ID by eye — you know which paper
  went to which journal, and the subjects printed above will make it obvious.

  Save a file called mapping.json:

  {`);
  for (const p of unmapped.slice(0, 8)) {
    console.log(`    "${p.id}": "PASTE-MANUSCRIPT-ID-HERE",   // ${truncate(p.title, 42)}`);
  }
  console.log(`  }

  A paper that moved between journals (or was resubmitted) can take a list:
    "3": ["ESJ-D-24-01123", "JOSR-D-25-00417"]

  Then apply it:
    node scripts/backfill-manuscript-ids.mjs --write mapping.json

  Papers you leave unmapped are simply never auto-updated — their journal
  emails go to the Needs Attention queue instead. Nothing breaks.
`);
}

function initFirestore() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  let creds;
  try { creds = JSON.parse(raw); }
  catch { creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
  initializeApp({ credential: cert(creds) });
  return getFirestore();
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function truncate(s, n) {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function fmt(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
}

main().catch((err) => {
  console.error('\n✖ FAILED:', err.message);
  process.exit(1);
});
