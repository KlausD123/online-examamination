import React, { useState, useEffect } from 'react';
import { apiGet } from '../../utils/api';
import { useStore } from '../../store/useStore';

export default function CourseProgress() {
  var store = useStore();
  var [courses, setCourses] = useState([]);
  var [selected, setSelected] = useState(null);
  var [exams, setExams] = useState([]);
  var [subs, setSubs] = useState([]);
  var [loading, setLoading] = useState(true);

  useEffect(function() {
    Promise.all([apiGet('/courses/my'), apiGet('/exams'), store.currentUser ? store.loadSubmissions(store.currentUser.user_id) : Promise.resolve([])]).then(function(r) {
      var myCourses = r[0]||[];
      var allExams = r[1]||[];
      var mySubmissions = r[2]||[];
      setCourses(myCourses);
      setExams(allExams);
      setSubs(mySubmissions);
      setLoading(false);
      if (myCourses.length > 0) setSelected(myCourses[0]);
    }).catch(function(){ setLoading(false); });
  }, []); // eslint-disable-line

  function gradeColor(g) {
    if (!g) return '#6b7280';
    if (g==='A+'||g==='A') return '#16a34a';
    if (g==='B') return '#2563eb';
    if (g==='C') return '#d97706';
    return '#dc2626';
  }

  var courseExams = selected ? exams.filter(function(e){ return String(e.course_id)===String(selected.course_id); }) : [];

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom:20 }}>📊 Course Progress</div>

      {loading ? <div className="loading-center"><div className="spinner"/></div>
        : courses.length === 0
        ? <div className="empty-state"><div className="empty-state-icon">🏫</div><div className="empty-state-title">Not enrolled in any course</div><div style={{ color:'var(--text3)', fontSize:'0.85rem', marginTop:6 }}>Join a course from the Courses tab</div></div>
        : (
        <div style={{ display:'grid', gridTemplateColumns:'240px 1fr', gap:20 }}>
          {/* Course selector */}
          <div>
            <div style={{ fontWeight:700, marginBottom:10, fontSize:'0.85rem', color:'var(--text3)' }}>MY COURSES</div>
            {courses.map(function(c) {
              var isSel = selected && selected.course_id === c.course_id;
              return (
                <div key={c.course_id} onClick={function(){ setSelected(c); }}
                  style={{ padding:'12px 14px', borderRadius:10, marginBottom:8, cursor:'pointer', border:'2px solid '+(isSel?'var(--accent)':'var(--border)'), background:isSel?'var(--accent-glow)':'var(--surface)' }}>
                  <div style={{ fontWeight:700, marginBottom:2 }}>{c.name}</div>
                  <div style={{ fontSize:'0.75rem', color:'var(--text3)' }}>👥 {c.member_count||0} students</div>
                </div>
              );
            })}
          </div>

          {/* Progress panel */}
          <div>
            {selected && (
              <div>
                <div style={{ fontWeight:800, fontSize:'1.1rem', marginBottom:4 }}>{selected.name}</div>
                <div style={{ fontSize:'0.82rem', color:'var(--text3)', marginBottom:20 }}>
                  Joined {new Date(selected.joined_at).toLocaleDateString()} · {courseExams.length} exam{courseExams.length!==1?'s':''}
                </div>

                {courseExams.length === 0
                  ? <div className="empty-state"><div className="empty-state-icon">📝</div><div className="empty-state-title">No exams in this course yet</div></div>
                  : (
                    <div>
                      <div className="stats-grid" style={{ marginBottom:20 }}>
                        <div className="stat-card"><div className="stat-value">{courseExams.length}</div><div className="stat-label">Total Exams</div></div>
                        <div className="stat-card"><div className="stat-value">{courseExams.filter(function(e){return e.status==='published';}).length}</div><div className="stat-label">Available</div></div>
                      </div>

                      <div className="card">
                        <div style={{ fontWeight:700, marginBottom:12 }}>📝 Course Exams & My Performance</div>
                        {courseExams.map(function(e) {
                          var now = new Date();
                          var isLive = e.status==='published' && (!e.scheduled_at || new Date(e.scheduled_at)<=now) && (!e.end_at || new Date(e.end_at)>=now);
                          // Find my submission for this exam
                          var mySub = subs.find(function(s){ return s.exam_id === e.exam_id; });
                          var gc = mySub ? (mySub.grade==='A+'||mySub.grade==='A'?'#16a34a':mySub.grade==='B'?'#2563eb':mySub.grade==='C'?'#d97706':'#dc2626') : null;
                          return (
                            <div key={e.exam_id} style={{ padding:'14px 16px', borderRadius:10, marginBottom:10, border:'1px solid var(--border)', background:'var(--surface)', borderLeft: mySub ? '4px solid ' + gc : '4px solid var(--border)' }}>
                              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                                <div style={{ flex:1 }}>
                                  <div style={{ fontWeight:700, marginBottom:4 }}>{e.title}</div>
                                  <div style={{ fontSize:'0.78rem', color:'var(--text3)', marginBottom:6 }}>⏱ {e.duration_minutes} min · 📊 {e.total_marks} marks</div>
                                  {mySub ? (
                                    <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontSize:'0.8rem' }}>
                                      <span style={{ color:'#16a34a', fontWeight:600 }}>✅ {mySub.correct_count||0} correct</span>
                                      <span style={{ color:'#dc2626', fontWeight:600 }}>❌ {(mySub.total_questions||0)-(mySub.correct_count||0)} wrong</span>
                                      <span style={{ color:'var(--text3)' }}>Score: {mySub.total_score||0}%</span>
                                    </div>
                                  ) : (
                                    <span style={{ fontSize:'0.78rem', color:'var(--text3)' }}>{isLive?'🟢 Available now':'⏳ Not attempted'}</span>
                                  )}
                                </div>
                                {mySub ? (
                                  <div style={{ textAlign:'center', marginLeft:12 }}>
                                    <div style={{ fontWeight:800, fontSize:'1.5rem', color:gc }}>{mySub.grade||'-'}</div>
                                    <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>{mySub.total_score||0}%</div>
                                  </div>
                                ) : (
                                  <span className={'badge badge-'+(isLive?'success':'info')}>{isLive?'🟢 Live':'Upcoming'}</span>
                                )}
                              </div>
                              {mySub && mySub.total_questions > 0 && (
                                <div style={{ marginTop:8, height:5, background:'var(--surface3)', borderRadius:3, overflow:'hidden' }}>
                                  <div style={{ height:'100%', width:((mySub.correct_count||0)/mySub.total_questions*100)+'%', background:'#16a34a', borderRadius:3 }}/>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
                }
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
