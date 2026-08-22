#!/usr/bin/env node
// ============================================================================
// get-refresh-token.mjs — one-time Gmail authorisation helper
// ============================================================================
//
// ZERO DEPENDENCIES. Uses only Node's built-in modules, so there is NOTHING to
// install — no npm, no package.json, no node_modules. If you can run `node`,
// you can run this. Copy this single file anywhere and run it.
//
//     node get-refresh-token.mjs
//
// WHO RUNS THIS: Dhibin once, the professor once, each on their own machine
// signed into their own Google account. Never on a shared computer.
//
// WHY IT MUST RUN ON *YOUR* MACHINE (and not in the cloud): Google sends the
// authorisation code back to http://localhost:5589. "localhost" means the
// computer whose browser you clicked Allow in. A cloud server has a different
// localhost, so it would never receive the code.
//
// WHY THIS IS SAFE FOR YOUR PROFESSOR TO RUN
// ------------------------------------------
//   1. The only scope requested is `gmail.readonly`, enforced by Google on
//      their side. Even a malicious version of this script could not send,
//      delete or modify a message, or touch any service other than Gmail.
//   2. No password is ever typed here. You authenticate on accounts.google.com
//      in your own browser; this script only receives the resulting token.
//   3. Revocable in one click, any time, without asking anyone:
//      myaccount.google.com → Security → Third-party apps with account access.
//
// The refresh token this prints is a credential. Treat it like a password:
// paste it straight into the GitHub secret, don't email it, don't commit it.
// ============================================================================

import http from 'node:http';
import https from 'node:https';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// Read-only. Do not widen. If a future feature looks like it needs write access
// to Gmail, it almost certainly does not — and the professor consented to read.
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// Must match the redirect URI registered on the OAuth client exactly.
const PORT = 5589;
const REDIRECT_URI = `http://localhost:${PORT}`;

const line = (c = '─') => console.log(c.repeat(74));

async function main() {
  line('═');
  console.log('  Research Tracker — Gmail authorisation');
  line('═');
  console.log(`
Grants READ-ONLY access to ONE Gmail account so the daily sync can detect
journal status emails. It cannot send, delete or modify mail.

You need the Client ID and Client Secret from the Google Cloud project
(they are in the JSON file downloaded when the OAuth client was created).
The same pair is used for BOTH inboxes — your professor does not need his
own Google Cloud project.
`);

  // ── Gather credentials ────────────────────────────────────────────────
  // Three ways in, so this never hangs waiting for input that cannot arrive:
  //   1. flags   : node get-refresh-token.mjs --client-id X --client-secret Y
  //   2. env     : GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node ...
  //   3. prompts : plain `node get-refresh-token.mjs` in a real terminal
  //
  // The interactive path REQUIRES a TTY. Node's readline silently never
  // resolves when stdin is a pipe or a redirected file, which shows up as the
  // script freezing with no error at all — so that case is detected and
  // reported instead of hanging.
  const args = parseArgs(process.argv.slice(2));

  let clientId = args['client-id'] || process.env.GMAIL_CLIENT_ID || '';
  let clientSecret = args['client-secret'] || process.env.GMAIL_CLIENT_SECRET || '';
  let rl = null;

  if (!clientId || !clientSecret) {
    if (!input.isTTY) {
      console.error(`
✖  No Client ID / Secret supplied, and stdin is not an interactive terminal
   so I cannot prompt for them.

   Pass them explicitly instead:

     node get-refresh-token.mjs --client-id "XXXX.apps.googleusercontent.com" --client-secret "GOCSPX-XXXX"

   or via environment variables:

     GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node get-refresh-token.mjs
`);
      process.exit(1);
    }
    rl = readline.createInterface({ input, output });
    if (!clientId) clientId = (await rl.question('OAuth Client ID     : ')).trim();
    if (!clientSecret) clientSecret = (await rl.question('OAuth Client Secret : ')).trim();
  }

  if (!clientId || !clientSecret) {
    console.error('\n✖  Both values are required. Re-run when you have them.');
    rl?.close();
    process.exit(1);
  }

  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPE,
      // `offline` is what makes Google issue a REFRESH token rather than a
      // one-hour access token. Without it the sync dies after 60 minutes.
      access_type: 'offline',
      // Forces the consent screen even if this account already approved.
      // Google only returns a refresh token on FIRST consent, so without this
      // a re-run silently yields nothing — a genuinely confusing failure.
      prompt: 'consent',
    }).toString();

  console.log('\n');
  line();
  console.log('  OPEN THIS URL IN A BROWSER SIGNED IN AS THE ACCOUNT TO SYNC:');
  line();
  console.log(`\n${authUrl}\n`);
  line();
  console.log(`  Waiting for Google to redirect to ${REDIRECT_URI} …`);
  console.log('');
  console.log('  Expect a screen saying "Google hasn\'t verified this app".');
  console.log('  That is normal for a private app that was never submitted for');
  console.log('  public review. Click  Advanced  →  Go to Research Tracker.');
  line();

  let code;
  try {
    code = await waitForCode();
  } catch (err) {
    // Fallback: if the local listener could not start (port in use, firewall,
    // locked-down machine), the code is still visible in the browser's address
    // bar after the redirect fails. Paste it manually.
    console.log(`\n⚠  Could not capture the redirect automatically (${err.message}).`);
    console.log('   Your browser will show an error page — that is fine. Look at its');
    console.log('   address bar: it contains  ?code=SOMETHING&scope=...');
    if (!rl) {
      if (!input.isTTY) {
        console.error('\n✖  Cannot prompt for the code (stdin is not a terminal).');
        console.error('   Re-run in an interactive terminal, or free up port ' + PORT + '.');
        process.exit(1);
      }
      rl = readline.createInterface({ input, output });
    }
    code = (await rl.question('\n   Paste just the code value here: ')).trim();
  }

  if (!code) {
    console.error('\n✖  No authorisation code received.');
    rl?.close();
    process.exit(1);
  }

  console.log('\n  Exchanging the code for a refresh token …');

  let tokens;
  try {
    tokens = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });
  } catch (err) {
    console.error(`\n✖  Token exchange failed: ${err.message}`);
    console.error('\n   Most common causes:');
    console.error('     · the redirect URI on the OAuth client is not exactly');
    console.error(`       ${REDIRECT_URI}`);
    console.error('     · the Client ID and Secret are from different clients');
    console.error('     · the code was already used (they are single-use — re-run)');
    rl?.close();
    process.exit(1);
  }

  if (!tokens.refresh_token) {
    console.error(`
✖  Google returned an access token but NO refresh token.

   This happens when the account has already authorised this app before.
   Fix: revoke it at myaccount.google.com → Security → Third-party apps
   with account access, then run this script again.
`);
    rl?.close();
    process.exit(1);
  }

  // Confirm WHOSE mailbox was authorised. This catches the single most common
  // mistake in this whole setup: being signed into the wrong Google account in
  // the browser and quietly authorising the wrong inbox.
  let whoami = '(could not read address)';
  try {
    const prof = await getJson(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      tokens.access_token
    );
    whoami = prof.emailAddress || whoami;
  } catch { /* non-fatal — the token is still valid */ }

  console.log('\n');
  line('═');
  console.log('  ✔  SUCCESS');
  line('═');
  console.log(`\n  Authorised mailbox : ${whoami}`);
  console.log('\n  REFRESH TOKEN — copy the whole line:\n');
  console.log(`  ${tokens.refresh_token}\n`);
  line();
  console.log(`
  Store it as a GitHub repository secret:

    • if this is DHIBIN's inbox    →  GMAIL_REFRESH_TOKEN_A
    • if this is the PROFESSOR's   →  GMAIL_REFRESH_TOKEN_B

  Repo → Settings → Secrets and variables → Actions → New repository secret

  Treat this like a password: do not commit it, email it, or paste it into a
  chat. If it ever leaks, revoke at myaccount.google.com → Security.
`);
  line();
  rl?.close();
}

/**
 * Spin up a throwaway local server to catch Google's redirect, so nobody has
 * to hand-copy a code out of the address bar.
 */
function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8">
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#16202e;display:grid;place-items:center;height:100vh;margin:0">
  <div style="text-align:center;max-width:32rem;padding:2rem;background:#fff;border:1px solid #e2e6ec;border-radius:14px">
    <h1 style="color:${error ? '#8a1818' : '#12a012'};font-size:1.3rem;margin:0 0 .6rem">
      ${error ? 'Authorisation failed' : 'Authorised'}
    </h1>
    <p style="color:#4a5568;margin:0">${error ? escapeHtml(error) : 'You can close this tab and return to the terminal.'}</p>
  </div>
</body>`);

      server.close();
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error('no code in redirect'));
    });

    server.on('error', reject);
    server.listen(PORT);
    // Don't hang forever if the user wanders off mid-flow.
    setTimeout(() => { server.close(); reject(new Error('timed out after 5 minutes')); }, 5 * 60 * 1000);
  });
}

/** POST application/x-www-form-urlencoded, parse JSON, using only node:https. */
function postForm(url, fields) {
  const body = new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); }
          catch { return reject(new Error(`bad response (HTTP ${res.statusCode}): ${data.slice(0, 200)}`)); }
          if (res.statusCode >= 400) {
            return reject(new Error(`${parsed.error || res.statusCode}: ${parsed.error_description || data.slice(0, 200)}`));
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** GET JSON with a bearer token, using only node:https. */
function getJson(url, accessToken) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Authorization: `Bearer ${accessToken}` } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

/** Minimal --flag value parser. No dependency, no surprises. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch((err) => {
  console.error('\n✖  Failed:', err.message);
  process.exit(1);
});
