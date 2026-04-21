import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { formatDate } from '../../utils/helpers';

export default function StudentsPanel() {
  var store = useStore();
  var [students, setStudents] = useState([]);
  var [loading,  setLoading]  = useState(true);
  var [search,   setSearch]   = useState('');

  useEffect(function() {
    store.loadStudents().then(function(d) { setStudents(d || []); setLoading(false); });
  }, []); // eslint-disable-line

  var filtered = students.filter(function(s) {
    var q = search.toLowerCase();
    return (s.name || '').toLowerCase().includes(q)
        || (s.email || '').toLowerCase().includes(q)
        || (s.department || '').toLowerCase().includes(q);
  });

  if (loading) return <div className="loading-center"><div className="spinner"></div><span>Loading students…</span></div>;

  return (
    <div className="fade-up">

      {/* ── Header + full-width search ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="page-title">👥 Students</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text3)', marginTop: 3 }}>
              {filtered.length} of {students.length} student{students.length !== 1 ? 's' : ''}
            </div>
          </div>
          {/* Stats pills */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ padding: '6px 16px', background: 'var(--accent-glow)', border: '1px solid var(--accent-light)', borderRadius: 20, fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent)' }}>
              {students.length} Total
            </div>
          </div>
        </div>

        {/* Full-width search bar */}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: '1rem', pointerEvents: 'none', opacity: 0.5 }}>🔍</span>
          <input
            className="form-input"
            style={{ paddingLeft: 40, width: '100%' }}
            placeholder="Search by name, email or department…"
            value={search}
            onChange={function(e) { setSearch(e.target.value); }}
            autoFocus
          />
          {search && (
            <button onClick={function() { setSearch(''); }}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--text3)' }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Student list: each card is a full-width horizontal row ── */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔍</div>
          <div className="empty-state-title">{search ? 'No students match "' + search + '"' : 'No students yet'}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginTop: 6 }}>
            {search ? 'Try a different search term' : 'Students will appear here after they register'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(function(s, idx) {
            var initials = (s.name || 'S').charAt(0).toUpperCase();
            var hue      = (s.name || '').charCodeAt(0) * 7 % 360;
            return (
              <div key={s.user_id} className="card" style={{ padding: '14px 20px' }}>
                {/* Single horizontal row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>

                  {/* Index number */}
                  <div style={{ width: 28, textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
                    {idx + 1}
                  </div>

                  {/* Avatar */}
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'hsl(' + hue + ',60%,55%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '1.1rem', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}>
                    {s.avatar_url
                      ? <img src={s.avatar_url} alt={initials} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }}/>
                      : initials
                    }
                  </div>

                  {/* Name + email */}
                  <div style={{ minWidth: 160, flex: 2 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>{s.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginTop: 2 }}>{s.email}</div>
                  </div>

                  {/* Department */}
                  <div style={{ minWidth: 80, flex: 1 }}>
                    {s.department
                      ? <span className="badge badge-primary">{s.department}</span>
                      : <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>—</span>
                    }
                  </div>

                  {/* Year */}
                  <div style={{ minWidth: 80, flex: 1 }}>
                    <span className="badge badge-info">{s.year || '1st Year'}</span>
                  </div>

                  {/* Joined */}
                  <div style={{ minWidth: 110, flex: 1 }}>
                    <span className="badge badge-success" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem' }}>
                      Joined {formatDate(s.created_at)}
                    </span>
                  </div>

                  {/* Submissions count (if available) */}
                  {s.submission_count != null && (
                    <div style={{ textAlign: 'center', minWidth: 60 }}>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--accent)' }}>{s.submission_count}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Exams</div>
                    </div>
                  )}

                  {/* Avg score (if available) */}
                  {s.avg_score != null && (
                    <div style={{ textAlign: 'center', minWidth: 60 }}>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: Number(s.avg_score) >= 50 ? 'var(--success)' : 'var(--danger)' }}>{Math.round(s.avg_score)}%</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Avg</div>
                    </div>
                  )}

                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
