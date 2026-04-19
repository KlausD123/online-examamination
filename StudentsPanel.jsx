import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { formatDate } from '../../utils/helpers';

export default function StudentsPanel() {
  var store = useStore();
  var [students, setStudents] = useState([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState('');

  useEffect(function() { store.loadStudents().then(function(d) { setStudents(d); setLoading(false); }); }, []); // eslint-disable-line

  var filtered = students.filter(function(s) { return s.name.toLowerCase().includes(search.toLowerCase()) || s.email.toLowerCase().includes(search.toLowerCase()); });

  if (loading) return <div className="loading-center"><div className="spinner"></div></div>;

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="page-title">👥 Students ({students.length})</div>
        <input className="form-input" style={{ maxWidth: 300 }} placeholder="🔍 Search students..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
      </div>
      {filtered.length === 0 ? <div className="empty-state"><div className="empty-state-title">No students found</div></div> : (
        <div className="grid-3">
          {filtered.map(function(s) {
            return (
              <div key={s.user_id} className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div className="topbar-avatar" style={{ width: 42, height: 42, fontSize: '1rem' }}>{(s.name || 'S').charAt(0)}</div>
                  <div><div style={{ fontWeight: 600 }}>{s.name}</div><div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>{s.email}</div></div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {s.department && <span className="badge badge-primary">{s.department}</span>}
                  <span className="badge badge-info">{s.year || '1st Year'}</span>
                  <span className="badge badge-success">Joined {formatDate(s.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
