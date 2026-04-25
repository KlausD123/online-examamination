import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';

export default function StudentDashboard({ navigate }) {
  var store = useStore();
  var [exams,  setExams]  = useState(store.exams || []);
  var [subs,   setSubs]   = useState(store.submissions || []);
  var [notifs, setNotifs] = useState(store.notifications || []);

  useEffect(function() {
    store.loadExams().then(function(d) { setExams(d||[]); });
    store.loadSubmissions(store.currentUser.user_id).then(function(d) { setSubs(d||[]); });
    store.loadNotifications().then(function(d) { setNotifs(d||[]); });
  }, []); // eslint-disable-line

  var recentSubs = subs.slice(0, 3);
  // Only show exams that student has NOT already submitted or cheated
  var completedExamIds = subs
    .filter(function(s) { return s.status === 'submitted' || s.status === 'cheated'; })
    .map(function(s) { return s.exam_id; });
  var activeExams = exams
    .filter(function(e) { return e.status === 'published' && !completedExamIds.includes(e.exam_id); })
    .slice(0, 3);

  return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">👋 Hello, {store.currentUser.name}!</div>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{exams.length}</div><div className="stat-label">Available Exams</div></div>
        <div className="stat-card"><div className="stat-value">{subs.length}</div><div className="stat-label">Completed</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--success)' }}>{subs.length > 0 ? Math.round(subs.reduce(function(a, s) { return a + (s.total_score || 0); }, 0) / subs.length) : 0}%</div><div className="stat-label">Avg Score</div></div>
        <div className="stat-card"><div className="stat-value">{notifs.filter(function(n) { return n.viva_room_id; }).length}</div><div className="stat-label">Viva Invites</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card">
          <div className="card-title">📝 Available Exams</div>
          {activeExams.length === 0 ? <div style={{ color: 'var(--text3)', fontSize: '0.9rem', marginTop: 12 }}>No exams available</div> : activeExams.map(function(e) {
            return <div key={e.exam_id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div style={{ fontWeight: 600 }}>{e.title}</div><div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>{e.duration_minutes} min • {e.total_marks} marks</div></div>
              <button className="btn btn-primary btn-sm" onClick={function() { navigate('exams'); }}>Take</button>
            </div>;
          })}
        </div>
        <div className="card">
          <div className="card-title">📊 Recent Results</div>
          {recentSubs.length === 0 ? <div style={{ color: 'var(--text3)', fontSize: '0.9rem', marginTop: 12 }}>No results yet</div> : recentSubs.map(function(s, i) {
            var pct = s.total_marks > 0 ? Math.round(((s.total_score||0)/s.total_marks)*100) : 0;
            var gc = s.grade==='A'||s.grade==='A+'?'#16a34a':s.grade==='F'?'#dc2626':s.grade==='B'?'#2563eb':'#d97706';
            var isCheated = s.cheating_detected===1||s.status==='cheated';
            return (
              <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                  <div style={{ fontWeight: 600, fontSize:'0.9rem' }}>{s.title}</div>
                  <span style={{ fontWeight:800, color:gc, fontSize:'1rem' }}>{s.grade||'-'}</span>
                </div>
                <div style={{ display:'flex', gap:14, fontSize:'0.75rem', color:'var(--text3)', flexWrap:'wrap' }}>
                  <span>📊 {s.total_score||0}/{s.total_marks} ({pct}%)</span>
                  {s.correct_count!=null && <span style={{color:'#16a34a'}}>✓ {s.correct_count} correct</span>}
                  {s.wrong_count!=null && <span style={{color:'#dc2626'}}>✗ {s.wrong_count} wrong</span>}
                  {isCheated && <span style={{color:'#dc2626', fontWeight:700}}>🚫 Violation</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 24 }}>
        <button className="card" style={{ cursor: 'pointer', textAlign: 'center', border: '2px dashed var(--border)' }} onClick={function() { navigate('exams'); }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>📝</div>
          <div style={{ fontWeight: 600 }}>Take an Exam</div>
        </button>
        <button className="card" style={{ cursor: 'pointer', textAlign: 'center', border: '2px dashed var(--border)' }} onClick={function() { navigate('practice'); }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎯</div>
          <div style={{ fontWeight: 600 }}>Practice</div>
        </button>
        <button className="card" style={{ cursor: 'pointer', textAlign: 'center', border: '2px dashed var(--border)' }} onClick={function() { navigate('viva'); }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎙</div>
          <div style={{ fontWeight: 600 }}>Join Viva</div>
        </button>
      </div>
    </div>
  );
}
