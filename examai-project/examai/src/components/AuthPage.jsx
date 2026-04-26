import React, { useState } from 'react';
import { useStore } from '../store/useStore';

var API = 'https://online-examamination-production.up.railway.app/api';

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

  // Forgot password state
  var [fpStep,    setFpStep]    = useState('email');   // 'email' | 'otp' | 'done'
  var [fpEmail,   setFpEmail]   = useState('');
  var [fpOtp,     setFpOtp]     = useState('');
  var [fpPass,    setFpPass]    = useState('');
  var [fpConfirm, setFpConfirm] = useState('');

  function reset() { setError(''); setSuccess(''); }
  function switchTab(t) { reset(); setTab(t); setFpStep('email'); setFpEmail(''); setFpOtp(''); setFpPass(''); setFpConfirm(''); }

  async function handleLogin(e) {
    e.preventDefault(); reset(); setLoading(true);
    try { await store.login(email, password); }
    catch (err) { setError(err.message); }
    setLoading(false);
  }

  async function handleRegister(e) {
    e.preventDefault(); reset(); setLoading(true);
    if (!name || name.length > 100) { setError('Name is required'); setLoading(false); return; }
    if (!email || !/\S+@\S+\.\S+/.test(email)) { setError('Valid email required'); setLoading(false); return; }
    if (!password || password.length < 6) { setError('Password must be at least 6 characters'); setLoading(false); return; }
    try {
      await store.register(name, email, password, department, year);
      setSuccess('Account created! Please login.');
      switchTab('login');
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  async function handleSendOtp(e) {
    e.preventDefault(); reset(); setLoading(true);
    if (!fpEmail || !/\S+@\S+\.\S+/.test(fpEmail)) { setError('Enter a valid email'); setLoading(false); return; }
    try {
      var r = await fetch(API + '/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fpEmail }),
      });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setFpStep('otp');
      setSuccess('A 6-digit code was sent to ' + fpEmail + '. Check your inbox.');
    } catch(err) { setError(err.message); }
    setLoading(false);
  }

  async function handleResetPassword(e) {
    e.preventDefault(); reset(); setLoading(true);
    if (!fpOtp.trim()) { setError('Enter the code from your email'); setLoading(false); return; }
    if (fpPass.length < 6) { setError('Password must be at least 6 characters'); setLoading(false); return; }
    if (fpPass !== fpConfirm) { setError('Passwords do not match'); setLoading(false); return; }
    try {
      var r = await fetch(API + '/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fpEmail, otp: fpOtp.trim(), newPassword: fpPass }),
      });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setFpStep('done');
      setSuccess(d.message);
    } catch(err) { setError(err.message); }
    setLoading(false);
  }

  var inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#e5e5e5', fontSize: '0.95rem', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
  var labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: 700, letterSpacing: 1, color: '#9ca3af', marginBottom: 6, fontFamily: 'JetBrains Mono, monospace' };

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
          {['login', 'register', 'forgot'].map(function(t) {
            var labels = { login: 'Login', register: 'Register', forgot: 'Forgot Password' };
            return (
              <button key={t} onClick={function() { switchTab(t); }}
                style={{ flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
                  fontWeight: tab===t ? 700 : 400, color: tab===t ? 'var(--accent)' : '#9ca3af',
                  borderBottom: tab===t ? '2px solid var(--accent)' : '2px solid transparent',
                  fontSize: t === 'forgot' ? '0.78rem' : '0.95rem',
                  fontFamily: 'Space Grotesk, sans-serif', transition: 'all 0.2s' }}>
                {labels[t]}
              </button>
            );
          })}
        </div>

        {/* Messages */}
        {error   && <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, color: '#f87171', fontSize: '0.85rem', marginBottom: 16 }}>{error}</div>}
        {success && <div style={{ padding: '10px 14px', background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: 8, color: '#4ade80', fontSize: '0.85rem', marginBottom: 16 }}>{success}</div>}

        {/* ── LOGIN ── */}
        {tab === 'login' && (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">EMAIL</label>
              <input className="form-input" type="email" value={email} onChange={function(e){setEmail(e.target.value);}} placeholder="your@email.com" required/>
            </div>
            <div className="form-group">
              <label className="form-label">PASSWORD</label>
              <input className="form-input" type="password" value={password} onChange={function(e){setPassword(e.target.value);}} placeholder="••••••••" required/>
            </div>
            <div style={{ textAlign: 'right', marginTop: -8, marginBottom: 16 }}>
              <button type="button" onClick={function() { switchTab('forgot'); setFpEmail(email); }}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}>
                Forgot password?
              </button>
            </div>
            <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', padding:'12px' }} disabled={loading}>
              {loading ? 'Signing in…' : '🚀 Sign In'}
            </button>
          </form>
        )}

        {/* ── REGISTER ── */}
        {tab === 'register' && (
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
                  {['1st Year','2nd Year','3rd Year','4th Year','PG 1st Year','PG 2nd Year','Standard 1','Standard 2','Standard 3','Standard 4','Standard 5','Standard 6','Standard 7','Standard 8','Standard 9','Standard 10','Standard 11','Standard 12'].map(function(y){ return <option key={y} value={y}>{y}</option>; })}
                </select>
              </div>
            </div>
            <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', marginTop:8, padding:'12px' }} disabled={loading}>
              {loading ? 'Creating account…' : '✅ Create Account'}
            </button>
          </form>
        )}

        {/* ── FORGOT PASSWORD ── */}
        {tab === 'forgot' && (
          <div>
            {/* Step indicators */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
              {['Email', 'Enter Code', 'Done'].map(function(s, i) {
                var stepIdx = fpStep === 'email' ? 0 : fpStep === 'otp' ? 1 : 2;
                var active = i === stepIdx;
                var done   = i < stepIdx;
                return (
                  <React.Fragment key={i}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700,
                        background: done ? '#16a34a' : active ? 'var(--accent)' : 'rgba(255,255,255,.1)',
                        color: done || active ? '#fff' : '#6b7280' }}>
                        {done ? '✓' : i + 1}
                      </div>
                      <span style={{ fontSize: '0.72rem', color: active ? 'var(--accent)' : done ? '#4ade80' : '#6b7280', fontWeight: active ? 700 : 400 }}>{s}</span>
                    </div>
                    {i < 2 && <div style={{ flex: 1, height: 1, background: done ? '#16a34a' : 'rgba(255,255,255,.1)' }}/>}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Step 1 — Enter email */}
            {fpStep === 'email' && (
              <form onSubmit={handleSendOtp}>
                <div style={{ marginBottom: 20, padding: '12px 14px', background: 'rgba(124,58,237,.08)', border: '1px solid rgba(124,58,237,.2)', borderRadius: 8, fontSize: '0.82rem', color: '#a78bfa' }}>
                  Enter your registered email and we'll send you a 6-digit reset code.
                </div>
                <div className="form-group">
                  <label style={labelStyle}>YOUR EMAIL</label>
                  <input style={inputStyle} type="email" value={fpEmail} onChange={function(e){ setFpEmail(e.target.value); reset(); }} placeholder="your@email.com" required/>
                </div>
                <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', padding:'12px', marginTop: 8 }} disabled={loading}>
                  {loading ? 'Sending…' : '📧 Send Reset Code'}
                </button>
              </form>
            )}

            {/* Step 2 — Enter OTP + new password */}
            {fpStep === 'otp' && (
              <form onSubmit={handleResetPassword}>
                <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 8, fontSize: '0.82rem', color: '#4ade80' }}>
                  Code sent to <strong>{fpEmail}</strong>. Check your inbox (and spam folder).
                </div>
                <div className="form-group">
                  <label style={labelStyle}>6-DIGIT CODE</label>
                  <input style={{ ...inputStyle, fontSize: '1.4rem', fontWeight: 700, letterSpacing: 10, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}
                    type="text" inputMode="numeric" maxLength={6} value={fpOtp}
                    onChange={function(e){ setFpOtp(e.target.value.replace(/\D/g,'')); reset(); }}
                    placeholder="000000" required/>
                </div>
                <div className="form-group">
                  <label style={labelStyle}>NEW PASSWORD</label>
                  <input style={inputStyle} type="password" value={fpPass} onChange={function(e){ setFpPass(e.target.value); reset(); }} placeholder="Min 6 characters" required/>
                </div>
                <div className="form-group">
                  <label style={labelStyle}>CONFIRM PASSWORD</label>
                  <input style={{ ...inputStyle, borderColor: fpConfirm && fpPass !== fpConfirm ? '#dc2626' : fpConfirm && fpPass === fpConfirm ? '#16a34a' : 'rgba(255,255,255,0.1)' }}
                    type="password" value={fpConfirm} onChange={function(e){ setFpConfirm(e.target.value); reset(); }} placeholder="Repeat password" required/>
                </div>
                <button className="btn btn-success" style={{ width:'100%', justifyContent:'center', padding:'12px' }} disabled={loading}>
                  {loading ? 'Resetting…' : '🔒 Reset Password'}
                </button>
                <button type="button" onClick={function(){ setFpStep('email'); reset(); setSuccess(''); }}
                  style={{ width:'100%', marginTop: 8, background:'none', border:'none', color:'#9ca3af', fontSize:'0.8rem', cursor:'pointer', padding:'6px' }}>
                  ← Use a different email
                </button>
              </form>
            )}

            {/* Step 3 — Done */}
            {fpStep === 'done' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#4ade80', marginBottom: 8 }}>Password Reset!</div>
                <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: 24 }}>You can now log in with your new password.</div>
                <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', padding:'12px' }}
                  onClick={function() { switchTab('login'); setEmail(fpEmail); }}>
                  🚀 Go to Login
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
