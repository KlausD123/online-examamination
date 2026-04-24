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
  var [tab,             setTab]             = useState('exams');
  var [subs,            setSubs]            = useState([]);
  var [loading,         setLoading]         = useState(true);
  var [viewResult,      setViewResult]      = useState(null);
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
    setVivaLoading(true);
    apiGet('/viva/my-results').then(function(d) {
      setVivaResults(Array.isArray(d) ? d : []);
      setVivaLoading(false);
    }).catch(function() { setVivaLoading(false); });
  }, []); // eslint-disable-line

  if (viewResult) {
    return React.createElement(ResultView, { submission: viewResult, onBack: function() { setViewResult(null); } });
  }

  // ── Viva detail view ──────────────────────────────────────────────────────
  if (viewViva) {
    var vr = viewViva;
    var rep = vr.ai_report ? (typeof vr.ai_report === 'string' ? JSON.parse(vr.ai_report) : vr.ai_report) : {};
    var answers = rep.answers || [];
    var gc0 = gradeColor(vr.grade);
    return (
      <div className="fade-up">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={function() { setViewViva(null); }}>← Back</button>
          <div className="page-title" style={{ marginBottom: 4 }}>🎙 Oral Viva — {vr.title}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          <div className="stat-card"><div className="stat-value" style={{ color: gc0 }}>{vr.grade || '-'}</div><div className="stat-label">Grade</div></div>
          <div className="stat-card"><div className="stat-value">{vr.total_score || 0}%</div><div className="stat-label">Score</div></div>
          <div className="stat-card"><div className="stat-value">{vr.correct_count || 0}/{vr.total_questions || 0}</div><div className="stat-label">Correct</div></div>
        </div>
        {rep.overall_feedback && (
          <div className="card" style={{ marginBottom: 16, background: 'var(--accent-glow)', border: '1px solid var(--accent-border)' }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--accent)' }}>📋 Overall Feedback</div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text2)', lineHeight: 1.6 }}>{rep.overall_feedback}</div>
          </div>
        )}
        {answers.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Question Breakdown</div>
            {answers.map(function(a, i) {
              var gc2 = a.correct ? '#16a34a' : '#dc2626';
              return (
                <div key={i} className="card" style={{ marginBottom: 10, borderLeft: '4px solid ' + gc2 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Q{i+1}: {a.question}</div>
                  {a.student_said && <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginBottom: 4 }}>You said: {a.student_said}</div>}
                  {a.feedback && <div style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>{a.feedback}</div>}
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: gc2 }}>{a.verdict || (a.correct ? 'Correct' : 'Incorrect')} — {a.score_pct || 0}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Main results view ──────────────────────────────────────────────────────
  var practiceAvg = practiceResults.length > 0
    ? Math.round(practiceResults.reduce(function(a, r) { return a + (r.score_pct || 0); }, 0) / practiceResults.length)
    : 0;

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 20 }}>📊 My Results</div>

      {/* Tabs */}
      <div className="filter-pills" style={{ marginBottom: 20 }}>
        <button className={'pill' + (tab==='exams'    ? ' active' : '')} onClick={function(){setTab('exams');}}>📝 Exams</button>
        <button className={'pill' + (tab==='viva'     ? ' active' : '')} onClick={function(){setTab('viva');}}>🎙 Viva</button>
        <button className={'pill' + (tab==='practice' ? ' active' : '')} onClick={function(){setTab('practice');}}>🎯 Practice</button>
      </div>

      {/* Exams tab */}
      {tab === 'exams' && (
        <div>
          {loading ? <div className="loading-center"><div className="spinner"/></div>
            : subs.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">📝</div><div className="empty-state-title">No exam results yet</div></div>
            : subs.map(function(s, i) {
                var gc = gradeColor(s.grade);
                return (
                  <div key={s.submission_id || i} className="card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={function() { setViewResult(s); }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{s.title || 'Exam'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>
                          {s.correct_count !== undefined ? s.correct_count + '/' + s.total_questions + ' correct' : ''}
                          {s.submit_time && <span style={{ marginLeft: 8 }}>{new Date(s.submit_time).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 800, fontSize: '1.5rem', color: gc }}>{s.grade || '-'}</div>
                        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: '0.85rem', fontWeight: 700 }}>{Number(s.total_score||0).toFixed(1)}%</div>
                      </div>
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* Viva tab */}
      {tab === 'viva' && (
        <div>
          {vivaLoading ? <div className="loading-center"><div className="spinner"/></div>
            : vivaResults.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">🎙</div><div className="empty-state-title">No viva results yet</div></div>
            : vivaResults.map(function(vr, i) {
                var gc = gradeColor(vr.grade);
                return (
                  <div key={vr.viva_id || i} className="card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={function() { setViewViva(vr); }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{vr.title || 'Viva Session'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>
                          {vr.correct_count || 0}/{vr.total_questions || 0} correct
                          {vr.created_at && <span style={{ marginLeft: 8 }}>{new Date(vr.created_at).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 800, fontSize: '1.5rem', color: gc }}>{vr.grade || '-'}</div>
                        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: '0.85rem', fontWeight: 700 }}>{vr.total_score || 0}%</div>
                      </div>
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* Practice tab */}
      {tab === 'practice' && (
        <div>
          {practiceResults.length > 0 && (
            <div className="stats-grid" style={{ marginBottom: 20 }}>
              <div className="stat-card"><div className="stat-value">{practiceResults.length}</div><div className="stat-label">Sessions</div></div>
              <div className="stat-card"><div className="stat-value" style={{ color: 'var(--accent)' }}>{practiceAvg}%</div><div className="stat-label">Avg Score</div></div>
              <div className="stat-card"><div className="stat-value">{practiceResults.filter(function(r){return r.mode==='adaptive';}).length}</div><div className="stat-label">Adaptive</div></div>
              <div className="stat-card"><div className="stat-value">{practiceResults.filter(function(r){return r.mode==='viva';}).length}</div><div className="stat-label">Viva Practice</div></div>
            </div>
          )}
          {practiceResults.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">🎯</div><div className="empty-state-title">No practice sessions yet</div></div>
            : practiceResults.map(function(r, i) {
                var gc = gradeColor(r.grade);
                return (
                  <div key={r.id || i} className="card" style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700 }}>{r.subject || 'Practice Session'}</span>
                          <span className={'badge badge-' + (r.mode==='adaptive'?'primary':r.mode==='viva'?'warning':'info')}>
                            {r.mode==='adaptive'?'🎯 Adaptive':r.mode==='viva'?'🎙 Viva Practice':'📝 Standard'}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginBottom: 8 }}>
                          {r.correct}/{r.total_questions} correct · {r.score_pct}%
                          {r.date && <span style={{ marginLeft: 8 }}>{new Date(r.date).toLocaleDateString()}</span>}
                        </div>
                        <div style={{ height: 5, background: 'var(--surface3)', borderRadius: 3, maxWidth: 300, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: (r.score_pct||0)+'%', background: gc, borderRadius: 3 }}/>
                        </div>
                        {r.analysis && (
                          <details style={{ marginTop: 8 }}>
                            <summary style={{ fontSize: '0.82rem', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>📊 View Analysis</summary>
                            <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 8, fontSize: '0.85rem' }}>
                              {r.analysis.overall_feedback && <p style={{ marginBottom: 8, color: 'var(--text2)' }}>{r.analysis.overall_feedback}</p>}
                              {r.analysis.predicted_exam_readiness && (
                                <div style={{ padding: '4px 8px', background: 'var(--accent-glow)', borderRadius: 6, fontWeight: 600, color: 'var(--accent)', fontSize: '0.8rem', display: 'inline-block' }}>
                                  Readiness: {r.analysis.predicted_exam_readiness}
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, marginLeft: 16, textAlign: 'center' }}>
                        <div style={{ fontWeight: 800, fontSize: '1.5rem', color: gc }}>{r.grade || '-'}</div>
                      </div>
                    </div>
                  </div>
                );
              })
          }
          {practiceResults.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button className="btn btn-outline btn-sm" onClick={function() {
                if (window.confirm('Clear all practice history?')) { localStorage.removeItem('practice_results'); setPracticeResults([]); }
              }}>🗑 Clear Practice History</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
