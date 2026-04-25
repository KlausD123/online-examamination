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
      setSuccess('Registration successful! Please login.');
      setTab('login');
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">🎓</div>
        <div className="auth-title">DExam</div>

        <div className="auth-tabs">
          <button className={tab === 'login' ? 'active' : ''} onClick={function() { setTab('login'); setError(''); setSuccess(''); }}>Login</button>
          <button className={tab === 'register' ? 'active' : ''} onClick={function() { setTab('register'); setError(''); setSuccess(''); }}>Register</button>
        </div>

        {error   && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}

        {tab === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={email} onChange={function(e) { setEmail(e.target.value); }} placeholder="Your email" required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={function(e) { setPassword(e.target.value); }} placeholder="Your password" required />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
              {loading ? 'Signing in…' : '🚀 Sign In'}
            </button>
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
                <select className="form-select" value={year} onChange={function(e) { setYear(e.target.value); }}>
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
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
              {loading ? 'Creating account…' : '✅ Create Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
