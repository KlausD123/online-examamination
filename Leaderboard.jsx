import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { getGradeColor } from '../../utils/helpers';

export default function Leaderboard() {
  var store = useStore();
  var [exams, setExams] = useState([]);
  var [selectedExam, setSelectedExam] = useState(null);
  var [leaders, setLeaders] = useState([]);
  var [loading, setLoading] = useState(true);

  useEffect(function() {
    store.loadExams().then(function(d) {
      setExams(d);
      if (d.length > 0) { setSelectedExam(d[0].exam_id); loadLeaderboard(d[0].exam_id); }
      else setLoading(false);
    });
  }, []); // eslint-disable-line

  function loadLeaderboard(eid) {
    setLoading(true);
    store.loadLeaderboard(eid).then(function(d) { setLeaders(d); setLoading(false); }).catch(function() { setLoading(false); });
  }

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 16 }}>🏆 Leaderboard</div>
      <div className="filter-pills" style={{ marginBottom: 20 }}>
        {exams.map(function(e) {
          return <button key={e.exam_id} className={'pill' + (selectedExam === e.exam_id ? ' active' : '')} onClick={function() { setSelectedExam(e.exam_id); loadLeaderboard(e.exam_id); }}>{e.title}</button>;
        })}
      </div>
      {loading ? <div className="loading-center"><div className="spinner"></div></div> : leaders.length === 0 ? <div className="empty-state"><div className="empty-state-icon">🏅</div><div className="empty-state-title">No submissions yet</div></div> : (
        <div className="card">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: '0.8rem', color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>Rank</th>
                <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: '0.8rem', color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>Student</th>
                <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: '0.8rem', color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>Dept</th>
                <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: '0.8rem', color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>Score</th>
                <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: '0.8rem', color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>Grade</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map(function(l, i) {
                var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i < 3 ? 'rgba(124,58,237,0.03)' : 'transparent' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 700, fontSize: '1.1rem' }}>{medal}</td>
                    <td style={{ padding: '12px 8px' }}><div style={{ fontWeight: 600 }}>{l.name}</div><div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{l.year}</div></td>
                    <td style={{ padding: '12px 8px', fontSize: '0.85rem', color: 'var(--text3)' }}>{l.department || '-'}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{l.total_score}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}><span style={{ fontWeight: 800, fontSize: '1rem', color: getGradeColor(l.grade) }}>{l.grade}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
