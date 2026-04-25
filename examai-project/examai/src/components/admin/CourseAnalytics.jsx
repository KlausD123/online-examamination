import React, { useState, useEffect } from 'react';
import { apiGet } from '../../utils/api';
import { getGradeColor } from '../../utils/helpers';

export default function CourseAnalytics() {
  var [courses,    setCourses]    = useState([]);
  var [selected,   setSelected]   = useState(null);
  var [stats,      setStats]      = useState(null);
  var [leaderboard,setLeaderboard]= useState([]);
  var [loading,    setLoading]    = useState(true);
  var [statsLoading,setStatsLoading]= useState(false);

  useEffect(function() {
    apiGet('/courses').then(function(d) {
      setCourses(d||[]);
      setLoading(false);
      if (d && d.length > 0) loadStats(d[0]);
    }).catch(function(){ setLoading(false); });
  }, []); // eslint-disable-line

  async function loadStats(course) {
    setSelected(course); setStatsLoading(true); setStats(null); setLeaderboard([]);
    try {
      var [members, exams, lb] = await Promise.all([
        apiGet('/courses/' + course.course_id + '/members'),
        apiGet('/exams'),
        apiGet('/exams/course/' + course.course_id + '/leaderboard').catch(function(){return[];}),
      ]);
      var courseExams = (exams||[]).filter(function(e){ return String(e.course_id)===String(course.course_id); });
      var totalSubs = courseExams.reduce(function(a,e){ return a + (e.submission_count||0); }, 0);
      var avgScore = lb && lb.length > 0 ? (lb.reduce(function(a,s){ return a + Number(s.avg_score||0); },0)/lb.length).toFixed(1) : '-';
      setStats({ members: members||[], exams: courseExams, totalSubs, avgScore });
      setLeaderboard(lb||[]);
    } catch(e) { setStats({ members:[], exams:[], totalSubs:0, avgScore:'-' }); }
    setStatsLoading(false);
  }

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 20 }}>📊 Course Analytics</div>

      {loading ? <div className="loading-center"><div className="spinner"/></div> : (
        <div style={{ display:'grid', gridTemplateColumns:'240px 1fr', gap:20 }}>

          {/* Course selector */}
          <div>
            <div style={{ fontWeight:700, marginBottom:10, fontSize:'0.8rem', color:'var(--text3)', letterSpacing:1 }}>COURSES</div>
            {courses.length === 0
              ? <div className="empty-state"><div className="empty-state-icon">🏫</div><div className="empty-state-title">No courses yet</div></div>
              : courses.map(function(c) {
                var isSel = selected && selected.course_id === c.course_id;
                return (
                  <div key={c.course_id} onClick={function(){ loadStats(c); }}
                    style={{ padding:'12px 14px', borderRadius:10, marginBottom:8, cursor:'pointer', border:'2px solid '+(isSel?'var(--accent)':'var(--border)'), background:isSel?'var(--accent-glow)':'var(--surface)', transition:'var(--transition)' }}>
                    <div style={{ fontWeight:700, marginBottom:3 }}>{c.name}</div>
                    <div style={{ fontSize:'0.75rem', color:'var(--text3)' }}>{c.course_type==='global'?'🌐 Global':'🔒 Private'} · {c.member_count||0} students</div>
                  </div>
                );
              })
            }
          </div>

          {/* Stats */}
          <div>
            {!selected && <div className="empty-state"><div className="empty-state-icon">📊</div><div className="empty-state-title">Select a course</div></div>}
            {statsLoading && <div className="loading-center"><div className="spinner"/></div>}

            {selected && stats && !statsLoading && (
              <div>
                <div style={{ fontWeight:800, fontSize:'1.2rem', marginBottom:4 }}>{selected.name}</div>
                <div style={{ fontSize:'0.8rem', color:'var(--text3)', marginBottom:20 }}>
                  Join code: <strong style={{ fontFamily:'JetBrains Mono,monospace', color:'var(--accent)', letterSpacing:2 }}>{selected.join_code}</strong>
                </div>

                {/* Summary stats */}
                <div className="stats-grid" style={{ marginBottom:20 }}>
                  <div className="stat-card">
                    <div className="stat-value">{stats.members.length}</div>
                    <div className="stat-label">Enrolled Students</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{stats.exams.length}</div>
                    <div className="stat-label">Total Exams</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{stats.totalSubs}</div>
                    <div className="stat-label">Total Submissions</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value" style={{ color:'var(--accent)' }}>{stats.avgScore}%</div>
                    <div className="stat-label">Avg Score</div>
                  </div>
                </div>

                {/* Exam-wise summary */}
                {stats.exams.length > 0 && (
                  <div className="card" style={{ marginBottom:16 }}>
                    <div style={{ fontWeight:700, marginBottom:12 }}>📝 Exam Summary</div>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.85rem' }}>
                      <thead><tr style={{ borderBottom:'2px solid var(--border)' }}>
                        <th style={{ textAlign:'left', padding:'8px', color:'var(--text3)' }}>Exam</th>
                        <th style={{ textAlign:'center', padding:'8px', color:'var(--text3)' }}>Status</th>
                        <th style={{ textAlign:'center', padding:'8px', color:'var(--text3)' }}>Submissions</th>
                        <th style={{ textAlign:'center', padding:'8px', color:'var(--text3)' }}>Attempted</th>
                      </tr></thead>
                      <tbody>
                        {stats.exams.map(function(e) {
                          var attempted = stats.members.length > 0 ? Math.round((e.submission_count||0)/stats.members.length*100) + '%' : '-';
                          return (
                            <tr key={e.exam_id} style={{ borderBottom:'1px solid var(--border)' }}>
                              <td style={{ padding:'10px 8px', fontWeight:600 }}>{e.title}</td>
                              <td style={{ padding:'10px 8px', textAlign:'center' }}><span className={'badge badge-'+(e.status==='published'?'success':'warning')}>{e.status}</span></td>
                              <td style={{ padding:'10px 8px', textAlign:'center' }}>{e.submission_count||0} / {stats.members.length}</td>
                              <td style={{ padding:'10px 8px', textAlign:'center', color:'var(--accent)', fontWeight:700 }}>{attempted}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Leaderboard */}
                <div className="card">
                  <div style={{ fontWeight:700, marginBottom:12 }}>🏆 Course Leaderboard</div>
                  {leaderboard.length === 0
                    ? <div style={{ color:'var(--text3)', fontSize:'0.85rem', textAlign:'center', padding:'10px 0' }}>No results yet — exams not attempted</div>
                    : <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.85rem' }}>
                      <thead><tr style={{ borderBottom:'2px solid var(--border)' }}>
                        <th style={{ textAlign:'left', padding:'8px', color:'var(--text3)' }}>Rank</th>
                        <th style={{ textAlign:'left', padding:'8px', color:'var(--text3)' }}>Student</th>
                        <th style={{ textAlign:'center', padding:'8px', color:'var(--text3)' }}>Avg Score</th>
                        <th style={{ textAlign:'center', padding:'8px', color:'var(--text3)' }}>Grade</th>
                        <th style={{ textAlign:'center', padding:'8px', color:'var(--text3)' }}>Exams</th>
                      </tr></thead>
                      <tbody>
                        {leaderboard.map(function(s, i) {
                          var medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1);
                          return (
                            <tr key={i} style={{ borderBottom:'1px solid var(--border)', background:i<3?'rgba(124,58,237,.03)':'transparent' }}>
                              <td style={{ padding:'10px 8px', fontWeight:700, fontSize:'1.1rem' }}>{medal}</td>
                              <td style={{ padding:'10px 8px' }}>
                                <div style={{ fontWeight:600 }}>{s.name}</div>
                                <div style={{ fontSize:'0.75rem', color:'var(--text3)' }}>{s.year||''} {s.department||''}</div>
                              </td>
                              <td style={{ padding:'10px 8px', textAlign:'center', fontFamily:'JetBrains Mono,monospace', fontWeight:700 }}>{Number(s.avg_score||0).toFixed(1)}%</td>
                              <td style={{ padding:'10px 8px', textAlign:'center' }}><span style={{ fontWeight:800, fontSize:'1rem', color:getGradeColor(s.grade) }}>{s.grade||'-'}</span></td>
                              <td style={{ padding:'10px 8px', textAlign:'center', color:'var(--text3)' }}>{s.exam_count||0}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
