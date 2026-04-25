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

      {/* Join course — 6 box code input */}
      <div className="card" style={{ marginBottom: 24, maxWidth: 460 }}>
        <div style={{ fontWeight: 700, fontSize:'1.1rem', marginBottom: 6 }}>Join a Course</div>
        <div style={{ fontSize:'0.82rem', color:'var(--text3)', marginBottom: 20 }}>Enter the 6-character code from your teacher</div>
        <form onSubmit={handleJoin}>
          <div style={{ display:'flex', gap:10, justifyContent:'center', marginBottom:20 }}>
            {[0,1,2,3,4,5].map(function(i) {
              return (
                <input key={i} id={'code-box-'+i} maxLength={1}
                  value={code[i]||''}
                  onChange={function(e) {
                    var val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
                    var arr = (code+'      ').split('').slice(0,6);
                    arr[i] = val;
                    var newCode = arr.join('').trim();
                    setCode(newCode);
                    // Auto-focus next
                    if (val && i < 5) {
                      var next = document.getElementById('code-box-'+(i+1));
                      if (next) next.focus();
                    }
                  }}
                  onKeyDown={function(e) {
                    if (e.key==='Backspace' && !code[i] && i > 0) {
                      var prev = document.getElementById('code-box-'+(i-1));
                      if (prev) { prev.focus(); var arr=(code+'      ').split('').slice(0,6); arr[i-1]=''; setCode(arr.join('').trim()); }
                    }
                    if (e.key==='Enter') handleJoin(e);
                  }}
                  onPaste={function(e) {
                    e.preventDefault();
                    var pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
                    setCode(pasted);
                    var last = document.getElementById('code-box-'+(Math.min(pasted.length,5)));
                    if (last) last.focus();
                  }}
                  style={{
                    width:52, height:60, textAlign:'center',
                    fontSize:'1.6rem', fontWeight:800,
                    fontFamily:'JetBrains Mono,monospace',
                    border:'2px solid '+(code[i]?'var(--accent)':'var(--border)'),
                    borderRadius:12, background:code[i]?'var(--accent-glow)':'var(--surface)',
                    color:'var(--text)', outline:'none',
                    transition:'var(--transition)', letterSpacing:0,
                    boxShadow:code[i]?'0 0 0 3px var(--accent-glow)':'none'
                  }}
                />
              );
            })}
          </div>
          {error   && <div style={{ color:'var(--danger)', fontSize:'0.82rem', marginBottom:10, textAlign:'center' }}>❌ {error}</div>}
          {success && <div style={{ color:'var(--success)', fontSize:'0.82rem', marginBottom:10, textAlign:'center' }}>✅ {success}</div>}
          <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center' }}
            disabled={joining || code.replace(/\s/g,'').length < 6}>
            {joining ? 'Joining…' : '🚀 Join Course'}
          </button>
        </form>
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
