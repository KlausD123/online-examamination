import React, { useState } from 'react';
import { useStore } from '../store/useStore';

export default function AuthPage() {
  var store = useStore();
  var [tab, setTab] = useState('login');
  var [email, setEmail] = useState('');
  var [password, setPassword] = useState('');
  var [name, setName] = useState('');
  var [department, setDepartment] = useState('');
  var [year, setYear] = useState('1st Year');
  var [error, setError] = useState('');
  var [loading, setLoading] = useState(false);
  var [success, setSuccess] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await store.login(email, password);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    if (!name || name.length > 100) { setError('Name is required (max 100 chars)'); setLoading(false); return; }
    if (!email || !/\S+@\S+\.\S+/.test(email)) { setError('Valid email required'); setLoading(false); return; }
    if (!password || password.length < 6 || password.length > 100) { setError('Password must be 6-100 chars'); setLoading(false); return; }
    try {
      await store.register(name, email, password, department, year);
      setSuccess('Registration successful! Please login.');
      setTab('login');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-card fade-up">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: '2.5rem' }}>🎓</span>
        </div>
        <div className="auth-title">DExam</div>
        <div className="auth-subtitle">AI-Powered Examination Platform</div>

        <div className="tabs" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <button className={'tab-btn' + (tab === 'login' ? ' active' : '')} onClick={function() { setTab('login'); setError(''); }} style={{ color: tab === 'login' ? '#a78bfa' : '#6b7280' }}>Login</button>
          <button className={'tab-btn' + (tab === 'register' ? ' active' : '')} onClick={function() { setTab('register'); setError(''); }} style={{ color: tab === 'register' ? '#a78bfa' : '#6b7280' }}>Register</button>
        </div>

        {error && <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, color: '#f87171', fontSize: '0.85rem', marginBottom: 16 }}>{error}</div>}
        {success && <div style={{ padding: '10px 14px', background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 8, color: '#4ade80', fontSize: '0.85rem', marginBottom: 16 }}>{success}</div>}

        {tab === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={email} onChange={function(e) { setEmail(e.target.value); }} placeholder="Enter your email" required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={function(e) { setPassword(e.target.value); }} placeholder="Enter your password" required />
            </div>
            <button className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
              {loading ? '⏳ Signing in...' : '🚀 Sign In'}
            </button>
            <div className="auth-hint">
              <div>👤 Admin: admin@dexam.com / Admin@123</div>
              <div style={{ marginTop: 4, opacity: 0.7 }}>📝 Students: Use the Register tab</div>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRegister}>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" value={name} onChange={function(e) { setName(e.target.value); }} placeholder="Your full name" required />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={email} onChange={function(e) { setEmail(e.target.value); }} placeholder="Your email" required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={function(e) { setPassword(e.target.value); }} placeholder="Min 6 characters" required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Department</label>
                <input className="form-input" value={department} onChange={function(e) { setDepartment(e.target.value); }} placeholder="e.g. CSE" />
              </div>
              <div className="form-group">
                <label className="form-label">Year</label>
                <select className="form-select" value={year} onChange={function(e) { setYear(e.target.value); }} style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: '#e5e5e5' }}>
                  <option value="1st Year">1st Year</option>
                  <option value="2nd Year">2nd Year</option>
                  <option value="3rd Year">3rd Year</option>
                  <option value="4th Year">4th Year</option>
                </select>
              </div>
            </div>
            <button className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
              {loading ? '⏳ Creating...' : '✨ Create Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
