import { useState } from 'react';
import { getPasswordStrength } from '../utils/helpers';

const API = 'http://localhost:5000/api';
const getToken = () => localStorage.getItem('examai_token');

const ChangePassword = ({ store, onClose }) => {
  const [form,    setForm]    = useState({ current:'', newPwd:'', confirm:'' });
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const strength = getPasswordStrength(form.newPwd);

  const handleSubmit = async () => {
    setError(''); setSuccess('');
    if (!form.current) return setError('Please enter your current password.');
    if (!form.newPwd)  return setError('Please enter a new password.');
    if (!strength.strong) return setError('New password must meet all 4 requirements.');
    if (form.newPwd !== form.confirm) return setError('Passwords do not match.');
    if (form.current === form.newPwd) return setError('New password must be different from current password.');

    setLoading(true);
    try {
      const res  = await fetch(`${API}/auth/change-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ current_password: form.current, new_password: form.newPwd }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setSuccess('✅ Password changed successfully!');
        store.addToast('Password changed!', 'success');
        setTimeout(() => onClose(), 1500);
      }
    } catch { setError('Cannot connect to server.'); }
    setLoading(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'var(--surface)', borderRadius:16, padding:28, width:'100%', maxWidth:420, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div style={{ fontFamily:'Syne', fontWeight:800, fontSize:18, color:'var(--text)' }}>🔒 Change Password</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {error   && <div className="alert alert-error" style={{ marginBottom:14 }}>{error}</div>}
        {success && <div style={{ background:'rgba(5,150,105,0.08)', border:'1px solid rgba(5,150,105,0.3)', color:'var(--success)', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:13 }}>{success}</div>}

        <div className="form-group">
          <label className="form-label">Current Password</label>
          <input className="form-input" name="current" type="password" value={form.current} onChange={handle} placeholder="Your current password" />
        </div>
        <div className="form-group">
          <label className="form-label">New Password</label>
          <input className="form-input" name="newPwd" type="password" value={form.newPwd} onChange={handle} placeholder="Min 8 chars, uppercase, number, symbol" />
          {form.newPwd.length > 0 && (
            <div style={{ marginTop:10, padding:'12px 14px', background:'#f5f6ff', borderRadius:8, border:'1px solid #dde0f5' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
                {[{key:'length',label:'Min 8 chars'},{key:'uppercase',label:'Uppercase'},{key:'number',label:'Number'},{key:'special',label:'Special char'}].map(({key,label}) => (
                  <div key={key} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                    <span style={{ color: strength.checks[key] ? '#059669':'#dc2626' }}>{strength.checks[key] ? '✓':'✕'}</span>
                    <span style={{ color: strength.checks[key] ? '#059669':'#9ca3af' }}>{label}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:8, height:4, background:'#dde0f5', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:3, transition:'width 0.3s', width:`${strength.passed*25}%`, background: strength.passed<=1?'#dc2626':strength.passed===2?'#d97706':strength.passed===3?'#0ea5e9':'#059669' }} />
              </div>
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Confirm New Password</label>
          <input className="form-input" name="confirm" type="password" value={form.confirm} onChange={handle} placeholder="Re-enter new password"
            style={{ borderColor: form.confirm && form.confirm !== form.newPwd ? 'var(--danger)' : undefined }} />
          {form.confirm && form.confirm !== form.newPwd && <div style={{ fontSize:11, color:'var(--danger)', marginTop:4 }}>Passwords do not match</div>}
          {form.confirm && form.confirm === form.newPwd && form.confirm.length > 0 && <div style={{ fontSize:11, color:'var(--success)', marginTop:4 }}>✓ Passwords match</div>}
        </div>

        <div style={{ display:'flex', gap:10, marginTop:4 }}>
          <button className="btn btn-secondary" style={{ flex:1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex:1 }} onClick={handleSubmit} disabled={loading}>
            {loading ? <><div className="spinner" style={{ width:12, height:12 }} />Saving...</> : '🔒 Change Password'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangePassword;
