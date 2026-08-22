// ============================================================================
// gmail.mjs — read one Gmail account via the Gmail API
// ============================================================================
//
// This is where "syncing two inboxes" actually happens — and note that it does
// NOT happen. There is no merging, forwarding, or importing. Each account is
// read independently with its own token, and both result sets flow into the
// same Firestore database. The inboxes stay completely untouched and separate.
// Consolidation is a property of the DATA, not of the email accounts.
// ============================================================================

import { google } from 'googleapis';

/**
 * Build an authenticated Gmail client from a stored refresh token.
 * The googleapis library exchanges the refresh token for a short-lived access
 * token automatically, so nothing here needs to manage expiry.
 */
export function makeGmailClient({ clientId, clientSecret, refreshToken }) {
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
}

/**
 * Fetch messages matching a Gmail search query.
 *
 * We use Gmail's own query language to do the coarse filtering server-side.
 * That keeps us far below API quota and means we download tens of messages a
 * day, not thousands.
 *
 * @param {object} gmail       authenticated client
 * @param {string} query       Gmail search syntax, e.g. 'newer_than:3d'
 * @param {number} maxResults  hard ceiling on messages fetched
 */
export async function fetchMessages(gmail, query, maxResults = 120) {
  const ids = [];
  let pageToken;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(100, maxResults - ids.length),
      pageToken,
    });
    for (const m of res.data.messages || []) ids.push(m.id);
    pageToken = res.data.nextPageToken;
  } while (pageToken && ids.length < maxResults);

  const out = [];
  for (const id of ids) {
    try {
      const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      out.push(parseMessage(res.data));
    } catch (err) {
      // One unreadable message must never abort the whole run.
      console.warn(`  ⚠ could not fetch message ${id}: ${err.message}`);
    }
  }
  return out;
}

/** Flatten Gmail's nested MIME payload into a plain object. */
function parseMessage(msg) {
  const headers = {};
  for (const h of msg.payload?.headers || []) {
    headers[h.name.toLowerCase()] = h.value;
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    subject: headers.subject || '',
    from: headers.from || '',
    to: headers.to || '',
    date: headers.date || '',
    // internalDate is Gmail's own receipt timestamp — reliable, unlike the
    // Date: header which senders can set to anything.
    receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
    body: extractBody(msg.payload),
    snippet: msg.snippet || '',
    // Used only to pick a faster deep-link format (#inbox/ vs #all/) — see
    // gmailLink() below. Not persisted to Firestore.
    labelIds: msg.labelIds || [],
  };
}

/**
 * Walk the MIME tree for readable text.
 *
 * Preference order is deliberate: text/plain first (clean, no markup noise for
 * the regex classifier), falling back to a crude HTML strip. Many editorial
 * systems send HTML only.
 */
function extractBody(payload) {
  if (!payload) return '';

  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.body?.data) {
      parts.push({
        mime: node.mimeType || '',
        text: Buffer.from(node.body.data, 'base64').toString('utf8'),
      });
    }
    for (const child of node.parts || []) walk(child);
  };
  walk(payload);

  const plain = parts.filter((p) => p.mime === 'text/plain').map((p) => p.text).join('\n');
  if (plain.trim()) return plain;

  const html = parts.filter((p) => p.mime === 'text/html').map((p) => p.text).join('\n');
  return html ? htmlToText(html) : '';
}

/**
 * Minimal HTML-to-text. Not a general-purpose converter — it only needs to be
 * good enough that regexes match sentences that were split across tags.
 */
function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A permanent, clickable link back to the source message.
 *
 * This is what makes autonomous updating acceptable: every status on the
 * dashboard carries a link to the exact email that caused it, so a wrong call
 * takes seconds to verify rather than an archaeology session in Gmail.
 *
 * Two things make this link slow if got wrong, and both are addressed here:
 *
 *   1. ACCOUNT SLOT. Gmail's URL scheme needs a /u/<n>/ index matching which
 *      signed-in account slot this address occupies IN THIS BROWSER — that is
 *      purely local browser state, not something the Gmail API can report.
 *      Guessing 0 and letting `authuser=` redirect you to the right slot
 *      works, but the redirect itself costs real time — worse the more
 *      accounts are signed in. Pass `slot` once you know the right number for
 *      a given browser (see ACCOUNTS in sync-journal-emails.mjs) to skip that
 *      redirect entirely; 0 remains the default so this is opt-in.
 *   2. MAILBOX SCOPE. `#all/<id>` resolves against All Mail — Gmail's entire
 *      archive, which can be large after years of correspondence. `#inbox/<id>`
 *      resolves against just the inbox, which is dramatically smaller and
 *      faster whenever the message is still there (true for nearly all
 *      journal correspondence, since these are rarely archived). Pass
 *      `inInbox: true` when the fetched message's labelIds include INBOX; it
 *      falls back to `#all/` — slower, but correct — for anything archived.
 */
export function gmailLink(messageId, accountEmail, { inInbox = false, slot = 0 } = {}) {
  const view = inInbox ? 'inbox' : 'all';
  return `https://mail.google.com/mail/u/${slot}/#${view}/${messageId}${accountEmail ? `?authuser=${encodeURIComponent(accountEmail)}` : ''}`;
}

/** Which mailbox are we actually reading? Used for logging and provenance. */
export async function getAccountEmail(gmail) {
  const res = await gmail.users.getProfile({ userId: 'me' });
  return res.data.emailAddress;
}
