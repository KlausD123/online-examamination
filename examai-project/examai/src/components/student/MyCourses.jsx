import React, { useState, useEffect } from 'react';
import { apiGet, apiPost, apiDelete } from '../../utils/api';

export default function MyCourses() {
  var [courses,  setCourses]  = useState([]);
  var [loading,  setLoading]  = useState(true);
  var [code,     setCode]     = useState('');
  var [joining,  setJoining]  = useState(false);
  var [error,    setError]    = useState('');
  var [success,  setSuccess]  = useState('');

  useEffect(function() { load(); }, []); // eslint-disable-line

  async function load() {
    setLoading(true);
    try { var d = await apiGet('/courses/my'); setCourses(d||[]); } catch(e){}
    setLoading(false);
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setJoining(true); setError(''); setSuccess('');
    try {
      var c = await apiPost('/courses/join', { join_code: code.trim().toUpperCase() });
      setSuccess('Joined "' + c.name + '" successfully!');
      setCode('');
      load();
    } catch(e) { setError(e.message || 'Invalid join code'); }
    setJoining(false);
  }

  async function handleLeave(id, name) {
    if (!window.confirm('Leave "' + name + '"?')) return;
    try {
      await apiDelete('/courses/leave/' + id);
      setCourses(function(p) { return p.filter(function(c){return c.course_id!==id;}); });
    } catch(e){}
  }

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 20 }}>🏫 My Courses</div>

      {/* Join course */}
      <div className="card" style={{ marginBottom: 24, maxWidth: 480 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Join a Course</div>
        <form onSubmit={handleJoin} style={{ display:'flex', gap:8 }}>
          <input
            className="form-input"
            value={code}
            onChange={function(e){setCode(e.target.value.toUpperCase());}}
            placeholder="Enter 6-character code (e.g. ABC123)"
            maxLength={12}
            style={{ flex:1, fontFamily:'JetBrains Mono,monospace', letterSpacing:2, fontWeight:700, fontSize:'1rem' }}
          />
          <button className="btn btn-primary" disabled={joining || !code.trim()}>
            {joining ? 'Joining…' : 'Join'}
          </button>
        </form>
        {error   && <div style={{ color:'var(--danger)', fontSize:'0.82rem', marginTop:8 }}>❌ {error}</div>}
        {success && <div style={{ color:'var(--success)', fontSize:'0.82rem', marginTop:8 }}>✅ {success}</div>}
      </div>

      {/* My courses */}
      {loading ? <div className="loading-center"><div className="spinner"/></div>
        : courses.length === 0
        ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏫</div>
            <div className="empty-state-title">No courses yet</div>
            <div style={{ color:'var(--text3)', fontSize:'0.85rem', marginTop:6 }}>Ask your teacher for a join code</div>
          </div>
        ) : (
          <div className="grid-2">
            {courses.map(function(c) {
              return (
                <div key={c.course_id} className="card" style={{ borderLeft:'4px solid var(--accent)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:'1rem', marginBottom:4 }}>{c.name}</div>
                      {c.description && <div style={{ fontSize:'0.82rem', color:'var(--text3)', marginBottom:8 }}>{c.description}</div>}
                      <div style={{ display:'flex', gap:10, fontSize:'0.78rem', color:'var(--text3)' }}>
                        <span>👥 {c.member_count||0} members</span>
                        <span>📅 Joined {new Date(c.joined_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ color:'var(--danger)', borderColor:'var(--danger)', flexShrink:0, marginLeft:12 }}
                      onClick={function(){handleLeave(c.course_id, c.name);}}>
                      Leave
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}
