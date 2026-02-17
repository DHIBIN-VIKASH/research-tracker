import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus,
    Trash2,
    Edit3,
    Search,
    BookOpen,
    User,
    GraduationCap,
    ChevronRight,
    ExternalLink,
    Save,
    X,
    Lock,
    ShieldCheck
} from 'lucide-react';
import {
    db,
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    orderBy
} from './firebase';

const getStatusStyles = (status, customColor, customTextColor) => {
    const s = status.toLowerCase();

    // These terms should ALWAYS glow for high visibility
    const shouldGlow = s.includes('de recommendation') ||
        s.includes('eic decision') ||
        s.includes('awaiting approval decision') ||
        s.includes('almost published');

    // Default color palette
    const GREEN = '#00B050';
    const NEON_GREEN = '#00ff9d';

    // Logic: 
    // 1. If user picked a color, use it.
    // 2. If it's a "glow" term and no color picked, use Green.
    // 3. Otherwise, use keyword-based colors.

    let color = customColor;
    let textColor = customTextColor;

    if (shouldGlow) {
        color = GREEN;
        textColor = NEON_GREEN;
    } else if (!color) {
        if (s.includes('european spine journal')) color = '#3182ce';
        else if (s.includes('indian journal')) color = '#e53e3e';
        else if (s.includes('gs journal')) color = '#38a169';
        else if (s.includes('asian spine journal')) color = '#805ad5';
        else if (s.includes('rej')) color = '#f56565';
        else if (s.includes('awaiting')) color = '#ecc94b';
        else if (s.includes('yet to start')) color = '#a0aec0';
        else color = '#00f2ff';
    }

    if (!textColor) textColor = color;

    return {
        background: color ? `${color}33` : 'rgba(0, 242, 255, 0.1)',
        color: textColor,
        border: `1px solid ${color ? `${color}aa` : 'rgba(0, 242, 255, 0.4)'}`,
        boxShadow: shouldGlow ? `0 0 15px ${color}66` : 'none',
        textShadow: shouldGlow ? `0 0 8px ${textColor}` : 'none',
        animation: shouldGlow ? 'pulse-glow 2s infinite' : 'none'
    };
};

const App = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(localStorage.getItem('auth_access') === 'true');
    const [passInput, setPassInput] = useState('');
    const [papers, setPapers] = useState([]);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const MASTER_PASSCODE = "2026";

    const handleAuth = (e) => {
        if (e) e.preventDefault();
        if (passInput === MASTER_PASSCODE) {
            setIsAuthenticated(true);
            localStorage.setItem('auth_access', 'true');
            setError(null);
        } else {
            setError("Access Denied: Invalid Passcode");
            setPassInput("");
        }
    };
    const [researcher] = useState({
        name: "Dr. DHIBIN VIKASH K P",
        credentials: "B.S., MBBS.",
        guide: "Dr. SATISH MUTHU",
        guideCredentials: "MBBS., MS (Ortho)., DNB (Ortho)., MNAMS., FISS (Spine Surg)., FESS (Spine Endoscopy)., FIRM (Regen Med)., FEIORA (Orth Rheumatology)., PhD"
    });
    const [searchTerm, setSearchTerm] = useState("");
    const [editingItem, setEditingItem] = useState(null);
    const [modalTarget, setModalTarget] = useState("papers");
    const [isAddingMode, setIsAddingMode] = useState(false);
    const [newItem, setNewItem] = useState({ title: "", status: "", color: "", fontColor: "" });

    useEffect(() => {
        setLoading(true);

        // Listen to Papers
        const qPapers = query(collection(db, "papers"), orderBy("id", "asc"));
        const unsubPapers = onSnapshot(qPapers, (snap) => {
            const data = snap.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
            setPapers(data);
            setLoading(false);
        }, (err) => setError(`Firebase Error (Papers): ${err.message}`));

        // Listen to Other Projects
        const qProjects = query(collection(db, "projects"), orderBy("id", "asc"));
        const unsubProjects = onSnapshot(qProjects, (snap) => {
            const data = snap.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
            setProjects(data);
        }, (err) => setError(`Firebase Error (Projects): ${err.message}`));

        return () => { unsubPapers(); unsubProjects(); };
    }, []);

    const handleDelete = async (collectionName, firestoreId) => {
        if (!window.confirm("Delete this item?")) return;
        try {
            await deleteDoc(doc(db, collectionName, firestoreId));
        } catch (error) {
            console.error("Delete failed:", error);
        }
    };

    const handleEdit = (item, target) => {
        setModalTarget(target);
        setEditingItem({ ...item });
    };

    const handleSaveEdit = async () => {
        try {
            const { firestoreId, ...data } = editingItem;
            await updateDoc(doc(db, modalTarget, firestoreId), data);
            setEditingItem(null);
        } catch (error) {
            console.error("Update failed:", error);
        }
    };

    const handleAddItem = async () => {
        if (newItem.title.trim()) {
            try {
                const source = modalTarget === "papers" ? papers : projects;
                const nextId = source.length > 0 ? Math.max(...source.map(p => p.id)) + 1 : 1;
                await addDoc(collection(db, modalTarget), {
                    ...newItem,
                    id: nextId,
                    status: newItem.status || "Yet to start",
                    highlight: false
                });
                setNewItem({ title: "", status: "", color: "", fontColor: "" });
                setIsAddingMode(false);
            } catch (error) {
                console.error("Add failed:", error);
            }
        }
    };

    const renderTable = (data, title, collectionName, typeIcon) => {
        const filtered = data.filter(i =>
            i.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            i.status?.toLowerCase().includes(searchTerm.toLowerCase())
        );

        // Filter out published for the main table if it's papers
        const displayData = collectionName === "papers"
            ? filtered.filter(p => !p.status?.toLowerCase().includes('published'))
            : filtered;

        return (
            <div style={{ marginBottom: '3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--neon-cyan)' }}>
                        {React.cloneElement(typeIcon, { size: 24 })} {title}
                    </h2>
                    <button className="btn-primary" onClick={() => { setModalTarget(collectionName); setIsAddingMode(true); }}>
                        <Plus size={18} /> New {collectionName === "papers" ? "Publication" : "Project"}
                    </button>
                </div>

                <motion.div layout className="glass-card" style={{ overflow: 'hidden' }}>
                    <div className="table-responsive">
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                                    <th style={{ padding: '1.25rem', width: '80px', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>ID</th>
                                    <th style={{ padding: '1.25rem', width: '400px', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Title</th>
                                    <th style={{ padding: '1.25rem', width: '250px', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Status</th>
                                    <th style={{ padding: '1.25rem', width: '120px', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <AnimatePresence>
                                    {displayData.map((item, index) => (
                                        <motion.tr
                                            key={item.firestoreId}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            transition={{ delay: index * 0.05 }}
                                            style={{ borderBottom: '1px solid var(--glass-border)' }}
                                            whileHover={{ background: 'rgba(255,255,255,0.02)' }}
                                        >
                                            <td style={{ padding: '1.25rem', color: 'var(--neon-cyan)', fontWeight: '600' }}>#{item.id}</td>
                                            <td style={{ padding: '1.25rem', width: '400px', maxWidth: '400px', fontSize: '0.95rem', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.title}</td>
                                            <td style={{ padding: '1.25rem' }}>
                                                <span style={{
                                                    padding: '0.4rem 0.8rem',
                                                    borderRadius: '6px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: '800',
                                                    textTransform: 'uppercase',
                                                    display: 'inline-block',
                                                    ...getStatusStyles(item.status, item.color, item.fontColor)
                                                }}>
                                                    {item.status}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1.25rem', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                    <button onClick={() => handleEdit(item, collectionName)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.5rem' }}>
                                                        <Edit3 size={16} />
                                                    </button>
                                                    <button onClick={() => handleDelete(collectionName, item.firestoreId)} style={{ background: 'transparent', border: 'none', color: '#ff4d4d', cursor: 'pointer', padding: '0.5rem' }}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    ))}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>
                </motion.div>
            </div>
        );
    };

    const publishedPapers = papers.filter(p => p.status?.toLowerCase().includes('published'));

    if (!isAuthenticated) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'var(--bg-color)' }}>
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card"
                    style={{ width: '100%', maxWidth: '400px', padding: '3rem', textAlign: 'center', border: '1px solid var(--neon-cyan)', boxShadow: '0 0 40px rgba(0, 242, 255, 0.1)' }}
                >
                    <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'center' }}>
                        <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(0, 242, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--neon-cyan)' }}>
                            <Lock size={40} color="var(--neon-cyan)" />
                        </div>
                    </div>
                    <h2 className="neon-text" style={{ fontSize: '1.75rem', marginBottom: '1rem' }}>Secure Access</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>Please enter your administrative passcode to continue.</p>

                    <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <input
                            type="password"
                            placeholder="••••"
                            value={passInput}
                            onChange={(e) => setPassInput(e.target.value)}
                            autoFocus
                            style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '1.25rem', color: 'white', fontSize: '1.5rem', textAlign: 'center', letterSpacing: '0.5em', outline: 'none' }}
                        />
                        {error && <p style={{ color: '#ff4d4d', fontSize: '0.85rem' }}>{error}</p>}
                        <button type="submit" className="btn-primary" style={{ padding: '1.25rem', justifyContent: 'center', fontSize: '1rem', borderRadius: '12px' }}>
                            <ShieldCheck size={20} /> Access Portfolio
                        </button>
                    </form>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="dashboard-container" style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '-1rem', position: 'relative', zIndex: 10 }}>
                <button
                    onClick={() => { localStorage.removeItem('auth_access'); setIsAuthenticated(false); }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}
                >
                    <Lock size={14} /> Lock Dashboard
                </button>
            </div>
            {/* Header Section */}
            <motion.header
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card"
                style={{
                    padding: '1.5rem 2rem',
                    marginBottom: '2rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem'
                }}
            >
                <div style={{ minWidth: '250px' }}>
                    <h1 className="neon-text" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Research Portfolio</h1>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.2rem', margin: 0 }}>
                            <User size={14} style={{ marginRight: '0.3rem' }} />
                            <a
                                href="https://dhibin-vikash.github.io"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="premium-link"
                            >
                                {researcher.name}
                                <ExternalLink size={12} className="icon" />
                            </a>
                            , {researcher.credentials}
                        </p>
                        <a
                            href="https://dhibin-vikash.github.io"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-ghost"
                        >
                            <ExternalLink size={14} /> Visit Website
                        </a>
                    </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: '250px', maxWidth: '450px' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Guided by</p>
                    <h3 style={{ fontSize: '1rem', color: 'var(--neon-cyan)' }}>{researcher.guide}</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{researcher.guideCredentials}</p>
                </div>
            </motion.header>

            {/* Error Message */}
            {error && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                        background: 'rgba(255, 77, 77, 0.15)',
                        border: '1px solid #ff4d4d',
                        color: '#ff4d4d',
                        padding: '1rem',
                        borderRadius: '8px',
                        marginBottom: '2rem',
                        fontSize: '0.9rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}
                >
                    <X size={18} />
                    {error}
                </motion.div>
            )}

            {/* Published Papers Hall of Fame/Progress */}
            <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-card shine-container"
                style={{
                    padding: '2rem',
                    marginBottom: '2rem',
                    background: 'rgba(0, 255, 157, 0.03)',
                    border: '1px solid rgba(0, 255, 157, 0.2)',
                    boxShadow: '0 0 20px rgba(0, 255, 157, 0.05)'
                }}
            >
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', gap: '1rem' }}>
                    <h2 style={{ fontSize: '1.25rem', color: 'var(--neon-green)', display: 'flex', alignItems: 'center', gap: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        <GraduationCap size={28} /> Publication Progress
                    </h2>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {/* Goal 1: Lifetime Papers Target */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
                            <label style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Progress to the Target</label>
                            <span style={{ color: 'var(--neon-cyan)', fontWeight: '800', fontSize: '1.1rem' }}>{papers.length}/50</span>
                        </div>
                        <div className="progress-container" style={{ height: '10px' }}>
                            <motion.div
                                className="progress-fill"
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min((papers.length / 50) * 100, 100)}%` }}
                                transition={{ duration: 1.5, ease: "easeOut" }}
                                style={{ background: 'linear-gradient(90deg, #00f2ff, #0077ff)' }}
                            />
                        </div>
                    </div>

                    {/* Goal 2: Current Portfolio Completion */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
                            <label style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Published papers</label>
                            <span style={{ color: 'var(--neon-green)', fontWeight: '800', fontSize: '1.1rem' }}>{publishedPapers.length}/{papers.length}</span>
                        </div>
                        <div className="progress-container" style={{ height: '10px', background: 'rgba(0, 242, 255, 0.05)' }}>
                            <motion.div
                                className="progress-fill"
                                initial={{ width: 0 }}
                                animate={{ width: `${(publishedPapers.length / (papers.length || 1)) * 100}%` }}
                                transition={{ duration: 1.5, ease: "easeOut" }}
                                style={{ background: 'linear-gradient(90deg, #00ff9d, #00b050)' }}
                            />
                        </div>
                    </div>
                </div>

                <div style={{ marginTop: '2.5rem' }}>
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Published Papers</h3>
                    <AnimatePresence>
                        {publishedPapers.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {publishedPapers.map((paper, idx) => (
                                    <motion.div
                                        key={paper.firestoreId}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: idx * 0.1 }}
                                        className="glass-card published-entry"
                                        style={{
                                            padding: '1.25rem',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            background: 'rgba(255, 255, 255, 0.02)',
                                            borderLeft: '4px solid var(--neon-green)'
                                        }}
                                    >
                                        <div style={{ flex: 1, marginRight: '1.5rem' }}>
                                            <h3 style={{ fontSize: '1rem', lineHeight: '1.4', color: 'white' }}>{paper.title}</h3>
                                        </div>
                                        <span style={{
                                            padding: '0.4rem 0.8rem',
                                            borderRadius: '6px',
                                            fontSize: '0.7rem',
                                            fontWeight: '800',
                                            textTransform: 'uppercase',
                                            flexShrink: 0,
                                            ...getStatusStyles(paper.status, paper.color, paper.fontColor)
                                        }}>
                                            {paper.status}
                                        </span>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>

            {/* Global Search */}
            <div className="glass-card" style={{ display: 'flex', alignItems: 'center', padding: '0.75rem 1.5rem', marginBottom: '2rem' }}>
                <Search size={20} style={{ color: 'var(--text-secondary)', marginRight: '1rem' }} />
                <input
                    type="text"
                    placeholder="Search across all portfolios..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ background: 'transparent', border: 'none', color: 'white', width: '100%', outline: 'none', fontSize: '1rem' }}
                />
            </div>

            {/* Tables Area */}
            {renderTable(papers, "Research Portfolio", "papers", <BookOpen />)}
            {renderTable(projects, "Other Projects", "projects", <ExternalLink />)}

            {/* Generic Modal Overlay */}
            <AnimatePresence>
                {(isAddingMode || editingItem) && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
                        <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="glass-card modal-content" style={{ width: '100%', maxWidth: '550px', padding: '2.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                                <h2 style={{ fontSize: '1.5rem', color: 'var(--neon-cyan)' }}>
                                    {isAddingMode ? `Add to ${modalTarget === "papers" ? "Portfolio" : "Projects"}` : "Edit Entry"}
                                </h2>
                                <button onClick={() => { setIsAddingMode(false); setEditingItem(null); }} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>
                                    <X size={28} />
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.6rem' }}>Title</label>
                                    <textarea rows={3} value={isAddingMode ? newItem.title : editingItem?.title} onChange={(e) => isAddingMode ? setNewItem({ ...newItem, title: e.target.value }) : setEditingItem({ ...editingItem, title: e.target.value })} style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '1rem', color: 'white', fontFamily: 'inherit', outline: 'none' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.6rem' }}>Status</label>
                                    <input type="text" value={isAddingMode ? newItem.status : editingItem?.status} onChange={(e) => isAddingMode ? setNewItem({ ...newItem, status: e.target.value }) : setEditingItem({ ...editingItem, status: e.target.value })} style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '1rem', color: 'white', outline: 'none' }} />
                                </div>

                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--glass-border)', position: 'relative' }}>
                                            <input type="color" value={isAddingMode ? (newItem.color || "#00f2ff") : (editingItem?.color || "#00f2ff")} onChange={(e) => isAddingMode ? setNewItem({ ...newItem, color: e.target.value }) : setEditingItem({ ...editingItem, color: e.target.value })} style={{ position: 'absolute', top: '-50%', left: '-50%', width: '200%', height: '200%', border: 'none', cursor: 'pointer', background: 'none' }} />
                                        </div>
                                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: '600' }}>Badge BG</label>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--glass-border)', position: 'relative' }}>
                                            <input type="color" value={isAddingMode ? (newItem.fontColor || "#00f2ff") : (editingItem?.fontColor || "#00f2ff")} onChange={(e) => isAddingMode ? setNewItem({ ...newItem, fontColor: e.target.value }) : setEditingItem({ ...editingItem, fontColor: e.target.value })} style={{ position: 'absolute', top: '-50%', left: '-50%', width: '200%', height: '200%', border: 'none', cursor: 'pointer', background: 'none' }} />
                                        </div>
                                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: '600' }}>Font Color</label>
                                    </div>
                                </div>

                                <button className="btn-primary" style={{ width: '100%', padding: '1.25rem', justifyContent: 'center', borderRadius: '12px', fontSize: '1rem' }} onClick={isAddingMode ? handleAddItem : handleSaveEdit}>
                                    <Save size={20} /> {isAddingMode ? 'Add Entry' : 'Save Changes'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default App;
