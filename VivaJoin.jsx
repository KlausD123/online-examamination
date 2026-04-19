import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet, apiPost } from '../../utils/api';

export default function VivaJoin() {
  var store = useStore();
  var [phase,         setPhase]         = useState('join');
  var [roomId,        setRoomId]        = useState('');
  var [invites,       setInvites]       = useState([]);
  var [session,       setSession]       = useState(null);
  var [camOk,         setCamOk]         = useState(false);
  var [micOk,         setMicOk]         = useState(false);
  var [permError,     setPermError]     = useState('');
  var [camOn,         setCamOn]         = useState(true);
  var [micOn,         setMicOn]         = useState(true);
  var [awayTime,      setAwayTime]      = useState(null);
  var [awayCountdown, setAwayCountdown] = useState(600);
  var [notifSent,     setNotifSent]     = useState(false); // prevent duplicate away-notifications

  var previewRef = useRef(null);
  var selfVidRef = useRef(null);
  var streamRef  = useRef(null);
  var awayRef    = useRef(null);   // holds the interval

  // ── Load viva invitations from notifications ───────────────
  useEffect(function () { loadInvites(); }, []); // eslint-disable-line

  function loadInvites() {
    store.loadNotifications().then(function (notifs) {
      setInvites((notifs || []).filter(function (n) { return n.viva_room_id; }));
    });
  }

  // ── Join a viva room ───────────────────────────────────────
  async function handleJoin(id) {
    var vid = id || roomId;
    if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      setSession(s);
      setRoomId(vid);
      setPhase('permission');
    } catch (e) { alert('Room not found: ' + e.message); }
  }

  // ── Request camera + mic ───────────────────────────────────
  async function requestPermissions() {
    setPermError('');
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setCamOk(true);
      setMicOk(true);
      var attempts = 0;
      var iv = setInterval(function () {
        if (previewRef.current) { previewRef.current.srcObject = stream; clearInterval(iv); }
        if (++attempts > 20) clearInterval(iv);
      }, 200);
    } catch (e) {
      setPermError(e.name === 'NotAllowedError'
        ? 'Permission denied. Click the camera icon in your browser address bar to allow access, then refresh.'
        : 'Camera / Mic access denied. Please allow in browser settings and try again.');
    }
  }

  function enterRoom() {
    setPhase('room');
    setTimeout(function () {
      if (selfVidRef.current && streamRef.current) selfVidRef.current.srcObject = streamRef.current;
    }, 300);
  }

  function toggleCam() {
    if (streamRef.current) { streamRef.current.getVideoTracks().forEach(function (t) { t.enabled = !camOn; }); setCamOn(!camOn); }
  }
  function toggleMic() {
    if (streamRef.current) { streamRef.current.getAudioTracks().forEach(function (t) { t.enabled = !micOn; }); setMicOn(!micOn); }
  }

  // ── Away detection: fires when tab is hidden or window blurs
  useEffect(function () {
    if (phase !== 'room') return;
    function handleAway() {
      if (document.hidden && !awayRef.current) {
        var now = Date.now();
        setAwayTime(now);
        setNotifSent(false);
        localStorage.setItem('viva_away', JSON.stringify({ viva_id: roomId, since: now }));
        // ── Notify examiner: student left ──
        apiPost('/notifications', {
          title:   'Student Left Viva Room',
          message: (store.currentUser.name || 'Student') + ' left the viva session "' + (session ? session.title : roomId) + '". They have 10 minutes to return before being automatically removed. Room: ' + roomId,
          type:    'urgent',
        }).catch(function () {});
      }
    }
    document.addEventListener('visibilitychange', handleAway);
    window.addEventListener('blur', handleAway);
    return function () {
      document.removeEventListener('visibilitychange', handleAway);
      window.removeEventListener('blur', handleAway);
    };
  }, [phase, roomId, session]); // eslint-disable-line

  // ── Away countdown: runs while student is gone ─────────────
  useEffect(function () {
    if (!awayTime) { clearInterval(awayRef.current); awayRef.current = null; return; }
    clearInterval(awayRef.current);
    awayRef.current = setInterval(function () {
      var elapsed   = Math.floor((Date.now() - awayTime) / 1000);
      var remaining = 600 - elapsed;
      if (remaining <= 0) {
        clearInterval(awayRef.current);
        awayRef.current = null;
        // Stop media
        if (streamRef.current) streamRef.current.getTracks().forEach(function (t) { t.stop(); });
        setPhase('join');
        localStorage.removeItem('viva_away');
        // ── Notify examiner: student timed out ──
        apiPost('/notifications', {
          title:   'Student Removed — Viva Timeout',
          message: (store.currentUser.name || 'Student') + ' did not return within 10 minutes and was automatically removed from "' + (session ? session.title : roomId) + '". Room: ' + roomId,
          type:    'urgent',
        }).catch(function () {});
        alert('You were removed from the viva room after 10 minutes away.');
      } else {
        setAwayCountdown(remaining);
      }
    }, 1000);
    return function () { clearInterval(awayRef.current); awayRef.current = null; };
  }, [awayTime]); // eslint-disable-line

  // ── Return from away ───────────────────────────────────────
  function returnFromAway() {
    var wasAway = awayTime;
    setAwayTime(null);
    setAwayCountdown(600);
    localStorage.removeItem('viva_away');
    if (wasAway) {
      // ── Notify examiner: student returned ──
      apiPost('/notifications', {
        title:   'Student Returned to Viva Room',
        message: (store.currentUser.name || 'Student') + ' returned to "' + (session ? session.title : roomId) + '" after being away.',
        type:    'success',
      }).catch(function () {});
    }
    // Re-attach video stream
    setTimeout(function () {
      if (selfVidRef.current && streamRef.current) selfVidRef.current.srcObject = streamRef.current;
    }, 200);
  }

  // ── Poll for examiner ending the session ─────────────────
  useEffect(function() {
    if (phase !== 'room' || !roomId) return;
    var vivaPollRef = setInterval(async function() {
      try {
        var s = await apiGet('/viva/' + roomId);
        if (s && (s.status === 'ended' || s.ended === 1 || s.ended === true)) {
          clearInterval(vivaPollRef);
          if (streamRef.current) streamRef.current.getTracks().forEach(function(t){ t.stop(); });
          setPhase('ended_by_examiner');
        }
      } catch(e) {}
    }, 8000);
    return function() { clearInterval(vivaPollRef); };
  }, [phase, roomId]); // eslint-disable-line

  // ── AWAY SCREEN ────────────────────────────────────────────
  if (phase === 'ended_by_examiner') {
    return (
      <div style={{ minHeight:'calc(100vh - 60px)', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', background:'#0d0d14', gap:0 }}>
        <div style={{ fontSize:'3rem', marginBottom:14 }}>🏁</div>
        <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:800, fontSize:'1.5rem', color:'#fff', marginBottom:8 }}>Viva Session Ended</div>
        <div style={{ fontSize:'0.9rem', color:'#9ca3af', marginBottom:28, textAlign:'center', maxWidth:380 }}>The examiner has ended this viva session. Your results will be available shortly in My Results.</div>
        <button className="btn btn-outline" onClick={function(){ setPhase('join'); setSession(null); setRoomId(''); }}>← Back to Viva</button>
      </div>
    );
  }

  if (awayTime && phase === 'room') {
    var m = Math.floor(awayCountdown / 60);
    var s = awayCountdown % 60;
    return (
      <div style={{ minHeight:'calc(100vh - 60px)', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', background:'#0d0d14', gap:0 }}>
        <div style={{ fontSize:'3.5rem', marginBottom:16 }}>⏸</div>
        <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:800, fontSize:'1.6rem', color:'#fff', marginBottom:8 }}>You left the Viva Room</div>
        <div style={{ fontSize:'0.9rem', color:'#9ca3af', marginBottom:24, textAlign:'center' }}>Your examiner has been notified. Return before the timer expires.</div>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'3rem', fontWeight:900, color: awayCountdown < 120 ? '#dc2626' : '#f59e0b', letterSpacing:4 }}>
          {String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
        </div>
        <div style={{ fontSize:'0.82rem', color:'#6b7280', marginTop:8, marginBottom:32 }}>
          {awayCountdown < 60 ? 'Less than a minute left!' : 'Return within ' + m + ' min ' + (s>0?s+'s':'') }
        </div>
        <button className="btn btn-primary btn-lg" onClick={returnFromAway}>▶ Return to Viva Room</button>
        <div style={{ marginTop:16, padding:'10px 20px', background:'rgba(220,38,38,.1)', border:'1px solid rgba(220,38,38,.3)', borderRadius:8, color:'#f87171', fontSize:'0.8rem', textAlign:'center', maxWidth:360 }}>
          ⚠️ Your examiner has been notified that you left. Failing to return will remove you from the session.
        </div>
      </div>
    );
  }

  // ── JOIN PHASE ─────────────────────────────────────────────
  if (phase === 'join') {
    return (
      <div className="fade-up">
        <div className="page-header">
          <div>
            <div className="page-title">🎙 Viva Voce</div>
            <div className="page-subtitle">Join your oral examination session</div>
          </div>
        </div>

        {invites.length > 0 && (
          <div style={{ marginBottom:28 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
              <div style={{ fontWeight:700, fontSize:'1rem' }}>📬 Your Viva Invitations</div>
              <button className="btn btn-ghost btn-sm" onClick={loadInvites}>↻ Refresh</button>
            </div>
            <div className="grid-2">
              {invites.map(function (inv) {
                return (
                  <div key={inv.notification_id} className="card" style={{ borderLeft:'4px solid var(--accent)' }}>
                    <div style={{ fontWeight:700, marginBottom:6 }}>{inv.title}</div>
                    <div style={{ fontSize:'0.85rem', color:'var(--text3)', marginBottom:14 }}>{inv.message}</div>
                    <button className="btn btn-primary btn-sm" onClick={function () { handleJoin(inv.viva_room_id); }}>
                      🚀 Join Now
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="card" style={{ maxWidth:480 }}>
          <div className="card-title">Join by Room ID</div>
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <input className="form-input" value={roomId} onChange={function (e) { setRoomId(e.target.value); }} placeholder="Paste Room ID here…" style={{ flex:1 }}/>
            <button className="btn btn-primary" onClick={function () { handleJoin(); }} disabled={!roomId.trim()}>Join</button>
          </div>
          <div style={{ marginTop:12, fontSize:'0.8rem', color:'var(--text3)' }}>
            Ask your examiner for the Room ID if you don't have an invitation.
          </div>
        </div>
      </div>
    );
  }

  // ── PERMISSION PHASE ───────────────────────────────────────
  if (phase === 'permission') {
    return (
      <div className="fade-up" style={{ maxWidth:520, margin:'40px auto', textAlign:'center' }}>
        <div style={{ fontSize:'3rem', marginBottom:12 }}>🎥</div>
        <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:800, fontSize:'1.4rem', marginBottom:6 }}>Camera & Microphone</div>
        <div style={{ color:'var(--text3)', marginBottom:24 }}>Both are required for your viva session</div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:20 }}>
          {[
            { icon: camOk ? '✅' : '📷', label:'Camera',      ok: camOk },
            { icon: micOk ? '✅' : '🎤', label:'Microphone', ok: micOk },
          ].map(function (item, i) {
            return (
              <div key={i} className="card" style={{ textAlign:'center', padding:20 }}>
                <div style={{ fontSize:'1.6rem', marginBottom:8 }}>{item.icon}</div>
                <div style={{ fontWeight:700 }}>{item.label}</div>
                <div style={{ fontSize:'0.8rem', color: item.ok ? 'var(--success)' : 'var(--text3)', marginTop:3 }}>{item.ok ? 'Ready ✓' : 'Pending'}</div>
              </div>
            );
          })}
        </div>

        {camOk && (
          <div style={{ marginBottom:18 }}>
            <video ref={previewRef} autoPlay muted playsInline style={{ width:'100%', maxWidth:320, borderRadius:12, background:'#000' }}/>
          </div>
        )}

        {permError && (
          <div style={{ padding:12, background:'rgba(220,38,38,.08)', border:'1px solid rgba(220,38,38,.2)', borderRadius:8, color:'var(--danger)', fontSize:'0.85rem', marginBottom:16 }}>
            {permError}
          </div>
        )}

        {!camOk
          ? <button className="btn btn-primary btn-lg" onClick={requestPermissions}>🔓 Grant Camera & Mic Access</button>
          : <button className="btn btn-success btn-lg" onClick={enterRoom}>🚀 Enter Viva Room</button>
        }
      </div>
    );
  }

  // ── ROOM PHASE ─────────────────────────────────────────────
  return (
    <div className="viva-dark fade-up">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span className="badge badge-success">🟢 Connected</span>
          <span style={{ fontWeight:700, color:'#fff', fontSize:'1.05rem' }}>{session ? session.title : 'Viva Session'}</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className={'btn btn-sm '+(camOn?'btn-success':'btn-danger')} onClick={toggleCam}>{camOn?'📷 Cam On':'📷 Cam Off'}</button>
          <button className={'btn btn-sm '+(micOn?'btn-success':'btn-danger')} onClick={toggleMic}>{micOn?'🎤 Mic On':'🎤 Mic Off'}</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, maxWidth:820, margin:'0 auto' }}>
        {/* Self feed */}
        <div className="card" style={{ padding:12 }}>
          <video ref={selfVidRef} autoPlay muted playsInline style={{ width:'100%', borderRadius:8, background:'#000', minHeight:200, objectFit:'cover' }}/>
          <div style={{ textAlign:'center', marginTop:8, fontSize:'0.82rem', color:'#9ca3af' }}>You ({store.currentUser.name})</div>
        </div>
        {/* Examiner placeholder */}
        <div className="card" style={{ padding:12, display:'flex', alignItems:'center', justifyContent:'center', minHeight:200 }}>
          <div style={{ textAlign:'center', color:'#9ca3af' }}>
            <div style={{ fontSize:'3rem', marginBottom:10 }}>👨‍🏫</div>
            <div style={{ fontWeight:600 }}>Examiner</div>
            <div style={{ fontSize:'0.78rem', marginTop:4 }}>Examiner controls the session</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:820, margin:'14px auto 0', padding:'12px 16px', background:'rgba(124,58,237,.1)', border:'1px solid rgba(124,58,237,.25)', borderRadius:10, fontSize:'0.82rem', color:'#a78bfa', textAlign:'center' }}>
        ℹ Leaving this tab or window will notify your examiner and start a 10-minute countdown. Return before it expires to avoid being removed.
      </div>
    </div>
  );
}
