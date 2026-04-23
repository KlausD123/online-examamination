import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet } from '../../utils/api';
import JitsiMeet from '../JitsiMeet';

export default function VivaJoin() {
  var store = useStore();
  var [phase,   setPhase]  = useState('join');
  var [roomId,  setRoomId] = useState('');
  var [session, setSession] = useState(null);
  var [invites, setInvites] = useState([]);
  var roomIdRef = useRef('');

  useEffect(function() {
    apiGet('/notifications').then(function(n) {
      setInvites((n||[]).filter(function(x){ return x.viva_room_id; }));
    }).catch(function(){});
  }, []); // eslint-disable-line

  async function handleJoin(id) {
    var vid = (id || roomId || '').trim();
    if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      if (!s) { alert('Room not found'); return; }
      setSession(s); setRoomId(vid); roomIdRef.current = vid;
      setPhase('room');
    } catch(e) { alert('Room not found: ' + e.message); }
  }

  function leave() {
    setPhase('join'); setSession(null); setRoomId(''); roomIdRef.current = '';
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="badge badge-success">🟢 In Room</span>
          <span style={{ fontWeight: 700, color: '#fff' }}>{session ? session.title : 'Viva Session'}</span>
        </div>
        <button className="btn btn-sm btn-outline" onClick={function(){ if(window.confirm('Leave?')) leave(); }}>Leave</button>
      </div>

      <div className="card" style={{ padding: 8, marginBottom: 12 }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 8, textAlign: 'center', fontFamily: 'JetBrains Mono,monospace' }}>
          📹 LIVE VIDEO CALL WITH EXAMINER
        </div>
        <JitsiMeet roomName={roomId} displayName={studentName} height={500} />
      </div>

      <div style={{ padding: '10px 16px', background: 'rgba(124,58,237,.1)', border: '1px solid rgba(124,58,237,.25)', borderRadius: 10, fontSize: '0.82rem', color: '#a78bfa', textAlign: 'center' }}>
        🎤 You are connected to your examiner. Make sure your camera and mic are enabled.
      </div>
    </div>
  );
}
