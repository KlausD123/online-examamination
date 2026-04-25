import React, { useState, useEffect } from 'react';
import { apiGet, apiPost, apiDelete } from '../../utils/api';

export default function CoursesPanel() {
  var [courses,  setCourses]  = useState([]);
  var [loading,  setLoading]  = useState(true);
  var [creating, setCreating] = useState(false);
  var [name,     setName]     = useState('');
  var [desc,     setDesc]     = useState('');
  var [courseType, setCourseType] = useState('private');
  var [members,  setMembers]  = useState({});  // course_id -> members[]
  var [expanded, setExpanded] = useState(null);
  var [error,    setError]    = useState('');

  useEffect(function() { load(); }, []); // eslint-disable-line

  async function load() {
    setLoading(true);
    try { var d = await apiGet('/courses'); setCourses(d||[]); } catch(e){}
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true); setError('');
    try {
      var c = await apiPost('/courses', { name: name.trim(), description: desc.trim(), course_type: courseType });
      setCourses(function(p) { return [c].concat(p); });
      setName(''); setDesc('');
    } catch(e) { setError(e.message); }
    setCreating(false);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this course? Students will lose access.')) return;
    try { await apiDelete('/courses/' + id); setCourses(function(p) { return p.filter(function(c){return c.course_id!==id;}); }); } catch(e){}
  }

  async function loadMembers(id) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (members[id]) return;
    try {
      var m = await apiGet('/courses/' + id + '/members');
      setMembers(function(p) { return Object.assign({}, p, { [id]: m||[] }); });
    } catch(e) {}
  }

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 20 }}>🏫 Course Rooms</div>

      {/* Create course */}
      <div className="card" style={{ marginBottom: 24, maxWidth: 560 }}>
        <div className="card-title" style={{ marginBottom: 14 }}>Create New Course</div>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label className="form-label">Course Name</label>
            <input className="form-input" value={name} onChange={function(e){setName(e.target.value);}} placeholder="e.g. Data Structures — Batch A" required/>
          </div>
          <div className="form-group">
            <label className="form-label">Description (optional)</label>
            <input className="form-input" value={desc} onChange={function(e){setDesc(e.target.value);}} placeholder="Brief description"/>
          </div>
          <div className="form-group">
            <label className="form-label">Course Type</label>
            <div style={{ display:'flex', gap:10 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', borderRadius:9, border:'2px solid '+(courseType==='global'?'var(--accent)':'var(--border)'), cursor:'pointer', flex:1, background:courseType==='global'?'var(--accent-glow)':'var(--surface)' }}>
                <input type="radio" name="ctype" value="global" checked={courseType==='global'} onChange={function(){setCourseType('global');}} style={{display:'none'}}/>
                <span style={{fontSize:'1.2rem'}}>🌐</span>
                <div>
                  <div style={{fontWeight:700, fontSize:'0.88rem'}}>Global</div>
                  <div style={{fontSize:'0.72rem', color:'var(--text3)'}}>All students auto-enrolled</div>
                </div>
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', borderRadius:9, border:'2px solid '+(courseType==='private'?'var(--accent)':'var(--border)'), cursor:'pointer', flex:1, background:courseType==='private'?'var(--accent-glow)':'var(--surface)' }}>
                <input type="radio" name="ctype" value="private" checked={courseType==='private'} onChange={function(){setCourseType('private');}} style={{display:'none'}}/>
                <span style={{fontSize:'1.2rem'}}>🔒</span>
                <div>
                  <div style={{fontWeight:700, fontSize:'0.88rem'}}>Private</div>
                  <div style={{fontSize:'0.72rem', color:'var(--text3)'}}>Join by code only (retakes etc.)</div>
                </div>
              </label>
            </div>
          </div>
          {error && <div style={{ color:'var(--danger)', fontSize:'0.82rem', marginBottom:8 }}>{error}</div>}
          <button className="btn btn-primary" disabled={creating}>{creating ? 'Creating…' : '+ Create Course'}</button>
        </form>
      </div>

      {/* Course list */}
      {loading ? <div className="loading-center"><div className="spinner"/></div>
        : courses.length === 0
        ? <div className="empty-state"><div className="empty-state-icon">🏫</div><div className="empty-state-title">No courses yet</div></div>
        : courses.map(function(c) {
          var isOpen = expanded === c.course_id;
          return (
            <div key={c.course_id} className="card" style={{ marginBottom: 14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight:700, fontSize:'1.05rem', marginBottom:4 }}>{c.name}</div>
                  {c.description && <div style={{ fontSize:'0.82rem', color:'var(--text3)', marginBottom:8 }}>{c.description}</div>}
                  <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
                    <span className={'badge ' + (c.course_type==='global'?'badge-success':'badge-info')} style={{fontSize:'0.72rem'}}>
                      {c.course_type==='global'?'🌐 Global':'🔒 Private'}
                    </span>
                    {c.course_type === 'private' && (
                      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 14px', background:'var(--accent-glow)', borderRadius:8, border:'1px solid var(--accent-border)' }}>
                        <span style={{ fontSize:'0.75rem', color:'var(--text3)' }}>Join Code</span>
                        <span style={{ fontFamily:'JetBrains Mono,monospace', fontWeight:800, fontSize:'1.1rem', color:'var(--accent)', letterSpacing:3 }}>{c.join_code}</span>
                      </div>
                    )}
                    <span style={{ fontSize:'0.8rem', color:'var(--text3)' }}>👥 {c.member_count||0} students</span>
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                  <button className="btn btn-outline btn-sm" onClick={function(){loadMembers(c.course_id);}}>
                    {isOpen ? '▲ Hide' : '👥 Members'}
                  </button>
                  <button className="btn btn-outline btn-sm" style={{ color:'var(--danger)', borderColor:'var(--danger)' }} onClick={function(){handleDelete(c.course_id);}}>
                    🗑
                  </button>
                </div>
              </div>

              {/* Members list */}
              {isOpen && (
                <div style={{ marginTop:14, borderTop:'1px solid var(--border)', paddingTop:14 }}>
                  {!members[c.course_id] ? <div className="loading-center"><div className="spinner"/></div>
                    : members[c.course_id].length === 0
                    ? <div style={{ color:'var(--text3)', fontSize:'0.82rem', textAlign:'center', padding:'8px 0' }}>No students joined yet — share the code above</div>
                    : (
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.85rem' }}>
                        <thead>
                          <tr style={{ borderBottom:'1px solid var(--border)' }}>
                            <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)', fontWeight:600 }}>Name</th>
                            <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)', fontWeight:600 }}>Email</th>
                            <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)', fontWeight:600 }}>Year</th>
                            <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)', fontWeight:600 }}>Joined</th>
                          </tr>
                        </thead>
                        <tbody>
                          {members[c.course_id].map(function(m) {
                            return (
                              <tr key={m.user_id} style={{ borderBottom:'1px solid var(--border)' }}>
                                <td style={{ padding:'8px 8px', fontWeight:600 }}>{m.name}</td>
                                <td style={{ padding:'8px 8px', color:'var(--text3)' }}>{m.email}</td>
                                <td style={{ padding:'8px 8px', color:'var(--text3)' }}>{m.year||'-'}</td>
                                <td style={{ padding:'8px 8px', color:'var(--text3)', fontSize:'0.78rem' }}>{new Date(m.joined_at).toLocaleDateString()}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )
                  }
                </div>
              )}
            </div>
          );
        })
      }
    </div>
  );
}
