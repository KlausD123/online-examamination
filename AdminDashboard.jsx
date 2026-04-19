import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';

export default function AdminDashboard({ navigate }) {
  var store = useStore();
  var [stats, setStats] = useState(null);
  var [loading, setLoading] = useState(true);

  useEffect(function() {
    store.loadAnalytics().then(function(d) { setStats(d); setLoading(false); }).catch(function() { setLoading(false); });
  }, []); // eslint-disable-line

  if (loading) return <div className="loading-center"><div className="spinner"></div><span>Loading dashboard...</span></div>;

  return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">👋 Welcome back, {store.currentUser.name}</div>
          <div className="page-subtitle">Here's your examination platform overview</div>
        </div>
        <button className="btn btn-primary" onClick={function() { navigate('create'); }}>+ Create Exam</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats ? stats.total_students : 0}</div>
          <div className="stat-label">Total Students</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats ? stats.total_exams : 0}</div>
          <div className="stat-label">Total Exams</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats ? stats.total_submissions : 0}</div>
          <div className="stat-label">Submissions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--success)' }}>{stats ? stats.avg_score : 0}%</div>
          <div className="stat-label">Average Score</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card">
          <div className="card-title">📊 Grade Distribution</div>
          <div style={{ marginTop: 16 }}>
            {stats && stats.grade_distribution && stats.grade_distribution.length > 0 ? stats.grade_distribution.map(function(g) {
              var colors = { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#ea580c', F: '#dc2626' };
              return (
                <div key={g.grade} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: (colors[g.grade] || '#6b7280') + '15', color: colors[g.grade] || '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem' }}>{g.grade}</span>
                  <div style={{ flex: 1 }}>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: Math.min(g.count * 10, 100) + '%', background: colors[g.grade] || '#6b7280' }}></div></div>
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text2)' }}>{g.count}</span>
                </div>
              );
            }) : <div className="empty-state"><div className="empty-state-title">No data yet</div></div>}
          </div>
        </div>

        <div className="card">
          <div className="card-title">🕐 Recent Submissions</div>
          <div style={{ marginTop: 16 }}>
            {stats && stats.recent_submissions && stats.recent_submissions.length > 0 ? stats.recent_submissions.slice(0, 5).map(function(s, i) {
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>{s.title}</div>
                  </div>
                  <span className={'badge badge-' + (s.grade === 'A' ? 'success' : s.grade === 'F' ? 'danger' : 'warning')}>{s.grade || '-'}</span>
                </div>
              );
            }) : <div className="empty-state"><div className="empty-state-title">No submissions yet</div></div>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 24 }}>
        <button className="card" style={{ cursor: 'pointer', textAlign: 'center', border: '2px dashed var(--border)' }} onClick={function() { navigate('create'); }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>✨</div>
          <div style={{ fontWeight: 600 }}>Create New Exam</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginTop: 4 }}>AI-powered question generation</div>
        </button>
        <button className="card" style={{ cursor: 'pointer', textAlign: 'center', border: '2px dashed var(--border)' }} onClick={function() { navigate('viva'); }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎙</div>
          <div style={{ fontWeight: 600 }}>Start Viva Room</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginTop: 4 }}>Live oral examination</div>
        </button>
        <button className="card" style={{ cursor: 'pointer', textAlign: 'center', border: '2px dashed var(--border)' }} onClick={function() { navigate('analytics'); }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>📈</div>
          <div style={{ fontWeight: 600 }}>View Analytics</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginTop: 4 }}>Detailed insights</div>
        </button>
      </div>
    </div>
  );
}
