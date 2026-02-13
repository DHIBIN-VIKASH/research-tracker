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
    X
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

const getStatusStyles = (status, excelColor, excelFontColor) => {
    const s = status.toLowerCase();

    let color = excelColor;
    let textColor = excelFontColor;

    const GREEN = '#00B050';
    const NEON_GREEN = '#00ff9d';

    // Rule 3: Eye-catching glowing terms (High Priority)
    const shouldGlow = s.includes('de recommendation') ||
        s.includes('eic decision') ||
        s.includes('awaiting approval decision') ||
        s.includes('almost published');

    // Rule 1 & 2: Excel Green matches FORCE both to green (No glow yet)
    const isExcelGreen = excelColor === GREEN || excelFontColor === GREEN;

    if (isExcelGreen || shouldGlow) {
        color = GREEN;
        textColor = shouldGlow ? NEON_GREEN : GREEN;
    }

    // Priority 3: Keyword overrides (if not already green)
    if (!color) {
        if (s.includes('european spine journal')) {
            color = '#3182ce';
            textColor = '#3182ce';
        } else if (s.includes('indian journal')) color = '#e53e3e';
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
        boxShadow: shouldGlow ? `0 0 15px ${color}44` : 'none',
        textShadow: shouldGlow ? `0 0 8px ${textColor}` : 'none',
        animation: shouldGlow ? 'pulse-glow 2s infinite' : 'none'
    };
};

const App = () => {
    const [papers, setPapers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [researcher] = useState({
        name: "Dr. DHIBIN VIKASH K P",
        credentials: "B.S., MBBS.",
        guide: "Dr. SATISH MUTHU",
        guideCredentials: "MBBS., MS (Ortho)., DNB (Ortho)., MNAMS., FISS (Spine Surg)., FESS (Spine Endoscopy)., FIRM (Regen Med)., FEIORA (Orth Rheumatology)., PhD"
    });
    const [searchTerm, setSearchTerm] = useState("");
    const [editingPaper, setEditingPaper] = useState(null);
    const [isAddingMode, setIsAddingMode] = useState(false);
    const [newPaper, setNewPaper] = useState({ title: "", status: "" });

    useEffect(() => {
        setLoading(true);
        const q = query(collection(db, "papers"), orderBy("id", "asc"));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const papersData = [];
            querySnapshot.forEach((doc) => {
                papersData.push({ ...doc.data(), firestoreId: doc.id });
            });
            setPapers(papersData);
            setLoading(false);
            setError(null);
        }, (err) => {
            console.error("Firestore error:", err);
            setError(`Firebase Error: ${err.message}. Check if Firestore is enabled and rules allow public access.`);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleDelete = async (firestoreId) => {
        try {
            await deleteDoc(doc(db, "papers", firestoreId));
        } catch (error) {
            console.error("Failed to delete paper:", error);
        }
    };

    const handleEdit = (paper) => {
        setEditingPaper({ ...paper });
    };

    const handleSaveEdit = async () => {
        try {
            const { firestoreId, ...paperData } = editingPaper;
            await updateDoc(doc(db, "papers", firestoreId), paperData);
            setEditingPaper(null);
        } catch (error) {
            console.error("Failed to update paper:", error);
        }
    };

    const handleAddPaper = async () => {
        if (newPaper.title.trim()) {
            try {
                const nextId = papers.length > 0 ? Math.max(...papers.map(p => p.id)) + 1 : 1;
                await addDoc(collection(db, "papers"), {
                    id: nextId,
                    title: newPaper.title,
                    status: newPaper.status || "Yet to start",
                    highlight: false
                });
                setNewPaper({ title: "", status: "" });
                setIsAddingMode(false);
            } catch (error) {
                console.error("Failed to add paper:", error);
            }
        }
    };

    const filteredPapers = papers.filter(p =>
        p.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.status?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const publishedPapers = papers.filter(p => p.status?.toLowerCase().includes('published'));
    const pendingPapers = filteredPapers.filter(p => !p.status?.toLowerCase().includes('published'));

    return (
        <div className="dashboard-container" style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
            {/* Header Section */}
            <motion.header
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card"
                style={{ padding: '1.5rem 2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
                <div>
                    <h1 className="neon-text" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Research Portfolio</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <User size={14} /> {researcher.name}, {researcher.credentials}
                    </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Guided by</p>
                    <h3 style={{ fontSize: '1rem', color: 'var(--neon-cyan)' }}>{researcher.guide}</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', maxWidth: '300px' }}>{researcher.guideCredentials}</p>
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

            {/* Published Works Hall of Fame */}
            <AnimatePresence>
                {publishedPapers.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="glass-card"
                        style={{
                            padding: '2rem',
                            marginBottom: '2rem',
                            background: 'linear-gradient(135deg, rgba(0, 242, 255, 0.1) 0%, rgba(128, 90, 213, 0.1) 100%)',
                            border: '1px solid var(--neon-cyan)'
                        }}
                    >
                        <h2 style={{ fontSize: '1.2rem', color: 'var(--neon-cyan)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <GraduationCap size={24} /> Published Works
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                            {publishedPapers.map(paper => (
                                <motion.div
                                    key={paper.firestoreId}
                                    layoutId={paper.firestoreId}
                                    className="glass-card"
                                    style={{ padding: '1.25rem', borderLeft: '4px solid var(--neon-cyan)' }}
                                >
                                    <h3 style={{ fontSize: '0.95rem', lineHeight: '1.4', marginBottom: '0.75rem' }}>{paper.title}</h3>
                                    <span style={{
                                        padding: '0.3rem 0.6rem',
                                        borderRadius: '4px',
                                        fontSize: '0.65rem',
                                        fontWeight: '800',
                                        ...getStatusStyles(paper.status, paper.color, paper.fontColor)
                                    }}>
                                        {paper.status}
                                    </span>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>

                {/* Stats / Quick Info */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ background: 'rgba(0, 242, 255, 0.1)', padding: '0.75rem', borderRadius: '12px', color: 'var(--neon-cyan)' }}>
                                <BookOpen size={24} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                    <div>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Papers</p>
                                        <h2 style={{ fontSize: '2rem', lineHeight: '1.2' }}>{papers.length} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>/ 50</span></h2>
                                    </div>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--neon-cyan)', fontWeight: '700' }}>{Math.round((papers.length / 50) * 100)}%</p>
                                </div>
                                <div className="progress-container" style={{ marginTop: '0.5rem' }}>
                                    <motion.div
                                        className="progress-fill"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${Math.min((papers.length / 50) * 100, 100)}%` }}
                                        transition={{ duration: 1, ease: "easeOut" }}
                                    />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Action Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                    <div className="glass-card" style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0.5rem 1rem', maxWidth: '400px' }}>
                        <Search size={18} style={{ color: 'var(--text-secondary)', marginRight: '0.5rem' }} />
                        <input
                            type="text"
                            placeholder="Search papers or status..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ background: 'transparent', border: 'none', color: 'white', width: '100%', outline: 'none' }}
                        />
                    </div>
                    <button className="btn-primary" onClick={() => setIsAddingMode(true)}>
                        <Plus size={18} /> New Publication
                    </button>
                </div>

                {/* Table Section */}
                <motion.div
                    layout
                    className="glass-card"
                    style={{ overflow: 'hidden' }}
                >
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                                    <th style={{ padding: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>ID</th>
                                    <th style={{ padding: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Publication Title</th>
                                    <th style={{ padding: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Journal Status</th>
                                    <th style={{ padding: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <AnimatePresence>
                                    {pendingPapers.map((paper, index) => (
                                        <motion.tr
                                            key={paper.firestoreId}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            transition={{ delay: index * 0.05 }}
                                            className={paper.highlight ? 'row-highlight' : ''}
                                            style={{ borderBottom: '1px solid var(--glass-border)' }}
                                            whileHover={{ background: 'rgba(255,255,255,0.02)' }}
                                        >
                                            <td style={{ padding: '1.25rem', color: 'var(--neon-cyan)', fontWeight: '600' }}>#{paper.id}</td>
                                            <td style={{ padding: '1.25rem', maxWidth: '500px' }}>{paper.title}</td>
                                            <td style={{ padding: '1.25rem' }}>
                                                <span style={{
                                                    padding: '0.4rem 0.8rem',
                                                    borderRadius: '6px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: '800',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.05em',
                                                    display: 'inline-block',
                                                    whiteSpace: 'nowrap',
                                                    ...getStatusStyles(paper.status, paper.color, paper.fontColor)
                                                }}>
                                                    {paper.status}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1.25rem', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                    <button
                                                        onClick={() => handleEdit(paper)}
                                                        style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.5rem' }}
                                                    >
                                                        <Edit3 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(paper.firestoreId)}
                                                        style={{ background: 'transparent', border: 'none', color: '#ff4d4d', cursor: 'pointer', padding: '0.5rem' }}
                                                    >
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

            {/* Add/Edit Modal Overlay */}
            <AnimatePresence>
                {(isAddingMode || editingPaper) && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed',
                            top: 0, left: 0, right: 0, bottom: 0,
                            background: 'rgba(0,0,0,0.8)',
                            backdropFilter: 'blur(8px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 1000,
                            padding: '1rem'
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            className="glass-card"
                            style={{ width: '100%', maxWidth: '500px', padding: '2rem' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                                <h2 style={{ fontSize: '1.5rem' }}>{isAddingMode ? 'Add New Paper' : 'Edit Publication'}</h2>
                                <button
                                    onClick={() => { setIsAddingMode(false); setEditingPaper(null); }}
                                    style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>Publication Title</label>
                                    <textarea
                                        rows={3}
                                        value={isAddingMode ? newPaper.title : editingPaper?.title}
                                        onChange={(e) => isAddingMode ? setNewPaper({ ...newPaper, title: e.target.value }) : setEditingPaper({ ...editingPaper, title: e.target.value })}
                                        style={{
                                            width: '100%',
                                            background: 'rgba(0,0,0,0.3)',
                                            border: '1px solid var(--glass-border)',
                                            borderRadius: '8px',
                                            padding: '0.75rem',
                                            color: 'white',
                                            fontFamily: 'inherit'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>Journal Status</label>
                                    <input
                                        type="text"
                                        value={isAddingMode ? newPaper.status : editingPaper?.status}
                                        onChange={(e) => isAddingMode ? setNewPaper({ ...newPaper, status: e.target.value }) : setEditingPaper({ ...editingPaper, status: e.target.value })}
                                        style={{
                                            width: '100%',
                                            background: 'rgba(0,0,0,0.3)',
                                            border: '1px solid var(--glass-border)',
                                            borderRadius: '8px',
                                            padding: '0.75rem',
                                            color: 'white'
                                        }}
                                    />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.7rem', marginBottom: '0.5rem' }}>Badge BG Color</label>
                                        <input
                                            type="color"
                                            value={isAddingMode ? (newPaper.color || "#00f2ff") : (editingPaper?.color || "#00f2ff")}
                                            onChange={(e) => isAddingMode ? setNewPaper({ ...newPaper, color: e.target.value }) : setEditingPaper({ ...editingPaper, color: e.target.value })}
                                            style={{ width: '100%', height: '40px', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.7rem', marginBottom: '0.5rem' }}>Badge Font Color</label>
                                        <input
                                            type="color"
                                            value={isAddingMode ? (newPaper.fontColor || "#00f2ff") : (editingPaper?.fontColor || "#00f2ff")}
                                            onChange={(e) => isAddingMode ? setNewPaper({ ...newPaper, fontColor: e.target.value }) : setEditingPaper({ ...editingPaper, fontColor: e.target.value })}
                                            style={{ width: '100%', height: '40px', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                        />
                                    </div>
                                </div>

                                <button
                                    className="btn-primary"
                                    style={{ width: '100%', padding: '1rem', justifyContent: 'center' }}
                                    onClick={isAddingMode ? handleAddPaper : handleSaveEdit}
                                >
                                    <Save size={18} /> {isAddingMode ? 'Add Publication' : 'Save Changes'}
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
