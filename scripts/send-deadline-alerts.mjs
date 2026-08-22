#!/usr/bin/env node
// ============================================================================
// send-deadline-alerts.mjs — warn before a revision window closes
// ============================================================================
//
// Runs daily, after the sync. Looks at every paper carrying a deadline and
// emails a warning at 14, 7, 3, 1 and 0 days out, plus once when overdue.
//
// WHY AN ESCALATING LADDER RATHER THAN ONE REMINDER
// -------------------------------------------------
// A single alert 7 days out arrives during a posting, gets archived, and is
// gone. The ladder means the warning gets louder as the cost of missing it
// rises, and the final 48-hour alert is impossible to mistake for routine mail.
//
// EACH MILESTONE FIRES ONCE. `deadlineAlertsSent` on the paper records which
// rungs have gone out, so a daily cron does not send the same warning every
// morning for two weeks — the fastest way to train yourself to ignore it.
//
// Sends via Gmail SMTP using an APP PASSWORD, which is separate from the
// read-only OAuth token used for reading. Reading and sending are deliberately
// different credentials: the sync literally cannot send mail, and this mailer
// literally cannot read your inbox.
//
// USAGE
//   node scripts/send-deadline-alerts.mjs
//   node scripts/send-deadline-alerts.mjs --dry-run
// ============================================================================

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import { alertsDue, urgencyOf } from './lib/deadlines.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

const URGENCY_STYLE = {
  overdue:  { label: 'OVERDUE',   colour: '#ff4d4d', prefix: '🔴 OVERDUE' },
  critical: { label: 'CRITICAL',  colour: '#ff6b35', prefix: '🟠 URGENT' },
  urgent:   { label: 'URGENT',    colour: '#ffa500', prefix: '🟡' },
  soon:     { label: 'UPCOMING',  colour: '#ffd93d', prefix: '🔵' },
  ok:       { label: 'SCHEDULED', colour: '#00f2ff', prefix: '🔵' },
};

async function main() {
  console.log('═'.repeat(70));
  console.log('  DEADLINE ALERTS');
  console.log('═'.repeat(70));
  console.log(`  mode: ${DRY_RUN ? 'DRY RUN (no mail sent)' : 'LIVE'}`);

  const db = initFirestore();
  const recipients = (process.env.ALERT_RECIPIENTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  if (!recipients.length) throw new Error('ALERT_RECIPIENTS is not set (comma-separated emails)');
  console.log(`  recipients: ${recipients.join(', ')}\n`);

  const snap = await db.collection('papers').get();
  const papers = snap.docs.map((d) => ({ firestoreId: d.id, ...d.data() }));

  const now = new Date();
  const toAlert = [];

  for (const p of papers) {
    if (!p.deadline) continue;
    const deadlineDate = p.deadline.toDate ? p.deadline.toDate() : new Date(p.deadline);
    const verdict = alertsDue({ deadline: deadlineDate, deadlineAlertsSent: p.deadlineAlertsSent }, now);
    if (verdict.due) {
      toAlert.push({ paper: p, deadlineDate, ...verdict, urgency: urgencyOf(verdict.daysLeft) });
    }
  }

  // Most urgent first — if the mail is skimmed, the worst item is at the top.
  toAlert.sort((a, b) => a.daysLeft - b.daysLeft);

  console.log(`  papers with deadlines : ${papers.filter((p) => p.deadline).length}`);
  console.log(`  alerts due now        : ${toAlert.length}\n`);

  if (!toAlert.length) {
    console.log('  Nothing due. No mail sent.');
    return;
  }

  for (const a of toAlert) {
    const when = a.overdue ? `${Math.abs(a.daysLeft)}d OVERDUE` : `${a.daysLeft}d left`;
    console.log(`  ${URGENCY_STYLE[a.urgency].prefix}  #${a.paper.id} ${when} — ${truncate(a.paper.title, 45)}`);
  }

  if (DRY_RUN) {
    console.log('\n  Dry run — no mail sent, no milestones recorded.');
    return;
  }

  const transporter = makeTransport();
  const subject = buildSubject(toAlert);
  await transporter.sendMail({
    from: `"Research Tracker" <${process.env.ALERT_SMTP_USER}>`,
    to: recipients.join(', '),
    subject,
    text: buildTextBody(toAlert),
    html: buildHtmlBody(toAlert),
  });
  console.log(`\n  ✔ Sent: "${subject}"`);

  // Record milestones only AFTER a successful send. If the mail fails, the
  // milestone stays unsent and tomorrow's run retries — a missed deadline is
  // far worse than a duplicate warning.
  for (const a of toAlert) {
    await db.collection('papers').doc(a.paper.firestoreId).update({
      deadlineAlertsSent: FieldValue.arrayUnion(a.milestone),
      lastAlertAt: Timestamp.now(),
    });
  }
  console.log('  ✔ Milestones recorded.');
}

function buildSubject(alerts) {
  const worst = alerts[0];
  if (worst.overdue) return `🔴 OVERDUE: ${alerts.length} research deadline${alerts.length > 1 ? 's' : ''} need action`;
  if (worst.daysLeft <= 1) return `🟠 DUE ${worst.daysLeft === 0 ? 'TODAY' : 'TOMORROW'}: ${truncate(worst.paper.title, 45)}`;
  if (worst.daysLeft <= 3) return `🟠 ${worst.daysLeft} days left: ${truncate(worst.paper.title, 45)}`;
  return `🔵 ${alerts.length} upcoming research deadline${alerts.length > 1 ? 's' : ''}`;
}

function buildTextBody(alerts) {
  const lines = ['RESEARCH TRACKER — DEADLINE ALERT', '='.repeat(50), ''];
  for (const a of alerts) {
    const p = a.paper;
    lines.push(
      a.overdue ? `!! OVERDUE BY ${Math.abs(a.daysLeft)} DAY(S)` : `>> ${a.daysLeft} DAY(S) LEFT`,
      `   ${p.title}`,
      `   Journal   : ${p.journal || '—'}`,
      `   Status    : ${p.status || '—'}`,
      `   Manuscript: ${p.manuscriptId || '—'}`,
      `   Due       : ${fmtDate(a.deadlineDate)}`,
    );
    if (p.deadlineSource?.raw) lines.push(`   Basis     : "${p.deadlineSource.raw}"`);
    if (p.lastEmailLink) lines.push(`   Email     : ${p.lastEmailLink}`);
    lines.push('');
  }
  lines.push('='.repeat(50), 'Dashboard: https://dhibin-vikash.github.io/research-tracker/');
  return lines.join('\n');
}

function buildHtmlBody(alerts) {
  const cards = alerts.map((a) => {
    const p = a.paper;
    const s = URGENCY_STYLE[a.urgency];
    const countdown = a.overdue
      ? `OVERDUE BY ${Math.abs(a.daysLeft)} DAY${Math.abs(a.daysLeft) === 1 ? '' : 'S'}`
      : a.daysLeft === 0 ? 'DUE TODAY'
      : `${a.daysLeft} DAY${a.daysLeft === 1 ? '' : 'S'} LEFT`;

    return `
    <tr><td style="padding:0 0 16px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111827;border-left:4px solid ${s.colour};border-radius:8px">
        <tr><td style="padding:20px">
          <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.12em;color:${s.colour};margin-bottom:10px">
            ${escapeHtml(countdown)}
          </div>
          <div style="font:600 16px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#f1f5f9;margin-bottom:14px">
            ${escapeHtml(p.title || '(untitled)')}
          </div>
          <table cellpadding="0" cellspacing="0" style="font:400 13px/1.9 -apple-system,Segoe UI,Roboto,sans-serif;color:#94a3b8">
            ${row('Journal', p.journal)}
            ${row('Status', p.status)}
            ${row('Manuscript', p.manuscriptId)}
            ${row('Due', fmtDate(a.deadlineDate))}
            ${p.deadlineSource?.raw ? row('Basis', `"${p.deadlineSource.raw}"`) : ''}
          </table>
          ${p.lastEmailLink ? `<div style="margin-top:14px">
            <a href="${escapeHtml(p.lastEmailLink)}" style="display:inline-block;background:${s.colour};color:#0b1020;font:700 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;padding:10px 16px;border-radius:6px;text-decoration:none">
              OPEN SOURCE EMAIL →
            </a></div>` : ''}
        </td></tr>
      </table>
    </td></tr>`;
  }).join('');

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0b1020">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto">
      <tr><td style="padding-bottom:22px;border-bottom:1px solid #1f2937">
        <div style="font:800 20px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#00f2ff;letter-spacing:.04em">RESEARCH TRACKER</div>
        <div style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#64748b;margin-top:6px">
          ${alerts.length} deadline${alerts.length > 1 ? 's' : ''} require attention
        </div>
      </td></tr>
      <tr><td style="padding-top:22px">
        <table width="100%" cellpadding="0" cellspacing="0">${cards}</table>
      </td></tr>
      <tr><td style="padding-top:10px;border-top:1px solid #1f2937">
        <a href="https://dhibin-vikash.github.io/research-tracker/" style="font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#00f2ff;text-decoration:none">Open the dashboard →</a>
        <div style="font:400 11px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#475569;margin-top:12px">
          Automated from journal correspondence. Each deadline links to the email it came from — verify before acting.
        </div>
      </td></tr>
    </table></body></html>`;
}

function row(label, value) {
  if (!value) return '';
  return `<tr><td style="color:#64748b;padding-right:14px;white-space:nowrap">${escapeHtml(label)}</td><td style="color:#cbd5e1">${escapeHtml(String(value))}</td></tr>`;
}

function makeTransport() {
  const user = process.env.ALERT_SMTP_USER;
  const pass = process.env.ALERT_SMTP_PASS;
  if (!user || !pass) {
    throw new Error('ALERT_SMTP_USER / ALERT_SMTP_PASS not set (use a Gmail App Password, not your login password)');
  }
  return nodemailer.createTransport({
    host: process.env.ALERT_SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.ALERT_SMTP_PORT || 465),
    secure: true,
    auth: { user, pass },
  });
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

function fmtDate(d) {
  return d.toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

function truncate(s, n) {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch((err) => {
  console.error('\n✖ FAILED:', err.message);
  process.exit(1);
});
