import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';

var GRADE_COLORS = { 'A+':'#16a34a', A:'#16a34a', B:'#2563eb', C:'#d97706', D:'#ea580c', F:'#dc2626' };
function gc(g) { return GRADE_COLORS[g] || '#6b7280'; }
function gb(g) { return g==='A+'||g==='A'?'#dcfce7':g==='B'?'#dbeafe':g==='C'?'#fef3c7':g==='D'?'#ffedd5':'#fee2e2'; }
function fmt(d) { return d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'; }

export default function Analytics() {
  var store   = useStore();
  var [stats,   setStats]   = useState(null);
  var [loading, setLoading] = useState(true);
  var [tab,     setTab]     = useState('overview');
  var [selExamTab, setSelExamTab] = useState(null);          // overview | exams | students
  var [selExam, setSelExam] = useState(null);               // exam_id filter for student tab

  useEffect(function() {
    store.loadAnalytics()
      .then(function(d) { setStats(d); setLoading(false); })
      .catch(function() { setLoading(false); });
  }, []); // eslint-disable-line

  if (loading) return <div className="loading-center"><div className="spinner"></div><span>Loading analytics…</span></div>;
  if (!stats)  return <div className="empty-state"><div className="empty-state-title">No analytics data</div></div>;

  var total = stats.total_submissions || 1;

  // Group student_exam_detail by exam for exam-wise view
  var detail = stats.student_exam_detail || [];

  // Exams list from submissions array (has avg_score, violation_count, passed_count)
  var examList = stats.submissions || [];

  // All unique exams for filter
  var examOptions = examList.map(function(e) { return { id: e.exam_id, title: e.title }; });

  // Student rows filtered by selected exam
  var studentRows = selExam
    ? detail.filter(function(r) { return r.exam_id === selExam; })
    : detail;

  // Violations-only rows
  var violationRows = detail.filter(function(r) {
    return r.cheating_detected === 1 || r.status === 'cheated';
  });

  return (
    <div className="fade-up">

      {/* ── Page header ── */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <div className="page-title">📈 Analytics</div>
        </div>
      </div>

      {/* ── Top stats ── */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-value">{stats.total_students}</div>
          <div className="stat-label">Students</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.total_exams}</div>
          <div className="stat-label">Exams</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.total_submissions}</div>
          <div className="stat-label">Submissions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color:'var(--success)' }}>{stats.avg_score}%</div>
          <div className="stat-label">Average Score</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color:'var(--danger)' }}>{stats.cheated_count || 0}</div>
          <div className="stat-label">Violations</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        {[
          { k:'overview', l:'📊 Overview' },
          { k:'exams',    l:'📝 Exam-wise Analysis' },
          { k:'conduct',  l:'🚫 Misconduct' },
        ].map(function(t) {
          return <button key={t.k} className={'tab-btn'+(tab===t.k?' active':'')} onClick={function(){setTab(t.k);}}>{t.l}</button>;
        })}
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB: OVERVIEW
         ══════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>

          {/* Grade distribution */}
          <div className="card">
            <div className="card-title" style={{ marginBottom:16 }}>📊 Grade Distribution</div>
            {(stats.grade_distribution || []).length === 0
              ? <div style={{ color:'var(--text3)', fontSize:'0.85rem' }}>No grades yet</div>
              : (stats.grade_distribution || []).map(function(g) {
                var pct = Math.round((g.count / total) * 100);
                return (
                  <div key={g.grade} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                    <span style={{ width:32, height:32, borderRadius:8, background:gb(g.grade), display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'0.85rem', color:gc(g.grade), flexShrink:0 }}>{g.grade}</span>
                    <div style={{ flex:1 }}>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width:pct+'%', background:gc(g.grade) }}/>
                      </div>
                    </div>
                    <span style={{ fontSize:'0.85rem', fontWeight:700, color:gc(g.grade), minWidth:28, textAlign:'right' }}>{g.count}</span>
                    <span style={{ fontSize:'0.72rem', color:'var(--text3)', minWidth:36 }}>{pct}%</span>
                  </div>
                );
              })
            }
          </div>

          {/* Recent submissions */}
          <div className="card">
            <div className="card-title" style={{ marginBottom:16 }}>🕐 Recent Submissions</div>
            {(stats.recent_submissions || []).length === 0
              ? <div style={{ color:'var(--text3)', fontSize:'0.85rem' }}>No submissions yet</div>
              : (stats.recent_submissions || []).map(function(s, i) {
                var isCheated = s.cheating_detected === 1 || s.status === 'cheated';
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:'0.88rem' }}>{s.name}</div>
                      <div style={{ fontSize:'0.75rem', color:'var(--text3)' }}>{s.title}</div>
                    </div>
                    {isCheated
                      ? <span className="badge badge-danger">🚫 Cheated</span>
                      : <span style={{ fontWeight:800, color:gc(s.grade), fontSize:'0.95rem' }}>{s.grade || '—'}</span>
                    }
                  </div>
                );
              })
            }
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: EXAM-WISE ANALYSIS
         ══════════════════════════════════════════════════════ */}
      {tab === 'exams' && (
        <div>
          {examList.length === 0
            ? <div className="empty-state"><div className="empty-state-title">No exams with submissions yet</div></div>
            : <div>
              {/* Horizontal exam tabs */}
              <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4, marginBottom:20, scrollbarWidth:'none' }}>
                {examList.map(function(e) {
                  var isSel = (selExamTab||examList[0]).exam_id === e.exam_id;
                  return (
                    <button key={e.exam_id} onClick={function(){setSelExamTab(e);}}
                      style={{ padding:'8px 16px', borderRadius:20, border:'2px solid '+(isSel?'var(--accent)':'var(--border)'), background:isSel?'var(--accent-glow)':'var(--surface)', color:isSel?'var(--accent)':'var(--text3)', fontWeight:isSel?700:400, whiteSpace:'nowrap', cursor:'pointer', fontSize:'0.85rem', flexShrink:0 }}>
                      {e.title}
                    </button>
                  );
                })}
              </div>
              {/* Show selected exam */}
              {[selExamTab||examList[0]].map(function(exam) {
              var passRate = exam.submission_count > 0
                ? Math.round((exam.passed_count / exam.submission_count) * 100) : 0;
              var avgPct = exam.total_marks > 0
                ? Math.round(((exam.avg_score || 0) / exam.total_marks) * 100) : 0;
              var gc2 = avgPct >= 80 ? '#16a34a' : avgPct >= 50 ? '#d97706' : '#dc2626';

              // Students who took this exam
              var examStudents = detail.filter(function(r) { return r.exam_id === exam.exam_id; });

              return (
                <div key={exam.exam_id} className="card" style={{ marginBottom:20 }}>
                  {/* Exam header */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:12 }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:'1.1rem', color:'var(--text)', marginBottom:4 }}>{exam.title}</div>
                      <div style={{ fontSize:'0.78rem', color:'var(--text3)' }}>{exam.total_marks} marks total</div>
                    </div>
                    <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
                      {[
                        { label:'Submissions',  val: exam.submission_count,                  color:'var(--accent)' },
                        { label:'Avg Score',     val: (exam.avg_score||0)+' / '+exam.total_marks, color:gc2 },
                        { label:'Pass Rate',     val: passRate+'%',                            color: passRate>=50?'#16a34a':'#dc2626' },
                        { label:'Violations',    val: exam.violation_count||0,                  color: exam.violation_count>0?'#dc2626':'#16a34a' },
                      ].map(function(st) {
                        return (
                          <div key={st.label} style={{ textAlign:'center' }}>
                            <div style={{ fontWeight:800, fontSize:'1.2rem', color:st.color }}>{st.val}</div>
                            <div style={{ fontSize:'0.68rem', color:'var(--text3)', textTransform:'uppercase', letterSpacing:0.5 }}>{st.label}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ height:6, background:'var(--surface3)', borderRadius:3, overflow:'hidden', marginBottom:16 }}>
                    <div style={{ height:'100%', width:avgPct+'%', background:'linear-gradient(90deg,'+gc2+'88,'+gc2+')', borderRadius:3, transition:'width .5s' }}/>
                  </div>

                  {/* Per-student rows for this exam */}
                  {examStudents.length > 0 && (
                    <div>
                      <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:1, marginBottom:10, fontFamily:'JetBrains Mono,monospace' }}>Student Results</div>
                      {/* Header */}
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 80px 70px 70px 70px 80px 80px', gap:8, padding:'5px 10px', background:'var(--surface2)', borderRadius:6, marginBottom:4, fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:0.5 }}>
                        <span>Student</span>
                        <span style={{textAlign:'center'}}>Score</span>
                        <span style={{textAlign:'center'}}>Grade</span>
                        <span style={{textAlign:'center',color:'#16a34a'}}>✓ Right</span>
                        <span style={{textAlign:'center',color:'#dc2626'}}>✗ Wrong</span>
                        <span style={{textAlign:'center'}}>Date</span>
                        <span style={{textAlign:'center'}}>Status</span>
                      </div>
                      {examStudents.map(function(r, i) {
                        var isCheated = r.cheating_detected === 1 || r.status === 'cheated';
                        var pct = r.total_marks > 0 ? Math.round(((r.total_score||0)/r.total_marks)*100) : 0;
                        var gradeCol = gc(r.grade);
                        return (
                          <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 80px 70px 70px 70px 80px 80px', gap:8, padding:'8px 10px', borderBottom:'1px solid var(--border)', alignItems:'center', background: isCheated?'rgba(220,38,38,.03)':'transparent', borderLeft: isCheated?'3px solid #dc2626':'3px solid transparent', borderRadius:4 }}>
                            <div>
                              <div style={{ fontWeight:600, fontSize:'0.85rem' }}>{r.student_name}</div>
                              <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>{r.email}</div>
                            </div>
                            <div style={{ textAlign:'center' }}>
                              <div style={{ fontWeight:700, fontSize:'0.88rem', color:gradeCol }}>{r.total_score||0}/{r.total_marks}</div>
                              <div style={{ fontSize:'0.68rem', color:'var(--text3)' }}>{pct}%</div>
                            </div>
                            <div style={{ textAlign:'center' }}>
                              <span style={{ fontWeight:800, fontSize:'1rem', color:gradeCol }}>{isCheated?'—':r.grade||'—'}</span>
                            </div>
                            <div style={{ textAlign:'center', fontWeight:700, color:'#16a34a' }}>{r.correct_count||0}</div>
                            <div style={{ textAlign:'center', fontWeight:700, color:'#dc2626' }}>{r.wrong_count||0}</div>
                            <div style={{ textAlign:'center', fontSize:'0.72rem', color:'var(--text3)' }}>{fmt(r.submit_time)}</div>
                            <div style={{ textAlign:'center' }}>
                              {isCheated
                                ? <span className="badge badge-danger" style={{fontSize:'0.62rem'}}>🚫 Cheated</span>
                                : <span className="badge badge-success" style={{fontSize:'0.62rem'}}>✅ Done</span>
                              }
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          }
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: STUDENT PERFORMANCE
         ══════════════════════════════════════════════════════ */}
      {tab === 'students' && (
        <div>
          {/* Filter by exam */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:18 }}>
            <button className={'pill'+(selExam===null?' active':'')} onClick={function(){setSelExam(null);}}>All Exams</button>
            {examOptions.map(function(e) {
              return <button key={e.id} className={'pill'+(selExam===e.id?' active':'')} onClick={function(){setSelExam(e.id);}}>{e.title}</button>;
            })}
          </div>

          {studentRows.length === 0
            ? <div className="empty-state"><div className="empty-state-title">No submissions</div></div>
            : (
              <div>
                {/* Table header */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 160px 90px 80px 80px 80px 90px 100px', gap:8, padding:'8px 14px', background:'var(--surface2)', borderRadius:8, marginBottom:4, fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:0.5 }}>
                  <span>Student</span>
                  <span>Exam</span>
                  <span style={{textAlign:'center'}}>Score</span>
                  <span style={{textAlign:'center'}}>Grade</span>
                  <span style={{textAlign:'center',color:'#16a34a'}}>✓ Correct</span>
                  <span style={{textAlign:'center',color:'#dc2626'}}>✗ Wrong</span>
                  <span style={{textAlign:'center'}}>Date</span>
                  <span style={{textAlign:'center'}}>Status</span>
                </div>
                {studentRows.map(function(r, i) {
                  var isCheated = r.cheating_detected === 1 || r.status === 'cheated';
                  var pct = r.total_marks > 0 ? Math.round(((r.total_score||0)/r.total_marks)*100) : 0;
                  var gradeCol = gc(r.grade);
                  return (
                    <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 160px 90px 80px 80px 80px 90px 100px', gap:8, padding:'10px 14px', background:'var(--surface)', borderRadius:8, marginBottom:6, border:'1px solid var(--border)', alignItems:'center', borderLeft:'3px solid '+(isCheated?'#dc2626':gradeCol) }}>
                      <div>
                        <div style={{ fontWeight:600, fontSize:'0.88rem' }}>{r.student_name}</div>
                        <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>{r.email}</div>
                      </div>
                      <div style={{ fontSize:'0.8rem', color:'var(--text2)', fontWeight:500 }}>{r.exam_title}</div>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontWeight:700, fontSize:'0.9rem', color:gradeCol }}>{r.total_score||0}/{r.total_marks}</div>
                        <div style={{ fontSize:'0.68rem', color:'var(--text3)' }}>{pct}%</div>
                      </div>
                      <div style={{ textAlign:'center', fontWeight:900, fontSize:'1.05rem', color:gradeCol }}>{isCheated?'—':r.grade||'—'}</div>
                      <div style={{ textAlign:'center', fontWeight:700, color:'#16a34a' }}>
                        <div style={{ fontSize:'1rem' }}>{r.correct_count||0}</div>
                        <div style={{ fontSize:'0.65rem', color:'var(--text3)' }}>/{r.total_questions||0}</div>
                      </div>
                      <div style={{ textAlign:'center', fontWeight:700, color:'#dc2626' }}>
                        <div style={{ fontSize:'1rem' }}>{r.wrong_count||0}</div>
                        <div style={{ fontSize:'0.65rem', color:'var(--text3)' }}>/{r.total_questions||0}</div>
                      </div>
                      <div style={{ fontSize:'0.72rem', color:'var(--text3)', textAlign:'center' }}>{fmt(r.submit_time)}</div>
                      <div style={{ textAlign:'center' }}>
                        {isCheated
                          ? <span className="badge badge-danger" style={{fontSize:'0.62rem'}}>🚫 Cheated</span>
                          : <span className="badge badge-success" style={{fontSize:'0.62rem'}}>✅ Done</span>
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: MISCONDUCT
         ══════════════════════════════════════════════════════ */}
      {tab === 'conduct' && (
        <div>
          <div style={{ padding:'12px 16px', background:'rgba(220,38,38,.06)', border:'1px solid rgba(220,38,38,.2)', borderRadius:8, marginBottom:20, fontSize:'0.85rem', color:'var(--danger)', display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:'1.2rem' }}>🚫</span>
            <div><strong>{violationRows.length}</strong> misconduct record{violationRows.length !== 1 ? 's' : ''} found — exam automatically scored zero in each case.</div>
          </div>

          {violationRows.length === 0
            ? <div className="empty-state">
                <div style={{ fontSize:'3rem', marginBottom:12 }}>✅</div>
                <div className="empty-state-title">No misconduct recorded</div>
                <div style={{ color:'var(--text3)', fontSize:'0.85rem', marginTop:6 }}>All students have maintained academic integrity.</div>
              </div>
            : violationRows.map(function(r, i) {
              return (
                <div key={i} className="card" style={{ marginBottom:12, borderLeft:'4px solid #dc2626', background:'rgba(220,38,38,.02)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
                    {/* Student */}
                    <div style={{ flex:1, minWidth:140 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:36, height:36, borderRadius:'50%', background:'#fee2e2', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:'#dc2626', fontSize:'0.9rem', flexShrink:0 }}>
                          {(r.student_name||'S').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight:700, fontSize:'0.95rem' }}>{r.student_name}</div>
                          <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>{r.email}</div>
                        </div>
                      </div>
                    </div>
                    {/* Exam */}
                    <div style={{ flex:1, minWidth:120 }}>
                      <div style={{ fontSize:'0.72rem', color:'var(--text3)', textTransform:'uppercase', letterSpacing:0.5, marginBottom:3 }}>Exam</div>
                      <div style={{ fontWeight:600, fontSize:'0.88rem' }}>{r.exam_title}</div>
                    </div>
                    {/* Score = 0 */}
                    <div style={{ textAlign:'center', minWidth:70 }}>
                      <div style={{ fontWeight:800, fontSize:'1.3rem', color:'#dc2626' }}>0</div>
                      <div style={{ fontSize:'0.65rem', color:'var(--text3)', textTransform:'uppercase' }}>Score</div>
                    </div>
                    {/* Date */}
                    <div style={{ textAlign:'center', minWidth:90 }}>
                      <div style={{ fontSize:'0.8rem', color:'var(--text2)' }}>{fmt(r.submit_time)}</div>
                      <div style={{ fontSize:'0.65rem', color:'var(--text3)', textTransform:'uppercase' }}>Date</div>
                    </div>
                    {/* Badge */}
                    <div>
                      <span className="badge badge-danger" style={{ padding:'6px 14px', fontSize:'0.75rem' }}>🚫 Exam Misconduct</span>
                    </div>
                  </div>
                </div>
              );
            })
          }
        </div>
      )}
    </div>
  );
}
