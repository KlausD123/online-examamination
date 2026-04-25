import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet } from '../../utils/api';
import JitsiMeet from '../JitsiMeet';

var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function VivaJoin() {
  var store = useStore();
  var [phase,          setPhase]          = useState('join');
  var [roomId,         setRoomId]         = useState('');
  var [session,        setSession]        = useState(null);
  var [invites,        setInvites]        = useState([]);
  var [currentQ,       setCurrentQ]       = useState('');
  var [qFlash,         setQFlash]         = useState(false);
  var [transcript,     setTranscript]     = useState([]);
  var [liveText,       setLiveText]       = useState('');
  var [interimText,    setInterimText]    = useState('');
  var [isListening,    setIsListening]    = useState(false);
  var [showTranscript, setShowTranscript] = useState(true);

  var synthRef     = useRef(window.speechSynthesis);
  var recRef       = useRef(null);
  var liveTextRef  = useRef('');
  var currentQRef  = useRef('');
  var silenceTimer = useRef(null);

  useEffect(function() {
    apiGet('/notifications').then(function(n) {
      setInvites((n || []).filter(function(x) {
        return x.viva_room_id && x.type !== 'expired' && !x.title.startsWith('[Ended]');
      }));
    }).catch(function() {});
  }, []); // eslint-disable-line

  useEffect(function() {
    return function() {
      stopListening();
      synthRef.current && synthRef.current.cancel();
    };
  }, []); // eslint-disable-line

  // Listen for question text relayed by socket via custom event
  useEffect(function() {
    function onQuestion(e) {
      var text = e.detail;
      currentQRef.current = text;
      setCurrentQ(text);
      setQFlash(true);
      setTimeout(function() { setQFlash(false); }, 800);
      liveTextRef.current = '';
      setLiveText('');
      setInterimText('');
      if (synthRef.current) {
        synthRef.current.cancel();
        var utt = new SpeechSynthesisUtterance(text);
        utt.rate = 0.88; utt.pitch = 1.0; utt.lang = 'en-US';
        utt.onend = function() { setTimeout(startListening, 600); };
        synthRef.current.speak(utt);
      }
    }
    window.addEventListener('viva-question', onQuestion);
    return function() { window.removeEventListener('viva-question', onQuestion); };
  }, []); // eslint-disable-line

  function startListening() {
    if (!SR) return;
    stopListening();
    liveTextRef.current = '';
    setLiveText('');
    setInterimText('');
    setIsListening(true);
    var r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = function(e) {
      clearTimeout(silenceTimer.current);
      var fin = '', interim = '';
      for (var i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      if (fin) { liveTextRef.current += fin; setLiveText(liveTextRef.current.trim()); }
      setInterimText(interim);
      silenceTimer.current = setTimeout(function() { saveAnswer(); }, 4000);
    };
    r.onerror = function(ev) {
      if (ev.error === 'not-allowed') {
        setIsListening(false);
        store.addToast('Mic denied — allow microphone in browser settings', 'error');
      }
    };
    r.onend = function() {
      if (recRef.current) { try { r.start(); } catch(e) { setIsListening(false); } }
    };
    try { r.start(); recRef.current = r; } catch(e) { setIsListening(false); }
  }

  function stopListening() {
    clearTimeout(silenceTimer.current);
    setIsListening(false);
    setInterimText('');
    if (recRef.current) { try { recRef.current.stop(); } catch(e) {} recRef.current = null; }
  }

  function saveAnswer() {
    var answer = liveTextRef.current.trim();
    var question = currentQRef.current;
    if (!answer || !question) return;
    setTranscript(function(prev) {
      var exists = prev.find(function(t) { return t.q === question && t.answer === answer; });
      if (exists) return prev;
      return prev.concat([{ q: question, answer: answer, time: new Date().toLocaleTimeString() }]);
    });
    liveTextRef.current = '';
    setLiveText('');
    setInterimText('');
  }

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
    stopListening();
    synthRef.current && synthRef.current.cancel();
    setPhase('join'); setSession(null); setRoomId('');
    setCurrentQ(''); setTranscript([]); setLiveText('');
    currentQRef.current = '';
  }

  if (phase === 'join') return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">🎙 Viva Voce</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text3)' }}>Live oral examination room</div>
        </div>
      </div>
      {invites.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>📬 Your Invitations</div>
          <div className="grid-2">
            {invites.map(function(inv) {
              return (
                <div key={inv.notification_id} className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{inv.title}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginBottom: 14 }}>{inv.message}</div>
                  <button className="btn btn-primary btn-sm" onClick={function() { handleJoin(inv.viva_room_id); }}>🚀 Join Now</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-title">Join by Room ID</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input className="form-input" value={roomId}
            onChange={function(e) { setRoomId(e.target.value); }}
            placeholder="Paste Room ID…" style={{ flex: 1 }}/>
          <button className="btn btn-primary" onClick={function() { handleJoin(); }} disabled={!roomId.trim()}>Join</button>
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
          {session && session.topic && (
            <span style={{ fontSize: '0.72rem', color: '#9ca3af', background: 'rgba(255,255,255,.06)', padding: '2px 10px', borderRadius: 12 }}>{session.topic}</span>
          )}
        </div>
        <button className="btn btn-sm btn-outline" onClick={function() { if (window.confirm('Leave the viva room?')) leave(); }}>Leave</button>
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
          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 8 }}>
            {isListening ? '🎤 Listening… speak your answer' : 'Speak your answer clearly — examiner is listening'}
          </div>
        </div>
      ) : (
        <div style={{ padding: '10px 14px', marginBottom: 14, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, textAlign: 'center', color: '#6b7280', fontSize: '0.8rem' }}>
          ⏳ Waiting for examiner to ask a question…
        </div>
      )}

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>

        {/* LEFT: Jitsi video + answer capture */}
        <div>
          <div className="card" style={{ padding: 10 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 8, textAlign: 'center', fontFamily: 'JetBrains Mono,monospace' }}>
              📹 LIVE SESSION
            </div>
            <JitsiMeet roomName={roomId} displayName={studentName} height={300} />
          </div>

          <div className="card" style={{ padding: 12, marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, fontFamily: 'JetBrains Mono,monospace' }}>
                🎤 YOUR ANSWER (for transcript)
              </div>
              {isListening && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1s infinite' }}/>
                  <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 700 }}>RECORDING</span>
                </div>
              )}
            </div>

            <div style={{
              minHeight: 80, padding: '10px 14px',
              background: 'rgba(255,255,255,.04)',
              border: '1.5px solid ' + (isListening ? '#ef4444' : 'rgba(255,255,255,.1)'),
              borderRadius: 8, fontSize: '0.88rem', color: '#e5e5e5',
              lineHeight: 1.65, marginBottom: 10, transition: 'border-color .2s', wordBreak: 'break-word'
            }}>
              {liveText
                ? <span>{liveText}{interimText && <span style={{ color: '#6b7280', fontStyle: 'italic' }}> {interimText}</span>}</span>
                : <span style={{ color: '#4b5563', fontStyle: 'italic' }}>
                    {isListening ? '🎤 Speak your answer now…' : 'Click Start to capture your answer in transcript'}
                  </span>
              }
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {!isListening ? (
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={startListening} disabled={!SR}>
                  🎤 {SR ? 'Capture Answer' : 'Use Chrome/Edge for transcript'}
                </button>
              ) : (
                <>
                  <button className="btn btn-danger btn-sm" style={{ flex: 1 }}
                    onClick={function() { stopListening(); saveAnswer(); }}>
                    ⏹ Done
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={stopListening}>Pause</button>
                </>
              )}
            </div>
            {liveText && !isListening && (
              <button className="btn btn-warning btn-sm" style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
                onClick={saveAnswer}>
                💾 Save to Transcript
              </button>
            )}
          </div>
        </div>

        {/* RIGHT: Session transcript */}
        <div>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, fontFamily: 'JetBrains Mono,monospace' }}>
                📋 SESSION TRANSCRIPT ({transcript.length})
              </div>
              <button onClick={function() { setShowTranscript(function(v) { return !v; }); }}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.72rem' }}>
                {showTranscript ? '▲ Hide' : '▼ Show'}
              </button>
            </div>
            {showTranscript && (
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {transcript.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#4b5563', fontSize: '0.82rem' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>📝</div>
                    Your answers will appear here as you speak
                  </div>
                ) : (
                  transcript.map(function(t, i) {
                    return (
                      <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a78bfa', flex: 1, lineHeight: 1.45 }}>
                            Q{i + 1}: {t.q}
                          </div>
                          <div style={{ fontSize: '0.62rem', color: '#4b5563', flexShrink: 0 }}>{t.time}</div>
                        </div>
                        <div style={{ fontSize: '0.82rem', color: '#d1d5db', padding: '6px 10px', background: 'rgba(255,255,255,.04)', borderRadius: 6, lineHeight: 1.6, borderLeft: '2px solid rgba(124,58,237,.4)' }}>
                          🎤 {t.answer}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, padding: '10px 16px', background: 'rgba(124,58,237,.1)', border: '1px solid rgba(124,58,237,.25)', borderRadius: 10, fontSize: '0.78rem', color: '#a78bfa' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>💡 Tips</div>
            <div style={{ color: '#9ca3af', lineHeight: 1.7 }}>
              • Your Jitsi video/audio is live to the examiner<br/>
              • Use <strong>Capture Answer</strong> below to log your spoken answers<br/>
              • Questions flash above when the examiner asks<br/>
              • The transcript builds as you answer each question
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
