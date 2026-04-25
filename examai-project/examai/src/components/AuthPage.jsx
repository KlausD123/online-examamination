import React, { useState } from 'react';
import { useStore } from '../store/useStore';

export default function AuthPage() {
  var store = useStore();
  var [tab,        setTab]        = useState('login');
  var [email,      setEmail]      = useState('');
  var [password,   setPassword]   = useState('');
  var [name,       setName]       = useState('');
  var [department, setDepartment] = useState('');
  var [year,       setYear]       = useState('1st Year');
  var [error,      setError]      = useState('');
  var [loading,    setLoading]    = useState(false);
  var [success,    setSuccess]    = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try { await store.login(email, password); }
    catch (err) { setError(err.message); }
    setLoading(false);
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    if (!name || name.length > 100) { setError('Name is required'); setLoading(false); return; }
    if (!email || !/\S+@\S+\.\S+/.test(email)) { setError('Valid email required'); setLoading(false); return; }
    if (!password || password.length < 6) { setError('Password must be at least 6 characters'); setLoading(false); return; }
    try {
      await store.register(name, email, password, department, year);
      setSuccess('Account created! Please login.');
      setTab('login');
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 4 }}>🎓</div>
          <div className="auth-title">DExam</div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 28 }}>
          <button onClick={function() { setTab('login'); setError(''); setSuccess(''); }}
            style={{ flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', fontWeight: tab==='login'?700:400, color: tab==='login'?'var(--accent)':'#9ca3af', borderBottom: tab==='login'?'2px solid var(--accent)':'2px solid transparent', fontSize: '0.95rem', fontFamily: 'Space Grotesk, sans-serif', transition: 'all 0.2s' }}>
            Login
          </button>
          <button onClick={function() { setTab('register'); setError(''); setSuccess(''); }}
            style={{ flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', fontWeight: tab==='register'?700:400, color: tab==='register'?'var(--accent)':'#9ca3af', borderBottom: tab==='register'?'2px solid var(--accent)':'2px solid transparent', fontSize: '0.95rem', fontFamily: 'Space Grotesk, sans-serif', transition: 'all 0.2s' }}>
            Register
          </button>
        </div>

        {error   && <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, color: '#f87171', fontSize: '0.85rem', marginBottom: 16 }}>{error}</div>}
        {success && <div style={{ padding: '10px 14px', background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: 8, color: '#4ade80', fontSize: '0.85rem', marginBottom: 16 }}>{success}</div>}

        {tab === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">EMAIL</label>
              <input className="form-input" type="email" value={email} onChange={function(e){setEmail(e.target.value);}} placeholder="your@email.com" required/>
            </div>
            <div className="form-group">
              <label className="form-label">PASSWORD</label>
              <input className="form-input" type="password" value={password} onChange={function(e){setPassword(e.target.value);}} placeholder="••••••••" required/>
            </div>
            <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', marginTop: 8, padding:'12px' }} disabled={loading}>
              {loading ? 'Signing in…' : '🚀 Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister}>
            <div className="form-group">
              <label className="form-label">FULL NAME</label>
              <input className="form-input" value={name} onChange={function(e){setName(e.target.value);}} placeholder="Your full name" required/>
            </div>
            <div className="form-group">
              <label className="form-label">EMAIL</label>
              <input className="form-input" type="email" value={email} onChange={function(e){setEmail(e.target.value);}} placeholder="your@email.com" required/>
            </div>
            <div className="form-group">
              <label className="form-label">PASSWORD</label>
              <input className="form-input" type="password" value={password} onChange={function(e){setPassword(e.target.value);}} placeholder="Min 6 characters" required/>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div className="form-group">
                <label className="form-label">DEPARTMENT</label>
                <input className="form-input" value={department} onChange={function(e){setDepartment(e.target.value);}} placeholder="e.g. CSE"/>
              </div>
              <div className="form-group">
                <label className="form-label">YEAR</label>
                <select className="form-select" value={year} onChange={function(e){setYear(e.target.value);}} style={{ background:'rgba(255,255,255,0.06)', border:'1.5px solid rgba(255,255,255,0.1)', color:'#e5e5e5' }}>
                  <option value="1st Year">1st Year</option>
                  <option value="2nd Year">2nd Year</option>
                  <option value="3rd Year">3rd Year</option>
                  <option value="4th Year">4th Year</option>
                  <option value="PG 1st Year">PG 1st Year</option>
                  <option value="PG 2nd Year">PG 2nd Year</option>
                  <option value="Standard 1">Standard 1</option>
                  <option value="Standard 2">Standard 2</option>
                  <option value="Standard 3">Standard 3</option>
                  <option value="Standard 4">Standard 4</option>
                  <option value="Standard 5">Standard 5</option>
                  <option value="Standard 6">Standard 6</option>
                  <option value="Standard 7">Standard 7</option>
                  <option value="Standard 8">Standard 8</option>
                  <option value="Standard 9">Standard 9</option>
                  <option value="Standard 10">Standard 10</option>
                  <option value="Standard 11">Standard 11</option>
                  <option value="Standard 12">Standard 12</option>
                </select>
              </div>
            </div>
            <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', marginTop:8, padding:'12px' }} disabled={loading}>
              {loading ? 'Creating account…' : '✅ Create Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
