#!/usr/bin/env node
// ============================================================================
// test-classifier.mjs — runs the regression corpus against the classifier
// ============================================================================
//
//   node scripts/test-classifier.mjs              run everything
//   node scripts/test-classifier.mjs --only <id>  run one case, verbosely
//   node scripts/test-classifier.mjs --verbose    show evidence for every case
//   node scripts/test-classifier.mjs --known      list documented bugs and exit
//
// EXIT CODES
//   0  all real assertions passed (documented bugs may still be failing)
//   1  a real assertion failed — do NOT run the sync live
//
// A case marked `known` in fixtures.mjs is an expected failure tied to a
// documented bug. It is reported but does not fail the build, so the corpus can
// describe reality before the fix lands. When such a case starts passing the
// runner reports XPASS loudly — that is your signal to delete the `known` field
// so the case becomes load-bearing.
// ============================================================================

import {
  classifyStatus,
  extractManuscriptId,
  isRelevant,
  extractJournal,
} from './lib/classify.mjs';
import { GROUPS, ALL_CASES } from './lib/fixtures.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };

const ONLY = arg('--only');
const VERBOSE = flag('--verbose');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};

// ---------------------------------------------------------------------------
// --known: list documented bugs without running anything
// ---------------------------------------------------------------------------
if (flag('--known')) {
  const known = ALL_CASES.filter((c) => c.known);
  console.log(`\n${C.yellow}${known.length} documented bug${known.length === 1 ? '' : 's'}:${C.reset}\n`);
  for (const c of known) console.log(`  ${C.bold}${c.id}${C.reset}\n    ${c.known}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Run one fixture. Only asserts the keys present in `expect`.
// ---------------------------------------------------------------------------
function runCase(tc) {
  const email = tc.email;
  const want = tc.expect || {};
  const got = {};
  const diffs = [];

  // Each probe is computed only if asserted, so an unrelated crash in one
  // extractor cannot mask an assertion about another.
  if ('relevant' in want) got.relevant = isRelevant(email).relevant;
  if ('msId' in want) got.msId = extractManuscriptId(email.subject || '', email.body || '')?.id ?? null;
  if ('journal' in want) got.journal = extractJournal(email, tc.knownJournals || []);

  const needsClassify = ['status', 'urgent', 'ignore', 'ambiguous'].some((k) => k in want);
  let result = null;
  if (needsClassify) {
    result = classifyStatus(email);
    if ('status' in want) got.status = result.status;
    if ('urgent' in want) got.urgent = !!result.urgent;
    if ('ignore' in want) got.ignore = !!result.ignore;
    if ('ambiguous' in want) got.ambiguous = !!result.ambiguous;
  }

  for (const k of Object.keys(want)) {
    if (got[k] !== want[k]) {
      diffs.push({ field: k, want: want[k], got: got[k] });
    }
  }

  return { ok: diffs.length === 0, diffs, result, got };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const tally = { pass: 0, fail: 0, xfail: 0, xpass: 0 };
const failures = [];
const xpasses = [];

console.log(`\n${C.bold}Regression corpus${C.reset} ${C.dim}${ALL_CASES.length} cases${C.reset}`);

for (const group of GROUPS) {
  const cases = ONLY ? group.cases.filter((c) => c.id === ONLY) : group.cases;
  if (!cases.length) continue;

  console.log(`\n${C.cyan}${'─'.repeat(74)}\n ${group.title}\n${'─'.repeat(74)}${C.reset}`);

  for (const tc of cases) {
    const { ok, diffs, result, got } = runCase(tc);

    if (tc.known) {
      if (ok) {
        tally.xpass++;
        xpasses.push(tc);
        console.log(`  ${C.magenta}XPASS${C.reset} ${tc.name}`);
        console.log(`        ${C.magenta}bug appears fixed — delete the \`known\` field on ${tc.id}${C.reset}`);
      } else {
        tally.xfail++;
        console.log(`  ${C.yellow}known${C.reset} ${C.dim}${tc.name}${C.reset}`);
        for (const d of diffs) {
          console.log(`        ${C.dim}${d.field}: want ${fmt(d.want)}, got ${fmt(d.got)}${C.reset}`);
        }
      }
    } else if (ok) {
      tally.pass++;
      console.log(`  ${C.green}✔${C.reset} ${tc.name}`);
    } else {
      tally.fail++;
      failures.push({ tc, diffs, result });
      console.log(`  ${C.red}✖${C.reset} ${C.bold}${tc.name}${C.reset}  ${C.dim}[${tc.id}]${C.reset}`);
      for (const d of diffs) {
        console.log(`        ${d.field}: want ${C.green}${fmt(d.want)}${C.reset}, got ${C.red}${fmt(d.got)}${C.reset}`);
      }
      if (result?.evidence) console.log(`        ${C.dim}evidence: ${result.evidence}${C.reset}`);
      if (result?.competing?.length) {
        console.log(`        ${C.dim}competing: ${result.competing.map((c) => `${c.status}(${c.score})`).join('  ')}${C.reset}`);
      }
    }

    if (VERBOSE || ONLY) {
      if (result) {
        console.log(`        ${C.dim}→ status=${fmt(result.status)} conf=${result.confidence} ` +
                    `urgent=${!!result.urgent} ignore=${!!result.ignore} ambiguous=${!!result.ambiguous}${C.reset}`);
        if (result.evidence) console.log(`        ${C.dim}→ evidence: ${result.evidence}${C.reset}`);
      }
      if (tc.note) console.log(`        ${C.dim}note: ${tc.note}${C.reset}`);
    }
  }
}

function fmt(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  return typeof v === 'string' ? `"${v}"` : String(v);
}

// ---------------------------------------------------------------------------
console.log(`\n${'═'.repeat(74)}`);
const bits = [
  `${C.green}${tally.pass} passed${C.reset}`,
  tally.fail ? `${C.red}${tally.fail} failed${C.reset}` : `${C.dim}0 failed${C.reset}`,
];
if (tally.xfail) bits.push(`${C.yellow}${tally.xfail} known bug${tally.xfail === 1 ? '' : 's'}${C.reset}`);
if (tally.xpass) bits.push(`${C.magenta}${tally.xpass} XPASS${C.reset}`);
console.log('  ' + bits.join('   '));
console.log('═'.repeat(74));

if (tally.xfail) {
  console.log(`\n${C.yellow}Documented bugs still open${C.reset} ${C.dim}(run --known for detail)${C.reset}`);
  for (const c of ALL_CASES.filter((c) => c.known)) {
    const first = c.known.split(':')[0];
    console.log(`  ${C.dim}·${C.reset} ${first} — ${c.id}`);
  }
}

if (tally.xpass) {
  console.log(`\n${C.magenta}${tally.xpass} case(s) now pass that were marked as known bugs.${C.reset}`);
  console.log(`${C.dim}Remove the \`known\` field so they become load-bearing:${C.reset}`);
  for (const c of xpasses) console.log(`  · ${c.id}`);
}

if (tally.fail) {
  console.log(`\n${C.red}${C.bold}Regressions:${C.reset}`);
  for (const f of failures) {
    console.log(`  · ${f.tc.id} — ${f.tc.name}`);
    for (const d of f.diffs) console.log(`      ${d.field}: want ${fmt(d.want)} / got ${fmt(d.got)}`);
  }
  console.log(`\n${C.red}Do NOT run the sync live until these pass.${C.reset}\n`);
  process.exit(1);
}

console.log(`\n${C.green}No regressions.${C.reset}` +
            (tally.xfail ? ` ${C.dim}${tally.xfail} known bug(s) outstanding.${C.reset}\n` : '\n'));
