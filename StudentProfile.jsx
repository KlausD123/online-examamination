import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';

export default function StudentProfile() {
  var store     = useStore();
  var [name,       setName]       = useState('');
  var [bio,        setBio]        = useState('');
  var [avatarUrl,  setAvatarUrl]  = useState('');
  var [department, setDepartment] = useState('');
  var [year,       setYear]       = useState('1st Year');
  var [loading,    setLoading]    = useState(false);
  var [uploading,  setUploading]  = useState(false);
  var [success,    setSuccess]    = useState('');
  var [subs,       setSubs]       = useState([]);
  var fileRef = useRef(null);

  useEffect(function() {
    store.loadProfile().then(function(p) {
      if (p) {
        setName(p.name || '');
        setBio(p.bio || '');
        setAvatarUrl(p.avatar_url || '');
        setDepartment((p.student && p.student.department) || p.department || '');
        setYear((p.student && p.student.year) || p.year || '1st Year');
      }
    });
    store.loadSubmissions(store.currentUser.user_id).then(function(d) { setSubs(d || []); });
  }, []); // eslint-disable-line

  // Convert file to base64
  function handleFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { store.addToast('Image must be under 2MB', 'error'); return; }
    if (!file.type.startsWith('image/')) { store.addToast('Please select an image file', 'error'); return; }
    setUploading(true);
    var reader = new FileReader();
    reader.onload = function(ev) {
      setAvatarUrl(ev.target.result);
      setUploading(false);
    };
    reader.onerror = function() { store.addToast('Failed to read image', 'error'); setUploading(false); };
    reader.readAsDataURL(file);
  }

  async function handleSave(e) {
    e.preventDefault();
    setLoading(true); setSuccess('');
    try {
      await store.updateProfile({ name: name, bio: bio, avatar_url: avatarUrl, department: department, year: year });
      // Refresh user in store so topbar avatar updates immediately
      var updated = await store.loadProfile();
      if (updated) store.setCurrentUser(Object.assign({}, store.currentUser, { name: updated.name, avatar_url: updated.avatar_url }));
      setSuccess('Profile updated successfully!');
    } catch (e) { store.addToast(e.message, 'error'); }
    setLoading(false);
  }

  var avgScore = subs.length > 0
    ? Math.round(subs.filter(function(s) { return s.status === 'submitted'; }).reduce(function(a, s) { return a + (Number(s.total_score) || 0); }, 0) / Math.max(1, subs.filter(function(s) { return s.status === 'submitted'; }).length))
    : 0;
  var bestGrade = subs.length > 0 ? subs.reduce(function(best, s) {
    var order = ['A+','A','B','C','D','F'];
    var bi = order.indexOf(best), si = order.indexOf(s.grade || 'F');
    return si < bi ? s.grade : best;
  }, 'F') : '—';

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 24 }}>👤 My Profile</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

        {/* Left: edit form */}
        <div className="card">
          {/* Avatar section */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ position: 'relative', width: 90, height: 90, margin: '0 auto 12px' }}>
              <div style={{ width: 90, height: 90, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--accent2))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', color: '#fff', fontWeight: 700, overflow: 'hidden', border: '3px solid var(--border)' }}>
                {avatarUrl
                  ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                  : (name || 'S').charAt(0).toUpperCase()
                }
              </div>
              {/* Camera button overlay */}
              <button onClick={function() { fileRef.current && fileRef.current.click(); }}
                style={{ position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', color: '#fff', border: '2px solid #fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, boxShadow: 'var(--shadow)' }}
                title="Upload photo">
                📷
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange}/>
            </div>
            {uploading && <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Processing image...</div>}
            <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>{name || 'Your Name'}</div>
            <div style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>{store.currentUser.email}</div>

            {/* Upload / URL options */}
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-outline btn-sm" onClick={function() { fileRef.current && fileRef.current.click(); }}>
                📁 Upload Photo
              </button>
              {avatarUrl && (
                <button className="btn btn-ghost btn-sm" onClick={function() { setAvatarUrl(''); }}
                  style={{ color: 'var(--danger)' }}>
                  Remove
                </button>
              )}
            </div>
          </div>

          {success && (
            <div style={{ padding: '10px 14px', background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 8, color: 'var(--success)', fontSize: '0.85rem', marginBottom: 16, fontWeight: 600 }}>
              ✅ {success}
            </div>
          )}

          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" value={name} onChange={function(e) { setName(e.target.value); }} maxLength={100} required/>
            </div>
            <div className="form-group">
              <label className="form-label">Bio</label>
              <textarea className="form-textarea" value={bio} onChange={function(e) { setBio(e.target.value); }} rows={2} placeholder="Tell something about yourself..."/>
            </div>
            <div className="form-group">
              <label className="form-label">Or use image URL</label>
              <input className="form-input" value={avatarUrl && !avatarUrl.startsWith('data:') ? avatarUrl : ''} onChange={function(e) { setAvatarUrl(e.target.value); }} placeholder="https://example.com/photo.jpg"/>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Department</label>
                <input className="form-input" value={department} onChange={function(e) { setDepartment(e.target.value); }} placeholder="e.g. CSE"/>
              </div>
              <div className="form-group">
                <label className="form-label">Year</label>
                <select className="form-select" value={year} onChange={function(e) { setYear(e.target.value); }}>
                  <option>1st Year</option><option>2nd Year</option>
                  <option>3rd Year</option><option>4th Year</option><option>PG</option>
                </select>
              </div>
            </div>
            <button className="btn btn-primary" disabled={loading || uploading} style={{ width: '100%', justifyContent: 'center' }}>
              {loading ? 'Saving...' : '💾 Save Profile'}
            </button>
          </form>
        </div>

        {/* Right: stats */}
        <div>
          <div className="stats-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 20 }}>
            <div className="stat-card">
              <div className="stat-value">{subs.filter(function(s){return s.status==='submitted';}).length}</div>
              <div className="stat-label">Exams Done</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--success)' }}>{avgScore}%</div>
              <div className="stat-label">Avg Score</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent)' }}>{bestGrade}</div>
              <div className="stat-label">Best Grade</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{subs.filter(function(s){return s.cheating_detected===1||s.status==='cheated';}).length === 0 ? '✅' : '⚠'}</div>
              <div className="stat-label">Integrity</div>
            </div>
          </div>

          {/* Recent exams */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 14 }}>📋 Recent Exams</div>
            {subs.length === 0
              ? <div className="empty-state"><div className="empty-state-title">No exams taken yet</div></div>
              : subs.slice(0, 5).map(function(s, i) {
                var pct = s.total_marks > 0 ? Math.round((s.total_score || 0) / s.total_marks * 100) : 0;
                var gc  = s.grade === 'A+' || s.grade === 'A' ? '#16a34a' : s.grade === 'F' ? '#dc2626' : s.grade === 'B' ? '#2563eb' : '#d97706';
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.title || ('Exam #' + s.exam_id)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{pct}% · {s.status}</div>
                    </div>
                    <span style={{ fontWeight: 800, color: gc, fontSize: '1.1rem' }}>{s.grade || '-'}</span>
                  </div>
                );
              })
            }
          </div>
        </div>
      </div>
    </div>
  );
}
