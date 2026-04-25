import React, { useState, useEffect } from 'react';
import { apiGet } from '../../utils/api';

export default function CourseAnalytics() {
  var [courses, setCourses] = useState([]);
  var [selected, setSelected] = useState(null);
  var [stats, setStats] = useState(null);
  var [loading, setLoading] = useState(true);
  var [statsLoading, setStatsLoading] = useState(false);

  useEffect(function() {
    apiGet('/courses').then(function(d) {
      setCourses(d||[]);
      setLoading(false);
      if (d && d.length > 0) loadStats(d[0]);
    }).catch(function(){ setLoading(false); });
  }, []); // eslint-disable-line

  async function loadStats(course) {
    setSelected(course); setStatsLoading(true); setStats(null);
    try {
      var [members, exams] = await Promise.all([
        apiGet('/courses/' + course.course_id + '/members'),
        apiGet('/exams'),
      ]);
      // Filter exams for this course
      var courseExams = (exams||[]).filter(function(e){ return String(e.course_id) === String(course.course_id); });
      setStats({ members: members||[], exams: courseExams });
    } catch(e) {}
    setStatsLoading(false);
  }

  function gradeColor(g) {
    if (!g) return '#6b7280';
    if (g==='A+'||g==='A') return '#16a34a';
    if (g==='B') return '#2563eb';
    if (g==='C') return '#d97706';
    return '#dc2626';
  }

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 20 }}>📊 Course Analytics</div>

      {loading ? <div className="loading-center"><div className="spinner"/></div> : (
        <div style={{ display:'grid', gridTemplateColumns:'260px 1fr', gap:20 }}>

          {/* Course list */}
          <div>
            <div style={{ fontWeight:700, marginBottom:10, fontSize:'0.85rem', color:'var(--text3)' }}>SELECT COURSE</div>
            {courses.length === 0
              ? <div className="empty-state"><div className="empty-state-icon">🏫</div><div className="empty-state-title">No courses yet</div></div>
              : courses.map(function(c) {
                var isSelected = selected && selected.course_id === c.course_id;
                return (
                  <div key={c.course_id} onClick={function(){ loadStats(c); }}
                    style={{ padding:'12px 14px', borderRadius:10, marginBottom:8, cursor:'pointer', border:'2px solid '+(isSelected?'var(--accent)':'var(--border)'), background:isSelected?'var(--accent-glow)':'var(--surface)', transition:'var(--transition)' }}>
                    <div style={{ fontWeight:700, marginBottom:3 }}>{c.name}</div>
                    <div style={{ fontSize:'0.78rem', color:'var(--text3)' }}>👥 {c.member_count||0} students · {c.course_type==='global'?'🌐 Global':'🔒 Private'}</div>
                  </div>
                );
              })
            }
          </div>

          {/* Stats panel */}
          <div>
            {!selected && <div className="empty-state"><div className="empty-state-icon">📊</div><div className="empty-state-title">Select a course</div></div>}
            {statsLoading && <div className="loading-center"><div className="spinner"/></div>}
            {selected && stats && !statsLoading && (
              <div>
                <div style={{ fontWeight:800, fontSize:'1.2rem', marginBottom:4 }}>{selected.name}</div>
                <div style={{ fontSize:'0.82rem', color:'var(--text3)', marginBottom:20 }}>{selected.course_type==='global'?'🌐 Global course':'🔒 Private course'} · Join code: <strong style={{ fontFamily:'JetBrains Mono,monospace', color:'var(--accent)' }}>{selected.join_code}</strong></div>

                {/* Summary cards */}
                <div className="stats-grid" style={{ marginBottom:24 }}>
                  <div className="stat-card"><div className="stat-value">{stats.members.length}</div><div className="stat-label">Students</div></div>
                  <div className="stat-card"><div className="stat-value">{stats.exams.length}</div><div className="stat-label">Exams</div></div>
                  <div className="stat-card"><div className="stat-value">{stats.exams.filter(function(e){return e.status==='published';}).length}</div><div className="stat-label">Published</div></div>
                </div>

                {/* Exams in this course */}
                {stats.exams.length > 0 && (
                  <div className="card" style={{ marginBottom:20 }}>
                    <div style={{ fontWeight:700, marginBottom:12 }}>📝 Course Exams</div>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.85rem' }}>
                      <thead><tr style={{ borderBottom:'1px solid var(--border)' }}>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)' }}>Exam</th>
                        <th style={{ textAlign:'center', padding:'6px 8px', color:'var(--text3)' }}>Status</th>
                        <th style={{ textAlign:'center', padding:'6px 8px', color:'var(--text3)' }}>Submissions</th>
                        <th style={{ textAlign:'center', padding:'6px 8px', color:'var(--text3)' }}>Type</th>
                      </tr></thead>
                      <tbody>
                        {stats.exams.map(function(e) { return (
                          <tr key={e.exam_id} style={{ borderBottom:'1px solid var(--border)' }}>
                            <td style={{ padding:'8px 8px', fontWeight:600 }}>{e.title}</td>
                            <td style={{ padding:'8px 8px', textAlign:'center' }}><span className={'badge badge-'+(e.status==='published'?'success':e.status==='draft'?'warning':'info')}>{e.status}</span></td>
                            <td style={{ padding:'8px 8px', textAlign:'center', color:'var(--text3)' }}>{e.submission_count||0}</td>
                            <td style={{ padding:'8px 8px', textAlign:'center', fontSize:'0.75rem', color:'var(--text3)' }}>{e.exam_type==='targeted'?'🎯 Targeted':e.exam_type==='course_global'?'🏫 Course':'🌐 Global'}</td>
                          </tr>
                        ); })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Members */}
                {stats.members.length > 0 && (
                  <div className="card">
                    <div style={{ fontWeight:700, marginBottom:12 }}>👥 Enrolled Students</div>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.85rem' }}>
                      <thead><tr style={{ borderBottom:'1px solid var(--border)' }}>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)' }}>Name</th>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)' }}>Dept</th>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)' }}>Year</th>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)' }}>Joined</th>
                      </tr></thead>
                      <tbody>
                        {stats.members.map(function(m) { return (
                          <tr key={m.user_id} style={{ borderBottom:'1px solid var(--border)' }}>
                            <td style={{ padding:'8px 8px', fontWeight:600 }}>{m.name}</td>
                            <td style={{ padding:'8px 8px', color:'var(--text3)' }}>{m.department||'-'}</td>
                            <td style={{ padding:'8px 8px', color:'var(--text3)' }}>{m.year||'-'}</td>
                            <td style={{ padding:'8px 8px', color:'var(--text3)', fontSize:'0.75rem' }}>{new Date(m.joined_at).toLocaleDateString()}</td>
                          </tr>
                        ); })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
