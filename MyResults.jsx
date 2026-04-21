import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import ResultView from './ResultView';

function gradeColor(g) {
  if (g === 'A+' || g === 'A') return '#16a34a';
  if (g === 'B') return '#2563eb';
  if (g === 'C') return '#d97706';
  if (g === 'D') return '#ea580c';
  return '#dc2626';
}

export default function MyResults({ navigate }) {
  var store    = useStore();
  var [tab,        setTab]        = useState('exams');
  var [subs,       setSubs]       = useState([]);
  var [loading,    setLoading]    = useState(true);
  var [viewResult, setViewResult] = useState(null);
  var [practiceResults, setPracticeResults] = useState([]);

  useEffect(function() {
    store.loadSubmissions(store.currentUser.user_id).then(function(d) {
      setSubs(Array.isArray(d) ? d : []);
      setLoading(false);
    });
    // Load practice from localStorage — completely separate, never mixed into exam stats
    try {
      var pr = JSON.parse(localStorage.getItem('practice_results') || '[]');
      setPracticeResults(Array.isArray(pr) ? pr : []);
    } catch (e) { setPracticeResults([]); }
  }, []); // eslint-disable-line

  if (viewResult) {
    return React.createElement(ResultView, { submission: viewResult, onBack: function() { setViewResult(null); } });
  }

  // ── Exam-only stats (practice never included) ─────────────
  var examSubs   = subs.filter(function(s) { return s.status === 'submitted'; });
  var avgScore   = examSubs.length > 0
    ? Math.round(examSubs.reduce(function(a, s) { return a + (Number(s.total_score) || 0); }, 0) / examSubs.length)
    : 0;
  var bestSub    = examSubs.length > 0
    ? examSubs.reduce(function(b, s) { return (Number(s.total_score) || 0) > (Number(b.total_score) || 0) ? s : b; }, examSubs[0])
    : null;

  // ── Practice stats (separate) ─────────────────────────────
  var practiceAvg = practiceResults.length > 0
    ? Math.round(practiceResults.reduce(function(a, r) { return a + (r.score_pct || 0); }, 0) / practiceResults.length)
    : 0;

  if (loading) return <div className="loading-center"><div className="spinner"></div><span>Loading results...</span></div>;

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 20 }}>📊 My Results</div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        <button className={'tab-btn' + (tab === 'exams' ? ' active' : '')} onClick={function() { setTab('exams'); }}>📝 Exam Results ({examSubs.length})</button>
        <button className={'tab-btn' + (tab === 'practice' ? ' active' : '')} onClick={function() { setTab('practice'); }}>🎯 Practice Results ({practiceResults.length})</button>
      </div>

      {/* ── EXAM RESULTS TAB ── */}
      {tab === 'exams' && (
        <div>
          {/* Exam-only performance stats */}
          {examSubs.length > 0 && (
            <div className="stats-grid" style={{ marginBottom: 24 }}>
              <div className="stat-card">
                <div className="stat-value">{examSubs.length}</div>
                <div className="stat-label">Exams Completed</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--success)' }}>{avgScore}%</div>
                <div className="stat-label">Avg Score</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--accent)' }}>{bestSub ? (bestSub.grade || '-') : '-'}</div>
                <div className="stat-label">Best Grade</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--danger)' }}>
                  {subs.filter(function(s) { return s.cheating_detected === 1 || s.status === 'cheated'; }).length}
                </div>
                <div className="stat-label">Violations</div>
              </div>
            </div>
          )}

          {subs.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-title">No exam results yet</div><div style={{ color: 'var(--text3)', fontSize: '0.85rem', marginTop: 6 }}>Complete an exam to see your results here</div></div>
            : subs.map(function(s) {
              var scorePct = s.total_marks > 0 ? Math.round(((s.total_score || 0) / s.total_marks) * 100) : 0;
              var gc = gradeColor(s.grade);
              var isCheated = s.cheating_detected === 1 || s.status === 'cheated';
              var correctCount = s.correct_count != null ? s.correct_count : null;
              var wrongCount   = s.wrong_count   != null ? s.wrong_count   : null;
              return (
                <div key={s.submission_id} className="card" style={{ marginBottom: 12, borderLeft: '4px solid ' + (isCheated ? '#dc2626' : gc) }}>
                  {/* Horizontal layout: all info in one row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                    {/* Grade circle */}
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: isCheated?'#fee2e2':gc+'18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '2px solid ' + (isCheated?'#dc2626':gc) }}>
                      <span style={{ fontWeight: 900, fontSize: '1.2rem', color: isCheated?'#dc2626':gc }}>{s.grade || '-'}</span>
                    </div>
                    {/* Exam title + date */}
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 2 }}>{s.title || ('Exam #' + s.exam_id)}</div>
                      {s.submit_time && <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{new Date(s.submit_time).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>}
                    </div>
                    {/* Stats row */}
                    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: gc }}>{scorePct}%</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.total_score||0}/{s.total_marks} marks</div>
                      </div>
                      {correctCount != null && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#16a34a' }}>✓ {correctCount}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Correct</div>
                        </div>
                      )}
                      {wrongCount != null && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#dc2626' }}>✗ {wrongCount}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Wrong</div>
                        </div>
                      )}
                      {isCheated && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#dc2626' }}>🚫</div>
                          <div style={{ fontSize: '0.68rem', color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Violation</div>
                        </div>
                      )}
                    </div>
                    {/* Progress bar + action */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, minWidth: 120 }}>
                      <div style={{ width: 110, height: 6, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: scorePct+'%', background: isCheated?'#dc2626':gc, borderRadius: 3 }}/>
                      </div>
                      {!isCheated && (
                        <button className="btn btn-outline btn-sm" onClick={function() { setViewResult(s); }}>View Details →</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          }
        </div>
      )}

      {/* ── PRACTICE RESULTS TAB ── */}
      {tab === 'practice' && (
        <div>
          <div style={{ padding: '10px 14px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 8, marginBottom: 20, fontSize: '0.85rem', color: 'var(--accent)' }}>
            ℹ Practice results are stored locally and do <strong>not</strong> affect your exam performance or GPA.
          </div>

          {/* Practice-only stats */}
          {practiceResults.length > 0 && (
            <div className="stats-grid" style={{ marginBottom: 24 }}>
              <div className="stat-card">
                <div className="stat-value">{practiceResults.length}</div>
                <div className="stat-label">Sessions Done</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--accent)' }}>{practiceAvg}%</div>
                <div className="stat-label">Avg Practice Score</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{practiceResults.filter(function(r){return r.mode==='adaptive';}).length}</div>
                <div className="stat-label">Adaptive Sessions</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{practiceResults.filter(function(r){return r.mode==='viva';}).length}</div>
                <div className="stat-label">Viva Practice</div>
              </div>
            </div>
          )}

          {practiceResults.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">🎯</div><div className="empty-state-title">No practice sessions yet</div><div style={{ color: 'var(--text3)', fontSize: '0.85rem', marginTop: 6 }}>Complete a practice or viva practice session to see results here</div></div>
            : practiceResults.map(function(r, i) {
              var gc = gradeColor(r.grade);
              return (
                <div key={r.id || i} className="card" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{r.subject || 'Practice Session'}</span>
                        <span className={'badge badge-' + (r.mode === 'adaptive' ? 'primary' : r.mode === 'viva' ? 'warning' : 'info')}>
                          {r.mode === 'adaptive' ? '🎯 Adaptive' : r.mode === 'viva' ? '🎙 Viva Practice' : '📝 Standard'}
                        </span>
                        {r.difficulty && <span className="badge badge-info">{r.difficulty}</span>}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginBottom: 8 }}>
                        {r.correct}/{r.total_questions} correct · {r.score_pct}%
                        {r.elo && r.mode === 'adaptive' && <span style={{ marginLeft: 8 }}>ELO: {r.elo}</span>}
                        {r.date && <span style={{ marginLeft: 8 }}>{new Date(r.date).toLocaleDateString()}</span>}
                      </div>
                      {/* Progress bar */}
                      <div style={{ height: 5, background: 'var(--surface3)', borderRadius: 3, maxWidth: 300, overflow: 'hidden', marginBottom: r.analysis ? 12 : 0 }}>
                        <div style={{ height: '100%', width: (r.score_pct || 0) + '%', background: gc, borderRadius: 3 }}/>
                      </div>
                      {/* Inline analysis summary */}
                      {r.analysis && (
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ fontSize: '0.82rem', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>📊 View Analysis</summary>
                          <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 8, fontSize: '0.85rem' }}>
                            {r.analysis.overall_feedback && <p style={{ marginBottom: 10, color: 'var(--text2)' }}>{r.analysis.overall_feedback}</p>}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                              {r.analysis.strong_topics && r.analysis.strong_topics.length > 0 && (
                                <div><div style={{ fontWeight: 600, color: 'var(--success)', marginBottom: 4, fontSize: '0.78rem' }}>STRENGTHS</div>{r.analysis.strong_topics.map(function(t,j){return <div key={j} style={{color:'var(--text2)'}}>✅ {t}</div>;})}</div>
                              )}
                              {r.analysis.weak_topics && r.analysis.weak_topics.length > 0 && (
                                <div><div style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: 4, fontSize: '0.78rem' }}>NEEDS WORK</div>{r.analysis.weak_topics.map(function(t,j){return <div key={j} style={{color:'var(--text2)'}}>⚠️ {t}</div>;})}</div>
                              )}
                            </div>
                            {r.analysis.improvement_tips && r.analysis.improvement_tips.length > 0 && (
                              <div><div style={{ fontWeight: 600, marginBottom: 4, fontSize: '0.78rem' }}>TIPS</div>{r.analysis.improvement_tips.slice(0,3).map(function(t,j){return <div key={j} style={{color:'var(--text2)',marginBottom:3}}>{j+1}. {t}</div>;})}</div>
                            )}
                            {r.analysis.predicted_exam_readiness && (
                              <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--accent-glow)', borderRadius: 6, fontWeight: 600, color: 'var(--accent)', fontSize: '0.82rem' }}>
                                Exam Readiness: {r.analysis.predicted_exam_readiness}
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, marginLeft: 16, textAlign: 'center' }}>
                      <div style={{ fontWeight: 800, fontSize: '1.5rem', color: gc }}>{r.grade || '-'}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>{r.level || ''}</div>
                    </div>
                  </div>
                </div>
              );
            })
          }

          {practiceResults.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button className="btn btn-outline btn-sm"
                onClick={function() {
                  if (window.confirm('Clear all practice history? This cannot be undone.')) {
                    localStorage.removeItem('practice_results');
                    setPracticeResults([]);
                  }
                }}>
                🗑 Clear Practice History
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
