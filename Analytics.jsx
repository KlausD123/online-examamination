import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';

export default function Analytics() {
  var store = useStore();
  var [stats, setStats] = useState(null);
  var [loading, setLoading] = useState(true);

  useEffect(function() { store.loadAnalytics().then(function(d) { setStats(d); setLoading(false); }).catch(function() { setLoading(false); }); }, []); // eslint-disable-line

  if (loading) return <div className="loading-center"><div className="spinner"></div></div>;
  if (!stats) return <div className="empty-state"><div className="empty-state-title">No analytics data</div></div>;

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 24 }}>📈 Analytics Overview</div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{stats.total_students}</div><div className="stat-label">Students</div></div>
        <div className="stat-card"><div className="stat-value">{stats.total_exams}</div><div className="stat-label">Exams</div></div>
        <div className="stat-card"><div className="stat-value">{stats.total_submissions}</div><div className="stat-label">Submissions</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--success)' }}>{stats.avg_score}%</div><div className="stat-label">Average Score</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card">
          <div className="card-title">📊 Grade Distribution</div>
          <div style={{ marginTop: 16 }}>
            {stats.grade_distribution.map(function(g) {
              var total = stats.total_submissions || 1;
              var pct = Math.round((g.count / total) * 100);
              var colors = { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#ea580c', F: '#dc2626' };
              return (
                <div key={g.grade} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span style={{ width: 28, fontWeight: 700, color: colors[g.grade] || '#6b7280' }}>{g.grade}</span>
                  <div style={{ flex: 1 }}><div className="progress-bar"><div className="progress-fill" style={{ width: pct + '%', background: colors[g.grade] || '#6b7280' }}></div></div></div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: 40 }}>{g.count}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="card-title">📝 Per-Exam Submissions</div>
          <div style={{ marginTop: 16 }}>
            {stats.submissions.map(function(s) {
              return (
                <div key={s.exam_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{s.title}</span>
                  <span className="badge badge-primary">{s.submission_count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
