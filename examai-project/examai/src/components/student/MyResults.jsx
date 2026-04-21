import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import ResultView from './ResultView';
import { apiGet } from '../../utils/api';

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
  var [vivaResults,     setVivaResults]     = useState([]);
  var [vivaLoading,     setVivaLoading]     = useState(false);
  var [viewViva,        setViewViva]        = useState(null);

  useEffect(function() {
    store.loadSubmissions(store.currentUser.user_id).then(function(d) {
      setSubs(Array.isArray(d) ? d : []);
      setLoading(false);
    });
    try {
      var pr = JSON.parse(localStorage.getItem('practice_results') || '[]');
      setPracticeResults(Array.isArray(pr) ? pr : []);
    } catch (e) { setPracticeResults([]); }
    // Load viva results
    setVivaLoading(true);
    apiGet('/viva/my-results').then(function(d) {
      setVivaResults(Array.isArray(d) ? d : []);
      setVivaLoading(false);
    }).catch(function() { setVivaLoading(false); });
  }, []); // eslint-disable-line

  if (viewResult) {
    return React.createElement(ResultView, { submission: viewResult, onBack: function() { setViewResult(null); } });
  }

  if (viewViva) {
    var vr = viewViva;
    var rep = vr.ai_report ? (typeof vr.ai_report === 'string' ? JSON.parse(vr.ai_report) : vr.ai_report) : {};
    var answers = rep.answers || [];
    var gc0 = gradeColor(vr.grade);
    return (
      <div className="fade-up">
        <button className="btn btn-outline btn-sm" style={{ marginBottom: 18 }} onClick={function() { setViewViva(null); }}>← Back</button>
        <div className="page-title" style={{ marginBottom: 4 }}>🎙 Oral Viva — {vr.title}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginBottom: 20 }}>{vr.topic} · {new Date(vr.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>

        {/* Score card */}
        <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 28, borderLeft: '4px solid ' + gc0 }}>
          <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 900, fontSize: '3.5rem', color: gc0, lineHeight: 1 }}>{Math.round(vr.total_score || 0)}%</div>
          <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '1.8rem', color: gc0, marginTop: 4 }}>Grade {vr.grade}</div>
          <div style={{ color: 'var(--text3)', marginTop: 6 }}>{vr.correct_count || 0} correct / {vr.total_questions || answers.length} questions</div>
        </div>

        {/* AI Session Report */}
        {rep.overall_feedback && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: 1, marginBottom: 10, fontFamily: 'JetBrains Mono,monospace' }}>🤖 AI ANALYSIS</div>
            <div style={{ fontSize: '0.9rem', lineHeight: 1.75, color: 'var(--text2)', marginBottom: 14, padding: '10px 14px', background: 'var(--accent-glow)', borderRadius: 8 }}>{rep.overall_feedback}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              {rep.strong_areas && rep.strong_areas.length > 0 && (
                <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#16a34a', marginBottom: 6, fontFamily: 'JetBrains Mono,monospace' }}>STRONG AREAS</div>
                  {rep.strong_areas.map(function(s, i) { return <div key={i} style={{ fontSize: '0.82rem', color: '#166534' }}>✅ {s}</div>; })}
                </div>
              )}
              {rep.weak_areas && rep.weak_areas.length > 0 && (
                <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#dc2626', marginBottom: 6, fontFamily: 'JetBrains Mono,monospace' }}>WEAK AREAS</div>
                  {rep.weak_areas.map(function(s, i) { return <div key={i} style={{ fontSize: '0.82rem', color: '#991b1b' }}>⚠️ {s}</div>; })}
                </div>
              )}
            </div>
            {(rep.communication_score || rep.knowledge_score) && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {rep.communication_score && <div style={{ padding: '6px 14px', background: 'var(--surface2)', borderRadius: 7, fontSize: '0.82rem' }}>📢 Communication: <strong>{rep.communication_score}%</strong></div>}
                {rep.knowledge_score && <div style={{ padding: '6px 14px', background: 'var(--surface2)', borderRadius: 7, fontSize: '0.82rem' }}>🧠 Knowledge: <strong>{rep.knowledge_score}%</strong></div>}
                {rep.readiness && <div style={{ padding: '6px 14px', background: 'var(--surface2)', borderRadius: 7, fontSize: '0.82rem' }}>🎯 Readiness: <strong>{rep.readiness}</strong></div>}
              </div>
            )}
          </div>
        )}

        {/* Per-answer transcript */}
        {answers.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 12, fontFamily: 'JetBrains Mono,monospace' }}>📝 QUESTION-BY-QUESTION TRANSCRIPT</div>
            {answers.map(function(a, i) {
              var col = a.correct ? '#16a34a' : a.verdict === 'Partially Correct' ? '#d97706' : '#dc2626';
              return (
                <div key={i} className="card" style={{ marginBottom: 12, borderLeft: '4px solid ' + col }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Q{i + 1}. {a.question}</span>
                    <span style={{ fontWeight: 900, color: col, fontSize: '1.1rem', flexShrink: 0 }}>{a.score_pct}%</span>
                  </div>
                  <div style={{ padding: '7px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, fontSize: '0.85rem', marginBottom: 7, lineHeight: 1.65 }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text3)', fontFamily: 'JetBrains Mono,monospace', marginBottom: 3 }}>🎤 YOU SAID</div>
                    <em style={{ color: a.student_said === '(no answer)' ? '#9ca3af' : 'var(--text)' }}>{a.student_said || '(no answer)'}</em>
                  </div>
                  {a.model_answer && (
                    <div style={{ padding: '6px 10px', background: 'rgba(22,163,74,.06)', border: '1px solid rgba(22,163,74,.15)', borderRadius: 7, fontSize: '0.82rem', marginBottom: 7, color: 'var(--text2)' }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#16a34a', fontFamily: 'JetBrains Mono,monospace', marginBottom: 3 }}>📚 EXPECTED</div>
                      {a.model_answer}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ padding: '3px 10px', borderRadius: 20, background: a.correct ? '#dcfce7' : a.verdict === 'Partially Correct' ? '#fef3c7' : '#fee2e2', color: col, fontSize: '0.75rem', fontWeight: 700 }}>{a.verdict}</span>
                    {a.feedback && <span style={{ fontSize: '0.8rem', color: 'var(--text3)', flex: 1 }}>{a.feedback}</span>}
                  </div>
                  {a.missing && a.missing !== 'None' && <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#d97706' }}>⚠️ Missing: {a.missing}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* Raw transcript fallback */}
        {!answers.length && vr.full_transcript && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 10, fontFamily: 'JetBrains Mono,monospace' }}>📝 TRANSCRIPT</div>
            <pre style={{ fontSize: '0.82rem', color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{vr.full_transcript}</pre>
          </div>
        )}
      </div>
    );
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
        <button className={'tab-btn' + (tab === 'viva' ? ' active' : '')} onClick={function() { setTab('viva'); }}>🎙 Viva Results ({vivaResults.length})</button>
        <button className={'tab-btn' + (tab === 'practice' ? ' active' : '')} onClick={function() { setTab('practice'); }}>🎯 Practice ({practiceResults.length})</button>
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

      {/* ── VIVA RESULTS TAB ── */}
      {tab === 'viva' && (
        <div>
          {vivaLoading
            ? <div className="loading-center"><div className="spinner"></div><span>Loading viva results…</span></div>
            : vivaResults.length === 0
              ? <div className="empty-state"><div className="empty-state-icon">🎙</div><div className="empty-state-title">No viva results yet</div><div style={{ color: 'var(--text3)', fontSize: '0.85rem', marginTop: 6 }}>Your oral viva results will appear here after the examiner finalizes your session</div></div>
              : vivaResults.map(function(r) {
                var gc = gradeColor(r.grade);
                var rep = r.ai_report ? (typeof r.ai_report === 'string' ? JSON.parse(r.ai_report) : r.ai_report) : {};
                return (
                  <div key={r.result_id} className="card" style={{ marginBottom: 14, borderLeft: '4px solid ' + gc }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ width: 52, height: 52, borderRadius: '50%', background: gc + '18', border: '2px solid ' + gc, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ fontWeight: 900, fontSize: '1.2rem', color: gc }}>{r.grade || '-'}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 2 }}>🎙 {r.title || 'Oral Viva'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{r.topic || ''}{r.created_at ? ' · ' + new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: gc }}>{Math.round(r.total_score || 0)}%</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase' }}>Score</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#16a34a' }}>{r.correct_count || 0}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase' }}>Correct</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text2)' }}>{r.total_questions || 0}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase' }}>Questions</div>
                        </div>
                        {rep.readiness && <span style={{ padding: '3px 10px', borderRadius: 20, background: 'var(--accent-glow)', color: 'var(--accent)', fontSize: '0.72rem', fontWeight: 700 }}>{rep.readiness}</span>}
                      </div>
                      <button className="btn btn-outline btn-sm" onClick={function() { setViewViva(r); }}>View Details →</button>
                    </div>
                  </div>
                );
              })}
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
