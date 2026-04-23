import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet } from '../../utils/api';
import { io } from 'socket.io-client';
import JitsiMeet from '../JitsiMeet';

var SOCKET_URL = 'http://localhost:5000';

export default function VivaJoin() {
  var store = useStore();
  var [phase,       setPhase]    = useState('join');
  var [roomId,      setRoomId]   = useState('');
  var [session,     setSession]  = useState(null);
  var [invites,     setInvites]  = useState([]);
  var [currentQ,    setCurrentQ] = useState('');
  var [qFlash,      setQFlash]   = useState(false);
  var sockRef   = useRef(null);
  var roomIdRef = useRef('');
  var synthRef  = useRef(window.speechSynthesis);

  useEffect(function() {
    apiGet('/notifications').then(function(n) {
      setInvites((n||[]).filter(function(x){ return x.viva_room_id; }));
    }).catch(function(){});
  }, []); // eslint-disable-line

  useEffect(function() {
    return function() { if (sockRef.current) sockRef.current.disconnect(); };
  }, []); // eslint-disable-line

  function connectSocket(vivaId) {
    if (sockRef.current) { sockRef.current.disconnect(); }
    var s = io(SOCKET_URL);
    sockRef.current = s;
    s.on('connect', function() {
      var name = store.currentUser ? (store.currentUser.name || 'Student') : 'Student';
      s.emit('join-viva-room', { vivaId: vivaId, role: 'student', userName: name });
    });
    // Receive question from examiner — show it and read aloud
    s.on('question-text', function(data) {
      setCurrentQ(data.text);
      setQFlash(true);
      setTimeout(function() { setQFlash(false); }, 1000);
      // Read question aloud on student's device
      if (synthRef.current) {
        synthRef.current.cancel();
        var utt = new SpeechSynthesisUtterance(data.text);
        utt.rate = 0.88; utt.pitch = 1.0;
        synthRef.current.speak(utt);
      }
    });
  }

  async function handleJoin(id) {
    var vid = (id || roomId || '').trim();
    if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      if (!s) { alert('Room not found'); return; }
      setSession(s); setRoomId(vid); roomIdRef.current = vid;
      setPhase('room');
      connectSocket(vid);
    } catch(e) { alert('Room not found: ' + e.message); }
  }

  function leave() {
    if (sockRef.current) { sockRef.current.disconnect(); sockRef.current = null; }
    if (synthRef.current) synthRef.current.cancel();
    setPhase('join'); setSession(null); setRoomId(''); roomIdRef.current = ''; setCurrentQ('');
  }

  if (phase === 'join') return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">🎙 Viva Voce</div>
          <div className="page-subtitle">Join your oral examination</div>
        </div>
      </div>
      {invites.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>📬 Your Invitations</div>
          <div className="grid-2">
            {invites.map(function(inv) { return (
              <div key={inv.notification_id} className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{inv.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginBottom: 14 }}>{inv.message}</div>
                <button className="btn btn-primary btn-sm" onClick={function(){ handleJoin(inv.viva_room_id); }}>🚀 Join Now</button>
              </div>
            ); })}
          </div>
        </div>
      )}
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-title">Join by Room ID</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input className="form-input" value={roomId}
            onChange={function(e){ setRoomId(e.target.value); roomIdRef.current = e.target.value; }}
            placeholder="Paste Room ID…" style={{ flex: 1 }}/>
          <button className="btn btn-primary" onClick={function(){ handleJoin(); }} disabled={!roomId.trim()}>Join</button>
        </div>
      </div>
    </div>
  );

  var studentName = store.currentUser ? (store.currentUser.name || 'Student') : 'Student';

  return (
    <div className="viva-dark fade-up">
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="badge badge-success">🟢 In Room</span>
          <span style={{ fontWeight: 700, color: '#fff' }}>{session ? session.title : 'Viva Session'}</span>
        </div>
        <button className="btn btn-sm btn-outline" onClick={function(){ if(window.confirm('Leave?')) leave(); }}>Leave</button>
      </div>

      {/* Current Question Banner — shows when examiner asks */}
      {currentQ ? (
        <div style={{
          padding: '16px 20px', marginBottom: 14,
          background: qFlash ? 'rgba(124,58,237,.35)' : 'rgba(124,58,237,.15)',
          border: '2px solid rgba(124,58,237,.5)',
          borderRadius: 12, transition: 'background 0.4s'
        }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#a78bfa', letterSpacing: 1, marginBottom: 6, fontFamily: 'JetBrains Mono,monospace' }}>
            🔊 CURRENT QUESTION
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', lineHeight: 1.5 }}>{currentQ}</div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 8 }}>Speak your answer clearly into the microphone</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', marginBottom: 14, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, textAlign: 'center', color: '#6b7280', fontSize: '0.82rem' }}>
          ⏳ Waiting for examiner to ask a question…
        </div>
      )}

      {/* Jitsi video call */}
      <div className="card" style={{ padding: 8 }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 8, textAlign: 'center', fontFamily: 'JetBrains Mono,monospace' }}>
          📹 LIVE VIDEO CALL
        </div>
        <JitsiMeet roomName={roomId} displayName={studentName} height={440} />
      </div>

      <div style={{ marginTop: 12, padding: '10px 16px', background: 'rgba(124,58,237,.1)', border: '1px solid rgba(124,58,237,.25)', borderRadius: 10, fontSize: '0.82rem', color: '#a78bfa', textAlign: 'center' }}>
        🎤 Speak clearly when a question appears above. Your examiner can see and hear you.
      </div>
    </div>
  );
}
