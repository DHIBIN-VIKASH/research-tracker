// ============================================================================
// Research Tracker — dashboard
// ============================================================================
//
// Design intent, so future edits do not undo it:
//
//   1. THE DASHBOARD ANSWERS ONE QUESTION FIRST — "what needs me today?"
//      Deadlines and unresolved items sit ABOVE the paper list, because a
//      tracker that requires scrolling to find an expiring revision window has
//      failed at its only real job.
//
//   2. ONE MANUSCRIPT, ONE TIMELINE — ACROSS JOURNALS.
//      A paper rejected by journal A and resubmitted to journal B is the same
//      piece of work. Its history does not restart; it continues, split into
//      numbered SUBMISSION ROUNDS. Seeing "rejected at ESJ after 4 months, now
//      under review at ASJ" as one story is the thing that is impossible to
//      hold in your head across a dozen manuscripts.
//
//   3. EVERY AUTOMATED STATUS IS TRACEABLE. Each timeline entry links to the
//      Gmail message that produced it. Autonomous updating is only defensible
//      if verifying a suspicious status takes one click.
//
//   4. COLOUR IS NEVER THE ONLY CHANNEL. Every status carries an icon and a
//      text label. This is not decoration: at the obvious palette choices,
//      "Accepted" green and "Rejected" red are separated by ΔE 0.2 under
//      deuteranopia — indistinguishable for ~8% of men. The palette was rebuilt
//      around that pair (see index.css), and the icon + label make it moot.
// ============================================================================

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus, Trash2, Edit3, Search, BookOpen, User, GraduationCap, ExternalLink,
    X, Lock, ShieldCheck, Clock, AlertTriangle, CheckCircle2, XCircle, Mail,
    History, Inbox, RefreshCw, Calendar, FileText, Zap, TrendingUp, Send,
    CornerDownRight, Award, Hourglass, PenLine,
} from 'lucide-react';
import {
    db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy,
} from './firebase';

// ── CONFIG ─────────────────────────────────────────────────────────────────
// Set true once Firestore rules lock browser writes (see firestore.rules).
// With rules deployed, add/edit/delete cannot work from a browser — this hides
// the controls rather than presenting buttons that silently fail.
const READ_ONLY = false;
const PASSCODE_ENABLED = true;

// ── STATUS SYSTEM ──────────────────────────────────────────────────────────
// One canonical vocabulary, shared with scripts/lib/classify.mjs.
// `stage` drives ordering; `tone` drives colour; `icon` is the non-colour cue.
const STATUS_META = {
    'yet to start':             { stage: 0,  tone: 'idle',    short: 'Not started',    icon: PenLine },
    'submitted':                { stage: 1,  tone: 'active',  short: 'Submitted',      icon: Send },
    'under review':             { stage: 2,  tone: 'active',  short: 'Under review',   icon: Hourglass },
    'awaiting editor decision': { stage: 3,  tone: 'pending', short: 'With editor',    icon: Clock },
    'revision requested':       { stage: 4,  tone: 'action',  short: 'Revision',       icon: PenLine },
    'minor revision requested': { stage: 4,  tone: 'action',  short: 'Minor revision', icon: PenLine },
    'major revision requested': { stage: 4,  tone: 'action',  short: 'Major revision', icon: PenLine },
    'revision submitted':       { stage: 5,  tone: 'active',  short: 'Revision sent',  icon: Send },
    'action required':          { stage: 4,  tone: 'action',  short: 'Action needed',  icon: AlertTriangle },
    'accepted (conditional)':   { stage: 6,  tone: 'good',    short: 'Cond. accepted', icon: CheckCircle2 },
    'accepted':                 { stage: 7,  tone: 'good',    short: 'Accepted',       icon: CheckCircle2 },
    'in production (proofs)':   { stage: 8,  tone: 'good',    short: 'Proofs',         icon: FileText },
    'published':                { stage: 9,  tone: 'done',    short: 'Published',      icon: Award },
    'rejected':                 { stage: -1, tone: 'dead',    short: 'Rejected',       icon: XCircle },
    'desk rejected':            { stage: -1, tone: 'dead',    short: 'Desk rejected',  icon: XCircle },
    'withdrawn':                { stage: -1, tone: 'dead',    short: 'Withdrawn',      icon: XCircle },
};

// Light-surface status ink. Every value clears WCAG AA (≥4.5:1) as text on both
// #ffffff cards and the #f6f7f9 page. Published is VIOLET rather than a second
// green so it cannot collide with Accepted, and Rejected is a much darker red so
// the accept/reject pair separates by lightness as well as hue — it survives
// colour-vision deficiency and greyscale printing.
const TONE = {
    idle:    { fg: '#556274', bg: '#f1f3f6', bd: '#d8dee7' },
    active:  { fg: '#1d64bb', bg: '#eaf1fb', bd: '#bcd4f0' },
    pending: { fg: '#a06a00', bg: '#fdf4e3', bd: '#f0dcae' },
    action:  { fg: '#b04e22', bg: '#fdefe8', bd: '#f3cdb8' },
    good:    { fg: '#12a012', bg: '#e9f8e9', bd: '#b7e6b7' },
    done:    { fg: '#7c3aed', bg: '#f2ecfe', bd: '#d5c2fb' },
    dead:    { fg: '#8a1818', bg: '#fdecec', bd: '#f2c4c4' },
};

// Urgency is an ORDERED variable, so it uses a monotonically darkening ramp
// rather than arbitrary hues — and always ships with an icon and a text label.
const URGENCY = {
    overdue:  { fg: '#8a1818', bg: '#fdecec', label: 'OVERDUE',   icon: AlertTriangle },
    critical: { fg: '#b04e22', bg: '#fdefe8', label: 'CRITICAL',  icon: AlertTriangle },
    urgent:   { fg: '#a06a00', bg: '#fdf4e3', label: 'URGENT',    icon: Clock },
    soon:     { fg: '#1d64bb', bg: '#eaf1fb', label: 'UPCOMING',  icon: Clock },
    ok:       { fg: '#556274', bg: '#f1f3f6', label: 'SCHEDULED', icon: Calendar },
};

const statusMeta = (s) =>
    STATUS_META[String(s || '').toLowerCase().trim()] || { stage: 2, tone: 'active', short: s, icon: Hourglass };

function statusStyle(status, customColor, customTextColor) {
    if (customColor) return { background: `${customColor}1a`, color: customTextColor || customColor, border: `1px solid ${customColor}66` };
    const t = TONE[statusMeta(status).tone];
    return { background: t.bg, color: t.fg, border: `1px solid ${t.bd}` };
}
const isDead = (s) => statusMeta(s).stage === -1;
const isPublished = (s) => String(s || '').toLowerCase().includes('published');

// ── DATE HELPERS ───────────────────────────────────────────────────────────
const toDate = (v) => (!v ? null : v.toDate ? v.toDate() : v instanceof Date ? v : new Date(v));
const daysUntil = (d) => (d ? Math.ceil((d - new Date()) / 86400000) : null);

function urgencyOf(days) {
    if (days === null || days === undefined) return null;
    if (days < 0) return 'overdue';
    if (days <= 3) return 'critical';
    if (days <= 7) return 'urgent';
    if (days <= 14) return 'soon';
    return 'ok';
}
function relTime(d) {
    if (!d) return '—';
    const mins = Math.round((Date.now() - d) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.round(h / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const fmtDate = (d) => (d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * Split a manuscript's history into SUBMISSION ROUNDS.
 *
 * A round is a run of consecutive entries at the same journal. When a paper is
 * rejected by one journal and resubmitted to another, the history stays a single
 * list — this just chapters it, so the timeline reads as one continuous story
 * across venues instead of unrelated fragments.
 *
 * @param history entries sorted NEWEST FIRST
 * @returns rounds newest first, each numbered from the chronological start
 */
function groupIntoRounds(history) {
    if (!history.length) return [];
    const rounds = [];
    let cur = null;

    for (const h of history) {
        const key = h.journal || h.manuscriptId || '—';
        if (!cur || cur.key !== key) {
            cur = { key, journal: h.journal || null, manuscriptId: h.manuscriptId || null, entries: [] };
            rounds.push(cur);
        }
        cur.entries.push(h);
    }
    // Number chronologically: the last round in this newest-first list is round 1.
    const total = rounds.length;
    rounds.forEach((r, i) => {
        r.number = total - i;
        r.outcome = r.entries[0]?.status || null;   // newest status in that round
        r.startedAt = r.entries[r.entries.length - 1]?._at || null;
        r.endedAt = r.entries[0]?._at || null;
    });
    return rounds;
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(
        !PASSCODE_ENABLED || localStorage.getItem('auth_access') === 'true'
    );
    const [passInput, setPassInput] = useState('');
    const [authError, setAuthError] = useState('');

    const [papers, setPapers] = useState([]);
    const [projects, setProjects] = useState([]);
    const [unmatched, setUnmatched] = useState([]);
    const [lastSync, setLastSync] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [stageFilter, setStageFilter] = useState('active');
    const [timelineFor, setTimelineFor] = useState(null);
    const [editingItem, setEditingItem] = useState(null);
    const [modalTarget, setModalTarget] = useState('papers');
    const [isAddingMode, setIsAddingMode] = useState(false);
    const [newItem, setNewItem] = useState({ title: '', status: '', journal: '', manuscriptId: '' });

    const researcher = {
        name: 'Dr. DHIBIN VIKASH K P',
        credentials: 'B.S., MBBS.',
        guide: 'Dr. SATISH MUTHU',
        guideCredentials: 'MBBS., MS (Ortho)., DNB (Ortho)., MNAMS., FISS (Spine Surg)., FESS (Spine Endoscopy)., FIRM (Regen Med)., FEIORA (Orth Rheumatology)., PhD',
    };

    useEffect(() => {
        if (!isAuthenticated) return;
        setLoading(true);
        const subs = [];

        subs.push(onSnapshot(query(collection(db, 'papers'), orderBy('id', 'asc')),
            (s) => { setPapers(s.docs.map((d) => ({ ...d.data(), firestoreId: d.id }))); setLoading(false); },
            (e) => { setError(`Papers: ${e.message}`); setLoading(false); }));

        subs.push(onSnapshot(query(collection(db, 'projects'), orderBy('id', 'asc')),
            (s) => setProjects(s.docs.map((d) => ({ ...d.data(), firestoreId: d.id }))),
            (e) => setError(`Projects: ${e.message}`)));

        // Created by the sync job; absent before the first run, which is normal.
        subs.push(onSnapshot(collection(db, 'unmatched'),
            (s) => setUnmatched(s.docs.map((d) => ({ ...d.data(), firestoreId: d.id })).filter((u) => !u.resolved)), () => {}));

        subs.push(onSnapshot(collection(db, 'syncRuns'), (s) => {
            const runs = s.docs.map((d) => d.data())
                .map((r) => ({ ...r, finishedAt: toDate(r.finishedAt) }))
                .filter((r) => r.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt);
            setLastSync(runs[0] || null);
        }, () => {}));

        return () => subs.forEach((u) => u());
    }, [isAuthenticated]);

    const enriched = useMemo(() => papers.map((p) => {
        const deadline = toDate(p.deadline);
        const days = daysUntil(deadline);
        const history = [...(p.statusHistory || [])]
            .map((h) => ({ ...h, _at: toDate(h.detectedAt) || toDate(h.recordedAt) }))
            .sort((a, b) => (b._at || 0) - (a._at || 0));
        return {
            ...p,
            _deadline: deadline,
            _days: days,
            _urgency: urgencyOf(days),
            _meta: statusMeta(p.status),
            _history: history,
            _rounds: groupIntoRounds(history),
            _lastEmail: toDate(p.lastEmailAt),
        };
    }), [papers]);

    const actionable = useMemo(() =>
        enriched.filter((p) => p._deadline && !isDead(p.status) && !isPublished(p.status))
            .sort((a, b) => a._days - b._days), [enriched]);

    const stats = useMemo(() => {
        const live = enriched.filter((p) => !isDead(p.status) && !isPublished(p.status));
        return {
            active: live.length,
            underReview: live.filter((p) => ['under review', 'awaiting editor decision'].includes(String(p.status).toLowerCase())).length,
            needsAction: live.filter((p) => p._meta.tone === 'action').length,
            accepted: enriched.filter((p) => ['accepted', 'accepted (conditional)', 'in production (proofs)'].includes(String(p.status).toLowerCase())).length,
            published: enriched.filter((p) => isPublished(p.status)).length,
            rejected: enriched.filter((p) => isDead(p.status)).length,
            overdue: actionable.filter((p) => p._days < 0).length,
            dueSoon: actionable.filter((p) => p._days >= 0 && p._days <= 7).length,
            resubmitted: enriched.filter((p) => p._rounds.length > 1).length,
        };
    }, [enriched, actionable]);

    const pipeline = useMemo(() => {
        const buckets = [['Submitted', 1], ['Under review', 2], ['With editor', 3], ['Revision', 4], ['Revision sent', 5], ['Accepted', 6.5], ['Published', 9]];
        return buckets.map(([label, stage]) => ({
            label,
            count: enriched.filter((p) => {
                const s = p._meta.stage;
                return stage === 6.5 ? (s === 6 || s === 7 || s === 8) : s === stage;
            }).length,
        }));
    }, [enriched]);

    const visiblePapers = useMemo(() => {
        const q = searchTerm.toLowerCase();
        return enriched.filter((p) => {
            if (q) {
                const hay = `${p.title} ${p.status} ${p.journal || ''} ${p.manuscriptId || ''} ${(p.manuscriptIdAliases || []).join(' ')}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            if (stageFilter === 'active') return !isDead(p.status) && !isPublished(p.status);
            if (stageFilter === 'attention') return p._meta.tone === 'action' || p._urgency === 'overdue' || p._urgency === 'critical';
            if (stageFilter === 'published') return isPublished(p.status);
            if (stageFilter === 'closed') return isDead(p.status);
            return true;
        }).sort((a, b) => {
            const ua = a._days ?? 9999, ub = b._days ?? 9999;
            return ua !== ub ? ua - ub : b._meta.stage - a._meta.stage;
        });
    }, [enriched, searchTerm, stageFilter]);

    const handleDelete = async (col, id) => {
        if (!window.confirm('Delete this item?')) return;
        try { await deleteDoc(doc(db, col, id)); } catch (e) { setError(`Delete failed: ${e.message}`); }
    };
    const handleSaveEdit = async () => {
        try {
            const { firestoreId, _deadline, _days, _urgency, _meta, _history, _rounds, _lastEmail, ...data } = editingItem;
            await updateDoc(doc(db, modalTarget, firestoreId), data);
            setEditingItem(null);
        } catch (e) { setError(`Update failed: ${e.message}`); }
    };
    const handleAddItem = async () => {
        if (!newItem.title.trim()) return;
        try {
            const src = modalTarget === 'papers' ? papers : projects;
            const nextId = src.length ? Math.max(...src.map((p) => Number(p.id) || 0)) + 1 : 1;
            await addDoc(collection(db, modalTarget), { ...newItem, id: nextId, status: newItem.status || 'Yet to start', statusHistory: [], highlight: false });
            setNewItem({ title: '', status: '', journal: '', manuscriptId: '' });
            setIsAddingMode(false);
        } catch (e) { setError(`Add failed: ${e.message}`); }
    };

    if (!isAuthenticated) {
        return (
            <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-card"
                    style={{ padding: '2.5rem', maxWidth: 400, width: '100%', textAlign: 'center', boxShadow: 'var(--shadow-lg)' }}>
                    <div style={{ width: 66, height: 66, borderRadius: '50%', margin: '0 auto 1.4rem', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)' }}>
                        <Lock size={28} color="var(--accent)" />
                    </div>
                    <h1 style={{ fontSize: '1.35rem', marginBottom: '.4rem' }}>Research Portfolio</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginBottom: '1.7rem' }}>Enter passcode to continue</p>
                    <form onSubmit={(e) => {
                        e.preventDefault();
                        if (passInput === 'DHIBIN2025') { setIsAuthenticated(true); localStorage.setItem('auth_access', 'true'); }
                        else { setAuthError('Invalid passcode'); setPassInput(''); }
                    }} style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
                        <input type="password" value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="Passcode" autoFocus
                            style={{ padding: '.85rem', textAlign: 'center', letterSpacing: '.18em' }} />
                        {authError && <div style={{ color: 'var(--st-dead)', fontSize: '.8rem' }}>{authError}</div>}
                        <button type="submit" className="btn-primary" style={{ justifyContent: 'center', padding: '.75rem' }}>
                            <ShieldCheck size={17} /> Access Portfolio
                        </button>
                    </form>
                </motion.div>
            </div>
        );
    }

    return (
        <div style={{ padding: 'clamp(1rem, 3vw, 2.25rem)', maxWidth: 1500, margin: '0 auto' }}>
            <TopBar researcher={researcher} lastSync={lastSync}
                onLock={() => { localStorage.removeItem('auth_access'); setIsAuthenticated(false); }} />

            {error && (
                <div style={{ background: TONE.dead.bg, border: `1px solid ${TONE.dead.bd}`, color: TONE.dead.fg, padding: '.85rem 1.1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.4rem', fontSize: '.85rem', display: 'flex', gap: '.6rem', alignItems: 'center' }}>
                    <AlertTriangle size={17} /> {error}
                </div>
            )}

            <StatRow stats={stats} />
            {actionable.length > 0 && <DeadlinePanel items={actionable} onOpen={setTimelineFor} />}
            {unmatched.length > 0 && <UnmatchedPanel items={unmatched} />}
            <PipelineBar data={pipeline} total={enriched.length} resubmitted={stats.resubmitted} />

            <Toolbar searchTerm={searchTerm} setSearchTerm={setSearchTerm}
                stageFilter={stageFilter} setStageFilter={setStageFilter}
                counts={{
                    active: enriched.filter((p) => !isDead(p.status) && !isPublished(p.status)).length,
                    attention: enriched.filter((p) => statusMeta(p.status).tone === 'action').length,
                    published: stats.published, closed: stats.rejected, all: enriched.length,
                }}
                onAdd={() => { setModalTarget('papers'); setIsAddingMode(true); }} />

            <PaperList papers={visiblePapers} loading={loading} onOpenTimeline={setTimelineFor}
                onEdit={(p) => { setModalTarget('papers'); setEditingItem(p); }}
                onDelete={(id) => handleDelete('papers', id)} />

            {projects.length > 0 && (
                <ProjectSection projects={projects}
                    onEdit={(p) => { setModalTarget('projects'); setEditingItem(p); }}
                    onDelete={(id) => handleDelete('projects', id)}
                    onAdd={() => { setModalTarget('projects'); setIsAddingMode(true); }} />
            )}

            <AnimatePresence>
                {timelineFor && <TimelineModal paper={timelineFor} onClose={() => setTimelineFor(null)} />}
            </AnimatePresence>
            <AnimatePresence>
                {(editingItem || isAddingMode) && (
                    <EditModal isAdding={isAddingMode}
                        item={isAddingMode ? newItem : editingItem}
                        onChange={isAddingMode ? setNewItem : setEditingItem}
                        onSave={isAddingMode ? handleAddItem : handleSaveEdit}
                        onClose={() => { setEditingItem(null); setIsAddingMode(false); }} />
                )}
            </AnimatePresence>

            <footer style={{ marginTop: '3rem', paddingTop: '1.4rem', borderTop: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: '.73rem', textAlign: 'center' }}>
                Statuses update automatically from journal correspondence in both inboxes.
                Every entry links to its source email — verify before acting on a decision.
            </footer>
        </div>
    );
}

// ════════════════════════════════════════════════════════════════════════════
function TopBar({ researcher, lastSync, onLock }) {
    const finished = lastSync?.finishedAt;
    // A silently dead cron is what makes an automated tracker dangerous: stale
    // data that looks current. Anything older than 48h gets called out.
    const stale = !finished || (Date.now() - finished) > 48 * 3600 * 1000;
    const tone = stale ? TONE.pending : TONE.good;

    return (
        <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="glass-card"
            style={{ padding: 'clamp(1.15rem,2.5vw,1.6rem) clamp(1.25rem,3vw,2rem)', marginBottom: '1.4rem', display: 'flex', flexWrap: 'wrap', gap: '1.25rem', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ minWidth: 240 }}>
                <h1 style={{ fontSize: 'clamp(1.25rem,3vw,1.6rem)' }}>Research Portfolio</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '.85rem', marginTop: '.4rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                    <User size={13} />
                    <a href="https://dhibin-vikash.github.io" target="_blank" rel="noopener noreferrer" className="premium-link">
                        {researcher.name}, {researcher.credentials}
                        <ExternalLink size={11} className="icon" style={{ marginLeft: '.3rem' }} />
                    </a>
                </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.65rem' }}>
                <div style={{ textAlign: 'right', maxWidth: 440 }}>
                    <p style={{ color: 'var(--text-faint)', fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.13em', fontWeight: 700 }}>Guided by</p>
                    <h3 style={{ fontSize: '.95rem', color: 'var(--accent)', marginTop: '.15rem' }}>{researcher.guide}</h3>
                    <p style={{ color: 'var(--text-faint)', fontSize: '.68rem', lineHeight: 1.5, marginTop: '.2rem' }}>{researcher.guideCredentials}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.9rem' }}>
                    <span title={finished ? finished.toString() : 'The sync has never run'}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.68rem', color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`, padding: '.3rem .6rem', borderRadius: 99, fontWeight: 700, letterSpacing: '.05em' }}>
                        <RefreshCw size={11} /> {finished ? `SYNCED ${relTime(finished).toUpperCase()}` : 'SYNC NEVER RAN'}
                    </span>
                    <button onClick={onLock} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.73rem', fontFamily: 'inherit' }}>
                        <Lock size={12} /> Lock
                    </button>
                </div>
            </div>
        </motion.header>
    );
}

// Stat tiles, not a chart: independent headline numbers with no shared scale.
// Plotting them against each other would imply a relationship that isn't there.
function StatRow({ stats }) {
    const tiles = [
        { label: 'Active', value: stats.active, icon: FileText, tone: 'active', hint: 'in the pipeline' },
        { label: 'Under review', value: stats.underReview, icon: Hourglass, tone: 'active', hint: 'with reviewers' },
        { label: 'Need action', value: stats.needsAction, icon: PenLine, tone: 'action', hint: 'revision or task' },
        { label: 'Overdue', value: stats.overdue, icon: AlertTriangle, tone: 'dead', hint: 'past deadline' },
        { label: 'Due in 7d', value: stats.dueSoon, icon: Calendar, tone: 'pending', hint: 'closing soon' },
        { label: 'Accepted', value: stats.accepted, icon: CheckCircle2, tone: 'good', hint: 'awaiting print' },
        { label: 'Published', value: stats.published, icon: Award, tone: 'done', hint: 'in print' },
    ];
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '.8rem', marginBottom: '1.4rem' }}>
            {tiles.map((t, i) => {
                const Icon = t.icon;
                const c = TONE[t.tone];
                const muted = t.value === 0;
                return (
                    <motion.div key={t.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.035 }} className="glass-card" style={{ padding: '1.05rem 1.1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.65rem' }}>
                            <span style={{ fontSize: '.67rem', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--text-muted)', fontWeight: 700 }}>{t.label}</span>
                            <span style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 7, background: muted ? 'var(--surface-sunken)' : c.bg }}>
                                <Icon size={14} color={muted ? 'var(--text-faint)' : c.fg} />
                            </span>
                        </div>
                        <div className="futuristic-font" style={{ fontSize: '1.95rem', fontWeight: 700, lineHeight: 1, color: muted ? 'var(--text-faint)' : c.fg }}>{t.value}</div>
                        <div style={{ fontSize: '.67rem', color: 'var(--text-faint)', marginTop: '.35rem' }}>{t.hint}</div>
                    </motion.div>
                );
            })}
        </div>
    );
}

function DeadlinePanel({ items, onOpen }) {
    return (
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card"
            style={{ padding: 'clamp(1.15rem,2.5vw,1.6rem)', marginBottom: '1.4rem', borderColor: TONE.action.bd }}>
            <h2 style={{ fontSize: '.9rem', color: TONE.action.fg, display: 'flex', alignItems: 'center', gap: '.55rem', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '1rem' }}>
                <Clock size={18} /> Deadlines
                <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', letterSpacing: 0, textTransform: 'none', fontWeight: 500 }}>
                    — {items.length} paper{items.length > 1 ? 's' : ''} with an action window
                </span>
            </h2>
            <div style={{ display: 'grid', gap: '.6rem' }}>
                {items.map((p) => {
                    const u = URGENCY[p._urgency] || URGENCY.ok;
                    const Icon = u.icon;
                    const countdown = p._days < 0 ? `${Math.abs(p._days)}d overdue` : p._days === 0 ? 'Due today' : `${p._days}d left`;
                    return (
                        <button key={p.firestoreId} onClick={() => onOpen(p)}
                            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.85rem', padding: '.8rem .95rem', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', borderLeft: `3px solid ${u.fg}`, border: '1px solid var(--border)', borderLeftWidth: 3, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit' }}>
                            {/* icon + word + number: colour is never the only cue */}
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', color: u.fg, fontWeight: 800, fontSize: '.67rem', letterSpacing: '.08em', minWidth: 92 }}>
                                <Icon size={13} /> {u.label}
                            </span>
                            <span style={{ color: u.fg, fontWeight: 700, fontSize: '.84rem', minWidth: 88 }}>{countdown}</span>
                            <span style={{ flex: 1, minWidth: 220, fontSize: '.86rem', color: 'var(--text-primary)', fontWeight: 500 }}>{p.title}</span>
                            <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{p.journal || '—'}</span>
                            <StatusBadge status={p.status} small />
                            <span style={{ fontSize: '.71rem', color: 'var(--text-faint)' }}>due {fmtDate(p._deadline)}</span>
                        </button>
                    );
                })}
            </div>
        </motion.section>
    );
}

function UnmatchedPanel({ items }) {
    const [open, setOpen] = useState(false);
    const shown = open ? items : items.slice(0, 3);
    const REASON = {
        'no-manuscript-id': 'No manuscript ID in the email',
        'unknown-manuscript-id': 'Manuscript ID not linked to any tracked paper',
        'ambiguous-classification': 'Could not tell which decision this is',
        'blocked-regression': 'Would have moved a paper backwards',
    };
    return (
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card"
            style={{ padding: 'clamp(1.15rem,2.5vw,1.6rem)', marginBottom: '1.4rem', borderColor: TONE.pending.bd }}>
            <h2 style={{ fontSize: '.9rem', color: TONE.pending.fg, display: 'flex', alignItems: 'center', gap: '.55rem', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '.5rem' }}>
                <Inbox size={18} /> Needs your eyes
                <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', letterSpacing: 0, textTransform: 'none', fontWeight: 500 }}>— {items.length} email{items.length > 1 ? 's' : ''}</span>
            </h2>
            <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginBottom: '.9rem', lineHeight: 1.6, maxWidth: 720 }}>
                The sync refused to guess on these rather than risk writing a wrong status. An unknown manuscript ID
                usually means a resubmission — add it to the right paper and its history continues in the same timeline.
            </p>
            <div style={{ display: 'grid', gap: '.55rem' }}>
                {shown.map((u) => (
                    <div key={u.firestoreId} style={{ padding: '.8rem .95rem', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderLeft: `3px solid ${TONE.pending.fg}` }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.55rem', alignItems: 'center', marginBottom: '.35rem' }}>
                            <span style={{ fontSize: '.65rem', fontWeight: 800, color: TONE.pending.fg, textTransform: 'uppercase', letterSpacing: '.06em' }}>{REASON[u.reason] || u.reason}</span>
                            {u.manuscriptId && <code style={{ fontSize: '.69rem', color: 'var(--accent)', background: 'var(--accent-soft)', padding: '.12rem .4rem', borderRadius: 4 }}>{u.manuscriptId}</code>}
                            {u.suggestedStatus && <span style={{ fontSize: '.68rem', color: 'var(--text-muted)' }}>looks like: {u.suggestedStatus}</span>}
                        </div>
                        <div style={{ fontSize: '.83rem', color: 'var(--text-primary)', marginBottom: '.25rem' }}>{u.subject}</div>
                        {u.note && <div style={{ fontSize: '.71rem', color: TONE.pending.fg, marginBottom: '.25rem' }}>{u.note}</div>}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.85rem', fontSize: '.69rem', color: 'var(--text-faint)', alignItems: 'center' }}>
                            <span>{u.account}</span><span>{relTime(toDate(u.receivedAt))}</span>
                            {u.link && <a href={u.link} target="_blank" rel="noopener noreferrer" className="premium-link" style={{ fontSize: '.69rem' }}><Mail size={11} style={{ marginRight: 4 }} /> Open email</a>}
                        </div>
                    </div>
                ))}
            </div>
            {items.length > 3 && (
                <button onClick={() => setOpen(!open)} className="btn-ghost" style={{ marginTop: '.75rem', fontSize: '.75rem' }}>
                    {open ? 'Show fewer' : `Show all ${items.length}`}
                </button>
            )}
        </motion.section>
    );
}

// One series (papers per stage) → one colour. A second hue would imply a second
// variable that does not exist.
function PipelineBar({ data, total, resubmitted }) {
    const max = Math.max(1, ...data.map((d) => d.count));
    return (
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card"
            style={{ padding: 'clamp(1.15rem,2.5vw,1.6rem)', marginBottom: '1.4rem' }}>
            <h2 style={{ fontSize: '.9rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '.55rem', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '1.1rem' }}>
                <TrendingUp size={18} color="var(--accent)" /> Pipeline
                <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', letterSpacing: 0, textTransform: 'none', fontWeight: 500 }}>
                    — {total} manuscripts{resubmitted > 0 ? `, ${resubmitted} resubmitted across journals` : ''}
                </span>
            </h2>
            <div style={{ display: 'grid', gap: '.6rem' }}>
                {data.map((d, i) => (
                    <div key={d.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(92px,112px) 1fr 30px', alignItems: 'center', gap: '.8rem' }}>
                        <span style={{ fontSize: '.74rem', color: 'var(--text-secondary)', textAlign: 'right' }}>{d.label}</span>
                        <div style={{ height: 9, background: 'var(--surface-sunken)', borderRadius: 5, overflow: 'hidden' }}>
                            <motion.div initial={{ width: 0 }} animate={{ width: `${(d.count / max) * 100}%` }}
                                transition={{ duration: .65, delay: i * .05, ease: 'easeOut' }}
                                style={{ height: '100%', borderRadius: 5, background: d.count ? 'var(--accent)' : 'transparent' }} />
                        </div>
                        {/* Only 7 marks — direct labels beat a tooltip that hides
                            information which already fits on screen. */}
                        <span className="futuristic-font" style={{ fontSize: '.85rem', fontWeight: 700, color: d.count ? 'var(--text-primary)' : 'var(--text-faint)' }}>{d.count}</span>
                    </div>
                ))}
            </div>
        </motion.section>
    );
}

function StatusBadge({ status, small, customColor, customTextColor }) {
    const meta = statusMeta(status);
    const Icon = meta.icon;
    return (
        <span style={{
            ...statusStyle(status, customColor, customTextColor),
            display: 'inline-flex', alignItems: 'center', gap: '.3rem',
            padding: small ? '.22rem .5rem' : '.32rem .65rem',
            borderRadius: 6, fontSize: small ? '.63rem' : '.68rem',
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap',
        }}>
            <Icon size={small ? 10 : 12} /> {small ? meta.short : status}
        </span>
    );
}

function Toolbar({ searchTerm, setSearchTerm, stageFilter, setStageFilter, counts, onAdd }) {
    const filters = [
        { key: 'active', label: 'Active', n: counts.active },
        { key: 'attention', label: 'Needs action', n: counts.attention },
        { key: 'published', label: 'Published', n: counts.published },
        { key: 'closed', label: 'Closed', n: counts.closed },
        { key: 'all', label: 'All', n: counts.all },
    ];
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.7rem', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
                <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
                <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search title, journal, manuscript ID…"
                    style={{ width: '100%', padding: '.65rem .85rem .65rem 2.3rem' }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
                {filters.map((f) => {
                    const on = stageFilter === f.key;
                    return (
                        <button key={f.key} onClick={() => setStageFilter(f.key)}
                            style={{ background: on ? 'var(--accent)' : 'var(--surface)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`, color: on ? '#fff' : 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', padding: '.52rem .75rem', fontSize: '.76rem', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', gap: '.35rem', alignItems: 'center', fontFamily: 'inherit' }}>
                            {f.label}<span style={{ opacity: .72, fontSize: '.7rem' }}>{f.n}</span>
                        </button>
                    );
                })}
            </div>
            {!READ_ONLY && <button className="btn-primary" onClick={onAdd}><Plus size={16} /> New paper</button>}
        </div>
    );
}

function PaperList({ papers, loading, onOpenTimeline, onEdit, onDelete }) {
    if (loading) return <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;
    if (!papers.length) return <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No papers match this filter.</div>;

    return (
        <div style={{ display: 'grid', gap: '.6rem', marginBottom: '2.5rem' }}>
            <AnimatePresence mode="popLayout">
                {papers.map((p, i) => (
                    <motion.article key={p.firestoreId} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: .99 }} transition={{ delay: Math.min(i * .025, .25) }}
                        className="glass-card" style={{ padding: '1.05rem 1.2rem' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
                            <span className="futuristic-font" style={{ color: 'var(--text-faint)', fontWeight: 700, fontSize: '.85rem', minWidth: 30 }}>#{p.id}</span>
                            <div style={{ flex: '1 1 320px', minWidth: 240 }}>
                                <h3 style={{ fontSize: '.95rem', fontWeight: 600, lineHeight: 1.5, color: 'var(--text-primary)', marginBottom: '.45rem' }}>{p.title}</h3>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.8rem', fontSize: '.72rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                                    {p.journal && <span style={{ display: 'inline-flex', gap: '.28rem', alignItems: 'center' }}><BookOpen size={11} /> {p.journal}</span>}
                                    {p.manuscriptId && <code style={{ color: 'var(--text-secondary)', background: 'var(--surface-sunken)', padding: '.08rem .35rem', borderRadius: 4, fontSize: '.7rem' }}>{p.manuscriptId}</code>}
                                    {/* Resubmission marker — the at-a-glance cue that this
                                        paper has a longer story than its current journal. */}
                                    {p._rounds.length > 1 && (
                                        <span style={{ display: 'inline-flex', gap: '.25rem', alignItems: 'center', color: TONE.done.fg, background: TONE.done.bg, border: `1px solid ${TONE.done.bd}`, padding: '.1rem .4rem', borderRadius: 5, fontWeight: 700, fontSize: '.66rem' }}>
                                            <CornerDownRight size={10} /> {p._rounds.length} journals
                                        </span>
                                    )}
                                    {p._lastEmail && <span style={{ display: 'inline-flex', gap: '.28rem', alignItems: 'center' }}><Mail size={11} /> {relTime(p._lastEmail)}</span>}
                                    {p._history.length > 0 && (
                                        <button onClick={() => onOpenTimeline(p)} className="premium-link"
                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '.72rem', padding: 0, fontFamily: 'inherit' }}>
                                            <History size={11} style={{ marginRight: 4 }} /> Timeline ({p._history.length})
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                                {p._urgency && !isDead(p.status) && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.28rem', color: URGENCY[p._urgency].fg, background: URGENCY[p._urgency].bg, padding: '.22rem .5rem', borderRadius: 5, fontSize: '.66rem', fontWeight: 800 }}>
                                        <Clock size={10} /> {p._days < 0 ? `${Math.abs(p._days)}D OVERDUE` : `${p._days}D LEFT`}
                                    </span>
                                )}
                                <StatusBadge status={p.status} customColor={p.color} customTextColor={p.fontColor} />
                                {p.autoUpdated && <span title="Set automatically from a journal email" style={{ color: 'var(--text-faint)', display: 'inline-flex' }}><Zap size={12} /></span>}
                                {!READ_ONLY && (
                                    <>
                                        <button onClick={() => onEdit(p)} style={iconBtn} title="Edit"><Edit3 size={14} /></button>
                                        <button onClick={() => onDelete(p.firestoreId)} style={{ ...iconBtn, color: TONE.dead.fg }} title="Delete"><Trash2 size={14} /></button>
                                    </>
                                )}
                            </div>
                        </div>
                    </motion.article>
                ))}
            </AnimatePresence>
        </div>
    );
}

// ── THE CENTREPIECE ────────────────────────────────────────────────────────
// One manuscript, one continuous history — chaptered into submission rounds so
// a move between journals reads as part of the story rather than a fresh start.
function TimelineModal({ paper, onClose }) {
    const rounds = paper._rounds || [];
    const multi = rounds.length > 1;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.45)', backdropFilter: 'blur(3px)', zIndex: 100, display: 'grid', placeItems: 'start center', padding: 'clamp(1rem,4vw,2.5rem)', overflowY: 'auto' }}>
            <motion.div initial={{ scale: .97, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .97, opacity: 0 }}
                onClick={(e) => e.stopPropagation()} className="glass-card"
                style={{ padding: 'clamp(1.4rem,3vw,2rem)', width: '100%', maxWidth: 780, boxShadow: 'var(--shadow-lg)' }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.3rem' }}>
                    <div>
                        <div style={{ fontSize: '.67rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.13em', marginBottom: '.45rem', fontWeight: 700 }}>
                            Manuscript journey
                        </div>
                        <h2 style={{ fontSize: '1.05rem', lineHeight: 1.45, color: 'var(--text-primary)' }}>{paper.title}</h2>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.7rem', marginTop: '.7rem', alignItems: 'center' }}>
                            <StatusBadge status={paper.status} />
                            {paper.journal && <span style={{ fontSize: '.74rem', color: 'var(--text-secondary)' }}>currently at <strong>{paper.journal}</strong></span>}
                            {multi && (
                                <span style={{ fontSize: '.7rem', color: TONE.done.fg, background: TONE.done.bg, border: `1px solid ${TONE.done.bd}`, padding: '.15rem .45rem', borderRadius: 5, fontWeight: 700, display: 'inline-flex', gap: '.25rem', alignItems: 'center' }}>
                                    <CornerDownRight size={11} /> {rounds.length} submission rounds
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ ...iconBtn, alignSelf: 'flex-start' }} title="Close"><X size={18} /></button>
                </div>

                {paper._deadline && (
                    <div style={{ padding: '.8rem .95rem', borderRadius: 'var(--radius-sm)', background: TONE.action.bg, border: `1px solid ${TONE.action.bd}`, marginBottom: '1.4rem' }}>
                        <div style={{ display: 'flex', gap: '.45rem', alignItems: 'center', color: TONE.action.fg, fontSize: '.75rem', fontWeight: 800, marginBottom: '.2rem' }}>
                            <Clock size={13} /> DEADLINE {fmtDate(paper._deadline)} · {paper._days < 0 ? `${Math.abs(paper._days)} days overdue` : `${paper._days} days left`}
                        </div>
                        {paper.deadlineSource?.raw && (
                            <div style={{ fontSize: '.72rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>read from: “{paper.deadlineSource.raw}”</div>
                        )}
                    </div>
                )}

                {rounds.length === 0 ? (
                    <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.86rem' }}>
                        No recorded history yet. Entries appear here as the daily sync detects journal emails for this manuscript.
                    </div>
                ) : (
                    <div>
                        {rounds.map((round, ri) => {
                            const outcomeTone = TONE[statusMeta(round.outcome).tone];
                            return (
                                <div key={ri} style={{ marginBottom: ri === rounds.length - 1 ? 0 : '.4rem' }}>
                                    {/* Round header — only shown when the paper has actually
                                        moved journals; a single-venue paper needs no chaptering. */}
                                    {multi && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.6rem', padding: '.6rem .85rem', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', border: '1px solid var(--border)', marginBottom: '1rem' }}>
                                            <span style={{ fontSize: '.64rem', fontWeight: 800, letterSpacing: '.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                                Round {round.number}
                                            </span>
                                            <span style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                {round.journal || 'Unknown journal'}
                                            </span>
                                            {round.manuscriptId && (
                                                <code style={{ fontSize: '.68rem', color: 'var(--text-secondary)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '.1rem .38rem', borderRadius: 4 }}>{round.manuscriptId}</code>
                                            )}
                                            <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: 'var(--text-faint)' }}>
                                                {round.startedAt ? fmtDate(round.startedAt) : '—'} → {round.endedAt ? fmtDate(round.endedAt) : '—'}
                                            </span>
                                            <span style={{ color: outcomeTone.fg, background: outcomeTone.bg, border: `1px solid ${outcomeTone.bd}`, padding: '.15rem .45rem', borderRadius: 5, fontSize: '.63rem', fontWeight: 800, textTransform: 'uppercase' }}>
                                                {statusMeta(round.outcome).short}
                                            </span>
                                        </div>
                                    )}

                                    <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
                                        <div style={{ position: 'absolute', left: 5, top: 4, bottom: 4, width: 2, background: 'var(--border-strong)' }} />
                                        {round.entries.map((h, i) => {
                                            const meta = statusMeta(h.status);
                                            const tone = TONE[meta.tone];
                                            const Icon = meta.icon;
                                            const newest = ri === 0 && i === 0;
                                            const lowConf = typeof h.confidence === 'number' && h.confidence < 0.75;
                                            return (
                                                <div key={i} style={{ position: 'relative', paddingBottom: '1.4rem' }}>
                                                    <span style={{ position: 'absolute', left: '-1.5rem', top: 1, width: 14, height: 14, borderRadius: '50%', background: tone.fg, border: '3px solid var(--surface)', boxShadow: newest ? `0 0 0 3px ${tone.bg}` : 'none' }} />
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center', marginBottom: '.35rem' }}>
                                                        <span style={{ color: tone.fg, fontWeight: 700, fontSize: '.85rem', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                                                            <Icon size={13} /> {h.status}
                                                        </span>
                                                        {h.previousStatus && <span style={{ fontSize: '.69rem', color: 'var(--text-faint)' }}>from {h.previousStatus}</span>}
                                                        {newest && <span style={{ fontSize: '.6rem', color: 'var(--accent)', background: 'var(--accent-soft)', padding: '.08rem .38rem', borderRadius: 4, fontWeight: 800 }}>CURRENT</span>}
                                                    </div>
                                                    <div style={{ fontSize: '.71rem', color: 'var(--text-muted)', marginBottom: '.45rem', display: 'flex', flexWrap: 'wrap', gap: '.75rem' }}>
                                                        <span>{h._at ? h._at.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                                                        {!multi && h.journal && <span>{h.journal}</span>}
                                                        {h.source?.account && <span>via {h.source.account}'s inbox</span>}
                                                        {typeof h.confidence === 'number' && (
                                                            <span style={{ color: lowConf ? TONE.pending.fg : 'var(--text-faint)', fontWeight: lowConf ? 700 : 400 }}>
                                                                {Math.round(h.confidence * 100)}% confidence{lowConf ? ' — verify' : ''}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {h.source?.subject && (
                                                        <div style={{ padding: '.65rem .8rem', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', border: '1px solid var(--border)' }}>
                                                            <div style={{ fontSize: '.77rem', color: 'var(--text-primary)', marginBottom: '.25rem', fontWeight: 500 }}>{h.source.subject}</div>
                                                            {h.evidence && <div style={{ fontSize: '.71rem', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.6, marginBottom: '.4rem' }}>“{h.evidence}”</div>}
                                                            {h.source.link && (
                                                                <a href={h.source.link} target="_blank" rel="noopener noreferrer" className="premium-link" style={{ fontSize: '.7rem' }}>
                                                                    <Mail size={11} style={{ marginRight: 4 }} /> Open the source email
                                                                </a>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* The transition marker: what happened between two journals. */}
                                    {ri < rounds.length - 1 && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', padding: '.55rem .85rem', margin: '0 0 1rem', borderRadius: 'var(--radius-sm)', background: 'var(--accent-soft)', border: '1px dashed var(--border-strong)', color: 'var(--text-secondary)', fontSize: '.72rem', fontWeight: 600 }}>
                                            <CornerDownRight size={13} color="var(--accent)" />
                                            Resubmitted from {rounds[ri + 1].journal || 'a previous journal'} → {round.journal || 'this journal'}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
}

function EditModal({ isAdding, item, onChange, onSave, onClose }) {
    const set = (k, v) => onChange({ ...item, [k]: v });
    const fields = [
        { k: 'title', label: 'Title', ph: 'Manuscript title' },
        { k: 'status', label: 'Status', ph: 'e.g. Under Review' },
        { k: 'journal', label: 'Journal', ph: 'e.g. European Spine Journal' },
        { k: 'manuscriptId', label: 'Manuscript ID', ph: 'e.g. ESJ-D-25-00112 — required for auto-sync' },
    ];
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.45)', backdropFilter: 'blur(3px)', zIndex: 100, display: 'grid', placeItems: 'center', padding: '1.2rem' }}>
            <motion.div initial={{ scale: .97 }} animate={{ scale: 1 }} exit={{ scale: .97, opacity: 0 }}
                onClick={(e) => e.stopPropagation()} className="glass-card"
                style={{ padding: 'clamp(1.4rem,3vw,2rem)', width: '100%', maxWidth: 520, boxShadow: 'var(--shadow-lg)' }}>
                <h2 style={{ fontSize: '1.05rem', marginBottom: '1.3rem' }}>{isAdding ? 'New paper' : 'Edit paper'}</h2>
                <div style={{ display: 'grid', gap: '.9rem' }}>
                    {fields.map((f) => (
                        <label key={f.k}>
                            <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.4rem', fontWeight: 700 }}>{f.label}</span>
                            <input value={item?.[f.k] || ''} onChange={(e) => set(f.k, e.target.value)} placeholder={f.ph} style={{ width: '100%', padding: '.75rem' }} />
                        </label>
                    ))}
                </div>
                <p style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.85rem', lineHeight: 1.6 }}>
                    Without a manuscript ID this paper is never auto-updated — its journal emails go to “Needs your eyes” instead.
                    Resubmitting elsewhere? Keep the old ID in <code>manuscriptIdAliases</code> so the timeline stays continuous.
                </p>
                <div style={{ display: 'flex', gap: '.65rem', marginTop: '1.4rem' }}>
                    <button className="btn-primary" onClick={onSave} style={{ flex: 1, justifyContent: 'center', padding: '.7rem' }}>Save</button>
                    <button className="btn-ghost" onClick={onClose} style={{ flex: 1, justifyContent: 'center', padding: '.7rem' }}>Cancel</button>
                </div>
            </motion.div>
        </motion.div>
    );
}

function ProjectSection({ projects, onEdit, onDelete, onAdd }) {
    return (
        <section style={{ marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.9rem', flexWrap: 'wrap', gap: '.8rem' }}>
                <h2 style={{ fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: '.55rem', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                    <BookOpen size={18} color="var(--accent)" /> Other projects
                </h2>
                {!READ_ONLY && <button className="btn-primary" onClick={onAdd}><Plus size={16} /> New project</button>}
            </div>
            <div style={{ display: 'grid', gap: '.55rem' }}>
                {projects.map((p) => (
                    <div key={p.firestoreId} className="glass-card" style={{ padding: '.9rem 1.15rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
                        <span className="futuristic-font" style={{ color: 'var(--text-faint)', fontWeight: 700, fontSize: '.82rem', minWidth: 28 }}>#{p.id}</span>
                        <span style={{ flex: '1 1 260px', fontSize: '.88rem', color: 'var(--text-primary)' }}>{p.title}</span>
                        <StatusBadge status={p.status} customColor={p.color} customTextColor={p.fontColor} />
                        {!READ_ONLY && (
                            <>
                                <button onClick={() => onEdit(p)} style={iconBtn}><Edit3 size={14} /></button>
                                <button onClick={() => onDelete(p.firestoreId)} style={{ ...iconBtn, color: TONE.dead.fg }}><Trash2 size={14} /></button>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}

const iconBtn = {
    background: 'transparent', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', padding: '.3rem', display: 'inline-flex', alignItems: 'center', borderRadius: 5,
};
