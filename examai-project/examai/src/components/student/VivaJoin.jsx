import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet } from '../../utils/api';
import JitsiMeet from '../JitsiMeet';

export default function VivaJoin() {
  var store = useStore();
  var [phase,    setPhase]   = useState('join');
  var [roomId,   setRoomId]  = useState('');
  var [session,  setSession] = useState(null);
  var [invites,  setInvites] = useState([]);
  var [currentQ, setCurrentQ] = useState('');
  var [qFlash,   setQFlash]  = useState(false);
  var synthRef = useRef(window.speechSynthesis);

  useEffect(function() {
    // Load invites and filter out expired/ended ones
    apiGet('/notifications').then(function(n) {
      setInvites((n||[]).filter(function(x){
        return x.viva_room_id && x.type !== 'expired' && !x.title.startsWith('[Ended]');
      }));
    }).catch(function(){});
  }, []); // eslint-disable-line

  // Listen for question text sent by admin via socket (dispatched as custom event by VivaVideo)
  useEffect(function() {
    function onQuestion(e) {
      var text = e.detail;
      setCurrentQ(text);
      setQFlash(true);
      setTimeout(function() { setQFlash(false); }, 800);
      // Read aloud on student's device
      if (synthRef.current) {
        synthRef.current.cancel();
        var utt = new SpeechSynthesisUtterance(text);
        utt.rate = 0.88; utt.pitch = 1.0;
        synthRef.current.speak(utt);
      }
    }
    window.addEventListener('viva-question', onQuestion);
    return function() { window.removeEventListener('viva-question', onQuestion); };
  }, []);

  async function handleJoin(id) {
    var vid = (id || roomId || '').trim();
    if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      if (!s) { alert('Room not found'); return; }
      setSession(s); setRoomId(vid); setPhase('room');
    } catch(e) { alert('Room not found: ' + e.message); }
  }

  function leave() {
    if (synthRef.current) synthRef.current.cancel();
    setPhase('join'); setSession(null); setRoomId(''); setCurrentQ('');
  }

  if (phase === 'join') return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">🎙 Viva Voce</div>
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
            onChange={function(e){ setRoomId(e.target.value); }}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="badge badge-success">🟢 In Room</span>
          <span style={{ fontWeight: 700, color: '#fff' }}>{session ? session.title : 'Viva Session'}</span>
        </div>
        <button className="btn btn-sm btn-outline" onClick={function(){ if(window.confirm('Leave?')) leave(); }}>Leave</button>
      </div>

      {/* Current Question Banner */}
      {currentQ ? (
        <div style={{
          padding: '14px 18px', marginBottom: 14,
          background: qFlash ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.15)',
          border: '2px solid rgba(124,58,237,.5)', borderRadius: 12, transition: 'background .3s'
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#a78bfa', letterSpacing: 1, marginBottom: 6, fontFamily: 'JetBrains Mono,monospace' }}>
            🔊 QUESTION FROM EXAMINER
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', lineHeight: 1.55 }}>{currentQ}</div>
          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 8 }}>Speak your answer clearly — examiner is listening</div>
        </div>
      ) : (
        <div style={{ padding: '10px 14px', marginBottom: 14, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, textAlign: 'center', color: '#6b7280', fontSize: '0.8rem' }}>
          ⏳ Waiting for examiner to ask a question…
        </div>
      )}

      {/* Live video via Jitsi */}
      <div className="card" style={{ padding: 10 }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 8, textAlign: 'center', fontFamily: 'JetBrains Mono,monospace' }}>
          📹 LIVE SESSION
        </div>
        <JitsiMeet roomName={vivaId} displayName={store.currentUser && store.currentUser.name || "Student"} height={260}/>
      </div>

      <div style={{ marginTop: 10, padding: '10px 16px', background: 'rgba(124,58,237,.1)', border: '1px solid rgba(124,58,237,.25)', borderRadius: 10, fontSize: '0.8rem', color: '#a78bfa', textAlign: 'center' }}>
        🎤 Speak clearly when a question appears above. Your examiner can see and hear you live.
      </div>
    </div>
  );
}
