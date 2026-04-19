import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { apiPost } from '../../utils/api';

export default function ExamInterface({ exam, submissionId, onComplete }) {
  var store = useStore();
  var [questions,   setQuestions]   = useState([]);
  var [answers,     setAnswers]     = useState({});
  var [currentQ,    setCurrentQ]    = useState(0);
  var [timeLeft,    setTimeLeft]    = useState(exam.duration_minutes * 60);
  var [loading,     setLoading]     = useState(true);
  var [submitting,  setSubmitting]  = useState(false);
  var [showWarning, setShowWarning] = useState(false);
  var [showConfirm, setShowConfirm] = useState(false);
  var [violations,  setViolations]  = useState(0);
  var [violReason,  setViolReason]  = useState('');
  var [camOn,       setCamOn]       = useState(false);
  var [micOn,       setMicOn]       = useState(false);
  var [camError,    setCamError]    = useState('');
  var [voiceAlert,  setVoiceAlert]  = useState(false);

  var cheatedRef     = useRef(false);
  var violRef        = useRef(0);
  var submittingRef  = useRef(false);
  var videoRef       = useRef(null);
  var streamRef      = useRef(null);
  var audioCtxRef    = useRef(null);
  var voiceIntervalRef = useRef(null);
  var loudFramesRef  = useRef(0);

  // ── Load questions ─────────────────────────────────────────
  useEffect(function () {
    store.loadQuestions(exam.exam_id).then(function (qs) {
      setQuestions(qs);
      setLoading(false);
    });
  }, []); // eslint-disable-line

  // ── Start camera + mic on mount ────────────────────────────
  useEffect(function () {
    startMonitoring();
    return function () { stopMonitoring(); };
  }, []); // eslint-disable-line

  async function startMonitoring() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setCamOn(true);
      setMicOn(true);
      // Attach video
      var interval = setInterval(function () {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          clearInterval(interval);
        }
      }, 200);
      // Start audio monitoring
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          var ctx      = new AC();
          var analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          ctx.createMediaStreamSource(stream).connect(analyser);
          audioCtxRef.current = ctx;
          var data = new Uint8Array(analyser.frequencyBinCount);
          voiceIntervalRef.current = setInterval(function () {
            analyser.getByteFrequencyData(data);
            var avg = 0;
            for (var i = 0; i < data.length; i++) avg += data[i];
            avg = avg / data.length;
            if (avg > 175) {
              loudFramesRef.current++;
              if (loudFramesRef.current >= 8) {       // ~1.6 s of sustained loud noise
                loudFramesRef.current = 0;
                setVoiceAlert(true);
                setTimeout(function () { setVoiceAlert(false); }, 3000);
                triggerViolation('Sustained loud noise / voice detected during exam');
              }
            } else {
              loudFramesRef.current = Math.max(0, loudFramesRef.current - 1);
            }
          }, 200);
        }
      } catch (e) { /* audio monitor unavailable */ }
    } catch (e) {
      setCamError('Camera / mic unavailable');
    }
  }

  function stopMonitoring() {
    clearInterval(voiceIntervalRef.current);
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch (e) {} }
    if (streamRef.current) { streamRef.current.getTracks().forEach(function (t) { t.stop(); }); }
  }

  // ── Violation handler (tab-switch or voice) ────────────────
  function triggerViolation(reason) {
    if (cheatedRef.current || submittingRef.current) return;
    violRef.current += 1;
    setViolations(violRef.current);
    if (violRef.current === 1) {
      setViolReason(reason);
      setShowWarning(true);
    } else {
      cheatedRef.current = true;
      doCheatSubmit(reason);
    }
  }

  // ── Tab-switch detection ───────────────────────────────────
  var handleVisibility = useCallback(function () {
    if (document.hidden) triggerViolation('Tab switch / window change detected');
  }, []); // eslint-disable-line

  useEffect(function () {
    document.addEventListener('visibilitychange', handleVisibility);
    return function () { document.removeEventListener('visibilitychange', handleVisibility); };
  }, [handleVisibility]);

  // ── Timer ──────────────────────────────────────────────────
  useEffect(function () {
    if (loading) return;
    var timer = setInterval(function () {
      setTimeLeft(function (prev) {
        if (prev <= 1) { clearInterval(timer); doFinalSubmit(true); return 0; }
        return prev - 1;
      });
    }, 1000);
    return function () { clearInterval(timer); };
  }, [loading]); // eslint-disable-line

  // ── Cheat submit — score 0, notify examiner ────────────────
  async function doCheatSubmit(reason) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    stopMonitoring();
    try {
      await store.submitExam(submissionId, [], exam.exam_id, true);
      await apiPost('/notifications', {
        title:   'INTEGRITY VIOLATION: ' + (store.currentUser.name || 'Student'),
        message: (store.currentUser.name || 'Student') + ' violated exam rules in "' + exam.title + '". Reason: ' + reason + '. Score automatically set to ZERO. Please review.',
        type:    'urgent',
      });
    } catch (e) { /* silent */ }
    onComplete();
  }

  // ── Normal submit ─────────────────────────────────────────
  async function doFinalSubmit(autoTime) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setShowConfirm(false);
    stopMonitoring();

    var ansArr = questions.map(function (q) {
      return { question_id: q.question_id, answer_text: answers[q.question_id] || '' };
    });
    var answeredCount = ansArr.filter(function (a) { return a.answer_text; }).length;

    // Count correct MCQ/TF answers locally for the notification
    var correctCount = 0;
    questions.forEach(function (q) {
      var ans = answers[q.question_id] || '';
      if (q.correct_answer && ans.trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase()) {
        correctCount++;
      }
    });

    var result = null;
    try {
      result = await store.submitExam(submissionId, ansArr, exam.exam_id, false);
    } catch (e) { /* silent */ }

    // Notify examiner
    try {
      var score     = (result && result.total_score != null) ? result.total_score : '?';
      var grade     = (result && result.grade)               ? result.grade       : '-';
      var scorePct  = exam.total_marks > 0 && typeof score === 'number'
        ? Math.round((score / exam.total_marks) * 100) : '?';
      var autoNote  = autoTime ? ' [AUTO-SUBMITTED — time expired]' : '';
      await apiPost('/notifications', {
        title:   'Exam Submitted: ' + (store.currentUser.name || 'Student'),
        message: (store.currentUser.name || 'Student') + ' submitted "' + exam.title + '".' + autoNote +
          '\nScore: ' + score + ' / ' + exam.total_marks + ' (' + scorePct + '%)' +
          '  |  Grade: ' + grade +
          '  |  Correct: ' + correctCount + ' / ' + questions.length + ' questions' +
          '  |  Answered: ' + answeredCount + ' / ' + questions.length,
        type: (typeof scorePct === 'number' && scorePct >= 50) ? 'success' : 'warning',
      });
    } catch (e) { /* silent */ }

    onComplete();
  }

  function handleSubmitClick() {
    if (!showConfirm) { setShowConfirm(true); return; }
  }

  function setAnswer(qid, val) {
    setAnswers(function (prev) { var a = Object.assign({}, prev); a[qid] = val; return a; });
  }

  var mins         = Math.floor(timeLeft / 60);
  var secs         = timeLeft % 60;
  var timeStr      = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  var isUrgent     = timeLeft < 300;
  var answeredCount= Object.keys(answers).filter(function (k) { return answers[k]; }).length;

  if (loading) {
    return <div className="loading-center"><div className="spinner"></div><span>Loading exam...</span></div>;
  }

  var q = questions[currentQ];

  return (
    <div className="fade-up" style={{ maxWidth: 1020, margin: '0 auto' }}>

      {/* Voice-noise flash banner */}
      {voiceAlert && (
        <div style={{ position:'fixed', top:72, left:'50%', transform:'translateX(-50%)', zIndex:3000, background:'#dc2626', color:'#fff', padding:'11px 28px', borderRadius:30, fontWeight:700, fontSize:'0.9rem', boxShadow:'0 8px 32px rgba(220,38,38,.5)', whiteSpace:'nowrap' }}>
          🔊 Loud noise detected — stay silent!
        </div>
      )}

      {/* ── Header bar ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, padding:'12px 18px', background:'var(--surface)', borderRadius:12, border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:'1.05rem' }}>{exam.title}</div>
          <div style={{ fontSize:'0.77rem', color:'var(--text3)' }}>{answeredCount}/{questions.length} answered · {exam.total_marks} marks</div>
        </div>

        <div className={'exam-timer' + (isUrgent ? ' urgent' : '')}>{timeStr}</div>

        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          {/* Camera pill */}
          <div style={{ padding:'4px 10px', borderRadius:20, background: camOn?'rgba(22,163,74,.12)':'rgba(220,38,38,.1)', color:camOn?'#16a34a':'#dc2626', fontSize:'0.73rem', fontWeight:700, display:'flex', alignItems:'center', gap:4 }}>
            📹 {camOn ? 'Camera On' : 'No Camera'}
          </div>
          {/* Mic pill */}
          <div style={{ padding:'4px 10px', borderRadius:20, background: micOn?'rgba(22,163,74,.12)':'rgba(220,38,38,.1)', color:micOn?'#16a34a':'#dc2626', fontSize:'0.73rem', fontWeight:700, display:'flex', alignItems:'center', gap:4 }}>
            🎤 {micOn ? 'Mic Monitored' : 'No Mic'}
          </div>
          {/* Violation dots */}
          <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:'0.73rem', color: violations>0?'var(--danger)':'var(--text3)', fontWeight:600 }}>
            Violations:
            {[0,1].map(function (i) {
              return <span key={i} style={{ width:11, height:11, borderRadius:'50%', background: i<violations?'var(--danger)':'var(--border)', display:'inline-block', marginLeft:3 }}/>;
            })}
          </div>
        </div>
      </div>

      {/* ── Body: question + sidebar ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 240px', gap:18 }}>

        {/* Question card */}
        <div className="card">
          {q && (
            <div>
              <div style={{ display:'flex', gap:8, marginBottom:14 }}>
                <span className="badge badge-primary">Q{currentQ+1}/{questions.length}</span>
                <span className="badge badge-info">{q.marks} marks</span>
                <span className={'badge badge-'+(q.difficulty==='Easy'?'success':q.difficulty==='Hard'?'danger':'warning')}>{q.difficulty||'Medium'}</span>
              </div>
              <div style={{ fontSize:'1.05rem', fontWeight:500, marginBottom:22, lineHeight:1.65 }}>{q.question_text}</div>

              {/* MCQ */}
              {q.question_type==='MCQ' && q.options && q.options.map(function (opt, i) {
                var t   = opt.text || opt;
                var sel = answers[q.question_id] === t;
                return (
                  <div key={i} onClick={function () { setAnswer(q.question_id, t); }}
                    style={{ padding:'12px 16px', border:'2px solid '+(sel?'var(--accent)':'var(--border)'), borderRadius:10, marginBottom:10, cursor:'pointer', background:sel?'var(--accent-glow)':'var(--surface)', display:'flex', alignItems:'center', gap:12, transition:'var(--transition)' }}>
                    <span style={{ width:28, height:28, borderRadius:'50%', border:'2px solid '+(sel?'var(--accent)':'var(--border)'), display:'flex', alignItems:'center', justifyContent:'center', fontWeight:600, fontSize:'0.78rem', background:sel?'var(--accent)':'transparent', color:sel?'#fff':'var(--text3)', flexShrink:0 }}>
                      {String.fromCharCode(65+i)}
                    </span>
                    <span style={{ fontWeight:sel?600:400 }}>{t}</span>
                  </div>
                );
              })}

              {/* True / False */}
              {q.question_type==='TRUE_FALSE' && (
                <div style={{ display:'flex', gap:12 }}>
                  {['True','False'].map(function (v) {
                    var sel = answers[q.question_id]===v;
                    return <button key={v} className={'btn '+(sel?'btn-primary':'btn-outline')} style={{ flex:1, justifyContent:'center' }} onClick={function () { setAnswer(q.question_id, v); }}>{v}</button>;
                  })}
                </div>
              )}

              {/* Short / Descriptive */}
              {(q.question_type==='SHORT_ANSWER'||q.question_type==='DESCRIPTIVE') && (
                <textarea className="form-textarea" value={answers[q.question_id]||''} onChange={function (e) { setAnswer(q.question_id, e.target.value); }} rows={q.question_type==='DESCRIPTIVE'?6:3} placeholder="Type your answer..."/>
              )}
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'space-between', marginTop:22 }}>
            <button className="btn btn-outline" disabled={currentQ===0} onClick={function () { setCurrentQ(function (p) { return p-1; }); }}>← Previous</button>
            {currentQ < questions.length-1
              ? <button className="btn btn-primary" onClick={function () { setCurrentQ(function (p) { return p+1; }); }}>Next →</button>
              : <button className="btn btn-success" onClick={handleSubmitClick} disabled={submitting}>📤 Submit Exam</button>
            }
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

          {/* Camera feed */}
          <div className="card" style={{ padding:10 }}>
            <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:1, marginBottom:7, fontFamily:'JetBrains Mono,monospace', textAlign:'center' }}>
              📹 Proctoring Active
            </div>
            {camOn
              ? <video ref={videoRef} autoPlay muted playsInline style={{ width:'100%', borderRadius:8, background:'#000', maxHeight:128, objectFit:'cover' }}/>
              : <div style={{ width:'100%', height:96, borderRadius:8, background:'#1a1a2e', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:5 }}>
                  <span style={{ fontSize:'1.4rem', opacity:.4 }}>📷</span>
                  <span style={{ fontSize:'0.68rem', color:'#6b7280', textAlign:'center', padding:'0 8px' }}>{camError||'No camera'}</span>
                </div>
            }
            {micOn && (
              <div style={{ marginTop:6, display:'flex', alignItems:'center', justifyContent:'center', gap:5, fontSize:'0.68rem', color:'#16a34a', fontWeight:700 }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'#16a34a', display:'inline-block', animation:'pulse 1.2s ease-in-out infinite' }}/>
                Voice Monitored
              </div>
            )}
          </div>

          {/* Question navigator */}
          <div className="card" style={{ flex:1 }}>
            <div style={{ fontWeight:600, marginBottom:10, fontSize:'0.85rem' }}>Questions</div>
            <div className="question-nav">
              {questions.map(function (q, i) {
                var cls = i===currentQ ? 'current' : (answers[q.question_id] ? 'answered' : '');
                return <button key={i} className={cls} onClick={function () { setCurrentQ(i); }}>{i+1}</button>;
              })}
            </div>
            <button className="btn btn-success btn-sm" style={{ width:'100%', marginTop:14, justifyContent:'center' }} onClick={handleSubmitClick} disabled={submitting}>
              📤 Submit
            </button>
          </div>

          {/* Monitoring status panel */}
          <div className="card" style={{ padding:'12px 14px' }}>
            <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:1, marginBottom:10, fontFamily:'JetBrains Mono,monospace' }}>Monitoring</div>
            {[
              { icon:'🖥', label:'Tab Switch',  status: violations===0?'OK':violations===1?'WARNING':'VIOLATED', color: violations===0?'var(--success)':violations===1?'var(--warning)':'var(--danger)' },
              { icon:'📹', label:'Camera',      status: camOn?'Active':'Off',  color: camOn?'var(--success)':'var(--text3)' },
              { icon:'🎤', label:'Microphone',  status: micOn?'Active':'Off',  color: micOn?'var(--success)':'var(--text3)' },
            ].map(function (m, i) {
              return (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom: i<2?'1px solid var(--border)':'none', fontSize:'0.8rem' }}>
                  <span style={{ color:'var(--text2)' }}>{m.icon} {m.label}</span>
                  <span style={{ fontWeight:700, color:m.color, fontSize:'0.72rem' }}>{m.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Warning modal (1st violation) ── */}
      {showWarning && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'3rem', marginBottom:12 }}>⚠️</div>
            <div className="modal-title">Violation Detected!</div>
            <div className="modal-body">
              <strong>Reason:</strong> {violReason}<br/><br/>
              This is your <strong>first and only warning</strong>. A <strong>second violation will immediately submit your exam with a score of zero</strong> and notify the examiner.
            </div>
            <button className="btn btn-primary" onClick={function () { setShowWarning(false); }}>I Understand — Continue Exam</button>
          </div>
        </div>
      )}

      {/* ── Submit confirmation modal ── */}
      {showConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title">📤 Submit Exam?</div>
            <div className="modal-body">
              You have answered <strong>{answeredCount} of {questions.length}</strong> questions. Once submitted you cannot change your answers.
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={function () { setShowConfirm(false); }}>Cancel</button>
              <button className="btn btn-success" onClick={function () { doFinalSubmit(false); }} disabled={submitting}>
                {submitting ? 'Submitting…' : '✅ Confirm Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
