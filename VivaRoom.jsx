import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { generateVivaQuestions, gradeVivaAnswer, gradeVivaSession } from '../../utils/aiService';
import { apiPost, apiGet } from '../../utils/api';

var API = 'http://localhost:5000/api';
function getToken() { return localStorage.getItem('examai_token'); }

export default function VivaRoom() {
  var store = useStore();
  var [phase,         setPhase]         = useState('setup');
  var [title,         setTitle]         = useState('');
  var [topic,         setTopic]         = useState('');
  var savedVivaRef = useRef(null);
  var [savedViva,     setSavedViva]     = useState(null);

  // Q&A
  var [questions,     setQuestions]     = useState([]);
  var [currentQ,      setCurrentQ]      = useState(0);
  var [studentAnswer, setStudentAnswer] = useState('');
  var [examinerNotes, setExaminerNotes] = useState('');
  var [verdict,       setVerdict]       = useState(null);
  var [transcript,    setTranscript]    = useState([]);
  var [loading,       setLoading]       = useState(false);

  // Question generator
  var [genTopic,      setGenTopic]      = useState('');
  var [genCount,      setGenCount]      = useState(5);

  // Invite
  var [showInvite,    setShowInvite]    = useState(false);
  var [inviteMode,    setInviteMode]    = useState('account');
  var [inviteEmail,   setInviteEmail]   = useState('');
  var [students,      setStudents]      = useState([]);
  var [selectedStu,   setSelectedStu]   = useState([]);
  var [inviteMsg,     setInviteMsg]     = useState('');
  var [inviting,      setInviting]      = useState(false);

  // Student alerts polling
  var [studentAlerts, setStudentAlerts] = useState([]);
  var [unreadAlerts,  setUnreadAlerts]  = useState(0);
  var [showAlerts,    setShowAlerts]    = useState(false);
  var alertLastRef = useRef(Date.now());
  var pollRef      = useRef(null);

  // Examiner away timer
  var [examinerAway,    setExaminerAway]    = useState(false);
  var [awayCountdown,   setAwayCountdown]   = useState(600);
  var [examinerLocked,  setExaminerLocked]  = useState(false); // can't rejoin after 10 min
  var awayTimerRef = useRef(null);
  var awayStartRef = useRef(null);

  // Results (editable before finalizing)
  var [results,       setResults]       = useState(null);
  var [editableAnswers, setEditableAnswers] = useState([]);
  var [finalizing,    setFinalizing]    = useState(false);

  // Camera
  var adminVid  = useRef(null);
  var streamRef = useRef(null);

  useEffect(function() { return function() { stopMedia(); }; }, []); // eslint-disable-line

  // ── Examiner away detection (tab hidden) ───────────────────
  useEffect(function() {
    if (phase !== 'room') return;
    function onHide() {
      if (document.hidden && !examinerAway && !examinerLocked) {
        setExaminerAway(true);
        awayStartRef.current = Date.now();
      }
    }
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onHide);
    return function() {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onHide);
    };
  }, [phase, examinerAway, examinerLocked]); // eslint-disable-line

  // ── Examiner away countdown ────────────────────────────────
  useEffect(function() {
    if (!examinerAway) { clearInterval(awayTimerRef.current); return; }
    awayTimerRef.current = setInterval(function() {
      var elapsed   = Math.floor((Date.now() - awayStartRef.current) / 1000);
      var remaining = 600 - elapsed;
      if (remaining <= 0) {
        clearInterval(awayTimerRef.current);
        setExaminerAway(false);
        setExaminerLocked(true); // can no longer rejoin room
        // Mark viva as locked in DB
        var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : null;
        if (vivaId) {
          fetch(API + '/viva/' + vivaId + '/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
            body: JSON.stringify({ locked: true }),
          }).catch(function() {});
        }
      } else {
        setAwayCountdown(remaining);
      }
    }, 1000);
    return function() { clearInterval(awayTimerRef.current); };
  }, [examinerAway]); // eslint-disable-line

  function examinerReturn() {
    clearInterval(awayTimerRef.current);
    setExaminerAway(false);
    setAwayCountdown(600);
    awayStartRef.current = null;
    // Re-attach video
    setTimeout(function() {
      if (adminVid.current && streamRef.current) adminVid.current.srcObject = streamRef.current;
    }, 200);
  }

  // ── Polling: fetch new student activity alerts ─────────────
  function startPolling() {
    alertLastRef.current = Date.now();
    pollRef.current = setInterval(async function() {
      try {
        var notifs = await apiGet('/notifications');
        var fresh  = (notifs || []).filter(function(n) {
          var ts = n.created_at ? new Date(n.created_at).getTime() : 0;
          return ts > alertLastRef.current && n.title && (
            n.title.includes('Left Viva') || n.title.includes('Returned to Viva') ||
            n.title.includes('Removed — Viva') || n.title.includes('Exam Submitted') ||
            n.title.includes('INTEGRITY')
          );
        });
        if (fresh.length > 0) {
          alertLastRef.current = Date.now();
          setStudentAlerts(function(p) { return fresh.concat(p).slice(0, 40); });
          setUnreadAlerts(function(p) { return p + fresh.length; });
        }
      } catch(e) {}
    }, 6000);
  }

  // ── Create room ────────────────────────────────────────────
  async function handleStartRoom() {
    if (!title.trim()) return;
    setLoading(true);
    try {
      var r = await apiPost('/viva', { title: title, topic: topic, questions: [] });
      var vivaData = { viva_id: r.viva_id, title: title, topic: topic };
      savedVivaRef.current = vivaData;
      setSavedViva(vivaData);
      setPhase('room');
      setTimeout(startMedia, 300);
      startPolling();
    } catch(e) { alert(e.message); }
    setLoading(false);
  }

  function startMedia() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(function(stream) {
        streamRef.current = stream;
        var iv = setInterval(function() {
          if (adminVid.current) { adminVid.current.srcObject = stream; clearInterval(iv); }
        }, 200);
      }).catch(function() {});
  }
  function stopMedia() {
    clearInterval(pollRef.current);
    clearInterval(awayTimerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(function(t) { t.stop(); });
  }

  // ── Generate questions ─────────────────────────────────────
  async function handleGenerateQ() {
    if (!genTopic.trim()) return;
    setLoading(true);
    try {
      var qs = await generateVivaQuestions(genTopic, genCount);
      setQuestions(qs); setCurrentQ(0);
    } catch(e) { alert('Generation failed: ' + e.message); }
    setLoading(false);
  }

  // ── Grade one answer ───────────────────────────────────────
  async function handleCheckAnswer() {
    if (!studentAnswer.trim() || !questions[currentQ]) return;
    setLoading(true);
    try {
      var v = await gradeVivaAnswer(questions[currentQ].question, questions[currentQ].model_answer, studentAnswer);
      setVerdict(v);
    } catch(e) { alert(e.message); }
    setLoading(false);
  }

  // ── Save & next ────────────────────────────────────────────
  function handleSaveNext() {
    var entry = {
      question:      questions[currentQ].question,
      model_answer:  questions[currentQ].model_answer,
      student_answer: studentAnswer,
      notes:         examinerNotes,
      verdict:       verdict,
    };
    setTranscript(function(t) { return t.concat([entry]); });
    setStudentAnswer(''); setExaminerNotes(''); setVerdict(null);
    if (currentQ < questions.length - 1) setCurrentQ(function(q) { return q + 1; });
  }

  // ── END VIVA → grade → editable results ───────────────────
  async function handleEndGrade() {
    stopMedia();
    setLoading(true);
    setPhase('grading');
    try {
      var tText = transcript.map(function(t, i) {
        return 'Q'+(i+1)+': '+t.question+'\nStudent: '+t.student_answer+'\nModel: '+t.model_answer+(t.notes?'\nNotes: '+t.notes:'');
      }).join('\n\n');
      var report = await gradeVivaSession(tText);

      // Build editable answer list from transcript + AI grading
      var edited = transcript.map(function(t, i) {
        var aiAns = report.answers && report.answers[i] ? report.answers[i] : {};
        return {
          question:      t.question,
          model_answer:  t.model_answer,
          student_answer: t.student_answer,
          notes:         t.notes || '',
          verdict:       aiAns.verdict || (t.verdict ? t.verdict.verdict : 'Not graded'),
          score_pct:     aiAns.score   != null ? aiAns.score : (t.verdict ? t.verdict.score_pct : 0),
          feedback:      aiAns.feedback || (t.verdict ? t.verdict.feedback : ''),
          correct:       aiAns.correct  != null ? aiAns.correct : (t.verdict ? t.verdict.correct : false),
        };
      });
      setEditableAnswers(edited);
      setResults(report);

      // Mark viva as ended in DB (students will be kicked on next poll)
      var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : null;
      if (vivaId) {
        await apiPost('/viva/' + vivaId + '/end', { ended: true });
      }

      setPhase('results');
    } catch(e) { alert('Grading failed: ' + e.message); setPhase('room'); }
    setLoading(false);
  }

  // ── Update editable field ──────────────────────────────────
  function updateAnswer(idx, field, val) {
    setEditableAnswers(function(prev) {
      var arr = prev.slice();
      arr[idx] = Object.assign({}, arr[idx]);
      arr[idx][field] = val;
      // Recalc score if verdict changed
      if (field === 'verdict') {
        arr[idx].correct = val === 'Correct';
        if (val === 'Correct')            arr[idx].score_pct = 100;
        else if (val === 'Partially Correct') arr[idx].score_pct = 50;
        else                               arr[idx].score_pct = 0;
      }
      return arr;
    });
  }

  // ── Finalize & save results to DB ─────────────────────────
  async function handleFinalize() {
    setFinalizing(true);
    var totalScore = editableAnswers.length > 0
      ? Math.round(editableAnswers.reduce(function(a, e) { return a + (Number(e.score_pct)||0); }, 0) / editableAnswers.length)
      : 0;
    var grade = totalScore>=90?'A+':totalScore>=80?'A':totalScore>=70?'B':totalScore>=60?'C':totalScore>=50?'D':'F';
    var correctCount = editableAnswers.filter(function(e) { return e.correct; }).length;

    var fullTranscript = editableAnswers.map(function(e, i) {
      return 'Q'+(i+1)+': '+e.question+'\nStudent: '+e.student_answer+'\nScore: '+e.score_pct+'%\nVerdict: '+e.verdict+'\nFeedback: '+e.feedback+(e.notes?'\nNotes: '+e.notes:'');
    }).join('\n\n');

    try {
      var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : null;
      if (vivaId) {
        await apiPost('/viva/'+vivaId+'/result', {
          total_score:     totalScore,
          grade:           grade,
          correct_count:   correctCount,
          full_transcript: fullTranscript,
          ai_report:       Object.assign({}, results, { answers: editableAnswers, total_score: totalScore, grade: grade }),
        });
      }
      setResults(function(r) { return Object.assign({}, r, { total_score: totalScore, grade: grade, correct_count: correctCount, answers: editableAnswers }); });
      setPhase('final');
    } catch(e) { alert('Save failed: ' + e.message); }
    setFinalizing(false);
  }

  // ── Invite helpers ─────────────────────────────────────────
  async function loadStudents() {
    try { var s = await apiGet('/students'); setStudents(s||[]); } catch(e) {}
  }
  function toggleStudent(id) {
    setSelectedStu(function(p) { return p.includes(id) ? p.filter(function(x){return x!==id;}) : p.concat([id]); });
  }
  async function sendInvites() {
    var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : null;
    if (!vivaId) { alert('Room not created yet'); return; }
    setInviting(true); setInviteMsg('');
    try {
      if (inviteMode==='account' && selectedStu.length>0) {
        var count = 0;
        for (var i=0; i<selectedStu.length; i++) {
          var stu = students.find(function(s){return s.user_id===selectedStu[i];});
          if (stu) {
            await apiPost('/notifications', {
              title:        'Viva Invitation — '+title,
              message:      'You have been invited to "'+title+'".'+(topic?' Topic: '+topic:'')+'  Room ID: '+vivaId,
              type:         'info',
              recipient_id: stu.user_id,
              viva_room_id: vivaId,
            });
            count++;
          }
        }
        setInviteMsg('Sent to '+count+' student(s).');
        setSelectedStu([]);
      } else if (inviteMode==='email' && inviteEmail.trim()) {
        await apiPost('/viva/invite', { emails: inviteEmail.split(',').map(function(e){return e.trim();}), title: title, topic: topic, vivaId: vivaId });
        setInviteMsg('Email invitations sent!');
        setInviteEmail('');
      }
    } catch(e) { setInviteMsg('Error: '+e.message); }
    setInviting(false);
  }

  function copyRoomId() {
    var id = savedVivaRef.current ? savedVivaRef.current.viva_id : '';
    navigator.clipboard.writeText(id).then(function(){alert('Room ID copied!');});
  }

  // ════════════════ SETUP ════════════════
  if (phase==='setup') return (
    <div className="viva-dark fade-up">
      <div style={{maxWidth:500,margin:'60px auto',textAlign:'center'}}>
        <div style={{fontSize:'3rem',marginBottom:16}}>🎙</div>
        <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.6rem',color:'#fff',marginBottom:24}}>Start Viva Room</div>
        <div className="card" style={{textAlign:'left'}}>
          <div className="form-group"><label className="form-label">Session Title *</label><input className="form-input" value={title} onChange={function(e){setTitle(e.target.value);}} placeholder="e.g. CS Final Viva"/></div>
          <div className="form-group"><label className="form-label">Topic</label><input className="form-input" value={topic} onChange={function(e){setTopic(e.target.value);}} placeholder="e.g. Data Structures"/></div>
          <button className="btn btn-primary btn-lg" style={{width:'100%',justifyContent:'center'}} onClick={handleStartRoom} disabled={loading||!title.trim()}>
            {loading?'Creating…':'🚀 Start Viva Room'}
          </button>
        </div>
      </div>
    </div>
  );

  // ════════════════ EXAMINER AWAY SCREEN ════════════════
  if (examinerAway && phase==='room') {
    var am = Math.floor(awayCountdown/60), as2 = awayCountdown%60;
    return (
      <div style={{minHeight:'calc(100vh - 60px)',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',background:'#0d0d14',gap:0}}>
        <div style={{fontSize:'3rem',marginBottom:14}}>⏸</div>
        <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.5rem',color:'#fff',marginBottom:6}}>You Left the Viva Room</div>
        <div style={{fontSize:'0.9rem',color:'#9ca3af',marginBottom:22,textAlign:'center'}}>Return before the timer expires to continue examining.</div>
        <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:'3rem',fontWeight:900,color:awayCountdown<120?'#dc2626':'#f59e0b',letterSpacing:4}}>
          {String(am).padStart(2,'0')}:{String(as2).padStart(2,'0')}
        </div>
        <div style={{fontSize:'0.82rem',color:'#6b7280',marginTop:8,marginBottom:28}}>After 10 minutes you cannot rejoin this session</div>
        <button className="btn btn-primary btn-lg" onClick={examinerReturn}>▶ Return to Viva Room</button>
      </div>
    );
  }

  // ════════════════ EXAMINER LOCKED OUT ════════════════
  if (examinerLocked) return (
    <div style={{minHeight:'calc(100vh - 60px)',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',background:'#0d0d14'}}>
      <div style={{fontSize:'3rem',marginBottom:14}}>🔒</div>
      <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.4rem',color:'#fff',marginBottom:8}}>Session Expired</div>
      <div style={{color:'#9ca3af',marginBottom:28,textAlign:'center',maxWidth:380}}>You were away for more than 10 minutes. The viva session has been automatically terminated for all participants.</div>
      <button className="btn btn-outline" onClick={function(){setExaminerLocked(false);setPhase('setup');setTitle('');setTopic('');setTranscript([]);setQuestions([]);savedVivaRef.current=null;setSavedViva(null);}}>Start New Session</button>
    </div>
  );

  // ════════════════ GRADING (loading) ════════════════
  if (phase==='grading') return (
    <div className="viva-dark" style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'calc(100vh - 60px)',flexDirection:'column',gap:16}}>
      <div className="spinner" style={{width:48,height:48,borderWidth:4}}/>
      <div style={{color:'#a78bfa',fontWeight:600,fontSize:'1.1rem'}}>AI grading all answers…</div>
      <div style={{color:'#9ca3af',fontSize:'0.85rem'}}>Generating comprehensive report</div>
    </div>
  );

  // ════════════════ RESULTS — EDITABLE ════════════════
  if (phase==='results' && results) {
    var totalNow = editableAnswers.length>0
      ? Math.round(editableAnswers.reduce(function(a,e){return a+(Number(e.score_pct)||0);},0)/editableAnswers.length) : 0;
    var gradeNow = totalNow>=90?'A+':totalNow>=80?'A':totalNow>=70?'B':totalNow>=60?'C':totalNow>=50?'D':'F';
    var gc2 = gradeNow==='A'||gradeNow==='A+'?'#16a34a':gradeNow==='F'?'#dc2626':gradeNow==='B'?'#2563eb':'#d97706';
    return (
      <div className="fade-up">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
          <div>
            <div className="page-title">📊 Viva Results — Review &amp; Edit</div>
            <div style={{fontSize:'0.85rem',color:'var(--text3)',marginTop:3}}>Review AI-graded answers, adjust marks and notes, then finalize.</div>
          </div>
          <div style={{display:'flex',gap:10}}>
            <button className="btn btn-outline btn-sm" onClick={function(){setPhase('room');}}>← Back to Room</button>
            <button className="btn btn-success" onClick={handleFinalize} disabled={finalizing}>
              {finalizing?'Saving…':'✅ Finalize & Save Results'}
            </button>
          </div>
        </div>

        {/* Score summary */}
        <div className="card" style={{marginBottom:20,borderLeft:'4px solid '+gc2}}>
          <div style={{display:'flex',alignItems:'center',gap:28,flexWrap:'wrap'}}>
            <div style={{textAlign:'center'}}>
              <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:900,fontSize:'3.5rem',color:gc2,lineHeight:1}}>{totalNow}%</div>
              <div style={{fontSize:'0.75rem',color:'var(--text3)'}}>TOTAL SCORE</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:900,fontSize:'2.5rem',color:gc2}}>{gradeNow}</div>
              <div style={{fontSize:'0.75rem',color:'var(--text3)'}}>GRADE</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontWeight:700,fontSize:'1.5rem',color:'#16a34a'}}>{editableAnswers.filter(function(e){return e.correct;}).length}</div>
              <div style={{fontSize:'0.75rem',color:'var(--text3)'}}>CORRECT</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontWeight:700,fontSize:'1.5rem',color:'#dc2626'}}>{editableAnswers.filter(function(e){return !e.correct;}).length}</div>
              <div style={{fontSize:'0.75rem',color:'var(--text3)'}}>INCORRECT</div>
            </div>
            <div style={{flex:1,minWidth:200}}>
              <div style={{height:10,background:'var(--surface3)',borderRadius:5,overflow:'hidden'}}>
                <div style={{height:'100%',width:totalNow+'%',background:'linear-gradient(90deg,'+gc2+'88,'+gc2+')',borderRadius:5,transition:'width .4s'}}/>
              </div>
              <div style={{fontSize:'0.75rem',color:'var(--text3)',marginTop:5}}>Session: {title}</div>
            </div>
          </div>
        </div>

        {/* AI overall feedback */}
        {results.overall_feedback && (
          <div className="card" style={{marginBottom:20,background:'var(--accent-glow)',borderColor:'var(--accent-light)'}}>
            <div style={{fontSize:'0.72rem',fontWeight:700,color:'var(--accent)',letterSpacing:1,marginBottom:8,fontFamily:'JetBrains Mono,monospace'}}>AI OVERALL FEEDBACK</div>
            <div style={{fontSize:'0.9rem',lineHeight:1.7,color:'var(--text2)'}}>{results.overall_feedback}</div>
          </div>
        )}

        {/* Per-question editable rows */}
        {editableAnswers.map(function(entry, i) {
          var col = entry.correct ? '#16a34a' : entry.verdict==='Partially Correct' ? '#d97706' : '#dc2626';
          return (
            <div key={i} className="card" style={{marginBottom:16,borderLeft:'4px solid '+col}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14,flexWrap:'wrap',gap:10}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',gap:8,marginBottom:7,alignItems:'center'}}>
                    <span className="badge badge-primary" style={{fontSize:'0.7rem'}}>Q{i+1}</span>
                    <span style={{fontWeight:700,fontSize:'0.95rem'}}>{entry.question}</span>
                  </div>
                  <div style={{padding:'8px 12px',background:'var(--surface2)',borderRadius:7,fontSize:'0.82rem',color:'var(--text3)',marginBottom:10}}>
                    <strong>Model:</strong> {entry.model_answer}
                  </div>
                  <div style={{padding:'8px 12px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:7,fontSize:'0.85rem',color:'var(--text2)',marginBottom:10}}>
                    <strong>Student said:</strong> {entry.student_answer||<em>No answer</em>}
                  </div>
                </div>
                {/* Score badge */}
                <div style={{textAlign:'center',minWidth:70}}>
                  <div style={{fontWeight:900,fontSize:'1.8rem',color:col,lineHeight:1}}>{entry.score_pct}%</div>
                  <div style={{fontSize:'0.68rem',color:'var(--text3)'}}>Score</div>
                </div>
              </div>

              {/* Editable verdict */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',fontSize:'0.72rem',fontWeight:700,color:'var(--text3)',marginBottom:5,textTransform:'uppercase',letterSpacing:1,fontFamily:'JetBrains Mono,monospace'}}>VERDICT</label>
                  <select className="form-select" value={entry.verdict} onChange={function(e){updateAnswer(i,'verdict',e.target.value);}}>
                    <option value="Correct">✅ Correct</option>
                    <option value="Partially Correct">⚠️ Partially Correct</option>
                    <option value="Incorrect">❌ Incorrect</option>
                  </select>
                </div>
                <div>
                  <label style={{display:'block',fontSize:'0.72rem',fontWeight:700,color:'var(--text3)',marginBottom:5,textTransform:'uppercase',letterSpacing:1,fontFamily:'JetBrains Mono,monospace'}}>SCORE %</label>
                  <input type="number" className="form-input" min={0} max={100} value={entry.score_pct}
                    onChange={function(e){updateAnswer(i,'score_pct',Math.max(0,Math.min(100,Number(e.target.value))));}}/>
                </div>
              </div>

              {/* Editable feedback */}
              <div style={{marginBottom:10}}>
                <label style={{display:'block',fontSize:'0.72rem',fontWeight:700,color:'var(--text3)',marginBottom:5,textTransform:'uppercase',letterSpacing:1,fontFamily:'JetBrains Mono,monospace'}}>FEEDBACK (editable)</label>
                <textarea className="form-textarea" rows={2} value={entry.feedback}
                  onChange={function(e){updateAnswer(i,'feedback',e.target.value);}}
                  placeholder="Add or edit feedback…"/>
              </div>

              {/* Editable examiner notes */}
              <div>
                <label style={{display:'block',fontSize:'0.72rem',fontWeight:700,color:'var(--accent)',marginBottom:5,textTransform:'uppercase',letterSpacing:1,fontFamily:'JetBrains Mono,monospace'}}>EXAMINER NOTES (private)</label>
                <textarea className="form-textarea" rows={2} value={entry.notes}
                  onChange={function(e){updateAnswer(i,'notes',e.target.value);}}
                  placeholder="Private notes for record…"
                  style={{borderColor:'var(--accent-light)'}}/>
              </div>
            </div>
          );
        })}

        <div style={{position:'sticky',bottom:20,textAlign:'center',marginTop:20}}>
          <button className="btn btn-success btn-lg" onClick={handleFinalize} disabled={finalizing}>
            {finalizing?'Saving…':'✅ Finalize & Save Results'}
          </button>
          <div style={{fontSize:'0.78rem',color:'var(--text3)',marginTop:8}}>All changes above will be saved permanently.</div>
        </div>
      </div>
    );
  }

  // ════════════════ FINAL SAVED RESULTS ════════════════
  if (phase==='final' && results) {
    var fg = results.grade==='A'||results.grade==='A+'?'#16a34a':results.grade==='F'?'#dc2626':results.grade==='B'?'#2563eb':'#d97706';
    return (
      <div className="fade-up">
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
          <div className="page-title">✅ Viva Results Saved</div>
          <span className="badge badge-success" style={{marginLeft:'auto'}}>Finalized</span>
        </div>
        <div className="card" style={{marginBottom:20,textAlign:'center',padding:32,borderLeft:'4px solid '+fg}}>
          <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:900,fontSize:'4rem',color:fg,lineHeight:1}}>{results.total_score||0}%</div>
          <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'2rem',color:fg,marginTop:6}}>Grade {results.grade}</div>
          <div style={{display:'flex',gap:32,justifyContent:'center',marginTop:20}}>
            <div><div style={{fontWeight:700,fontSize:'1.3rem',color:'#16a34a'}}>{results.correct_count||0}</div><div style={{fontSize:'0.78rem',color:'var(--text3)'}}>Correct</div></div>
            <div><div style={{fontWeight:700,fontSize:'1.3rem',color:'#dc2626'}}>{(editableAnswers.length - (results.correct_count||0))}</div><div style={{fontSize:'0.78rem',color:'var(--text3)'}}>Incorrect</div></div>
            <div><div style={{fontWeight:700,fontSize:'1.3rem',color:'var(--accent)'}}>{editableAnswers.length}</div><div style={{fontSize:'0.78rem',color:'var(--text3)'}}>Questions</div></div>
          </div>
          <button className="btn btn-outline" style={{marginTop:20}} onClick={function(){navigator.clipboard.writeText(JSON.stringify(editableAnswers,null,2));alert('Report copied!');}}>
            📋 Copy Full Report
          </button>
        </div>
        <div style={{display:'flex',gap:12}}>
          <button className="btn btn-outline" onClick={function(){setPhase('results');}}>← Edit Results</button>
          <button className="btn btn-primary" onClick={function(){setPhase('setup');setResults(null);setTranscript([]);setQuestions([]);setEditableAnswers([]);savedVivaRef.current=null;setSavedViva(null);setTitle('');setTopic('');}}>🔄 New Session</button>
        </div>
      </div>
    );
  }

  // ════════════════ ROOM ════════════════
  var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : '';
  return (
    <div className="viva-dark fade-up">
      {/* Top bar */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <span className="badge badge-danger">🔴 LIVE VIVA</span>
          <span style={{fontWeight:700,color:'#fff'}}>{title}</span>
          {topic&&<span className="badge badge-primary" style={{fontSize:'0.68rem'}}>{topic}</span>}
          <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:'0.72rem',color:'#9ca3af'}}>{transcript.length}/{questions.length} done</span>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="btn btn-sm" style={{background:'rgba(255,255,255,.08)',color:'#e5e5e5',fontFamily:'JetBrains Mono,monospace',fontSize:'0.72rem'}} onClick={copyRoomId}>🔑 {vivaId.slice(0,8)}…</button>
          <button className="btn btn-sm" style={{background:unreadAlerts>0?'rgba(220,38,38,.2)':'rgba(255,255,255,.08)',color:unreadAlerts>0?'#f87171':'#e5e5e5',position:'relative'}}
            onClick={function(){setShowAlerts(!showAlerts);setUnreadAlerts(0);}}>
            🔔 Alerts {unreadAlerts>0&&<span style={{position:'absolute',top:-4,right:-4,width:16,height:16,borderRadius:'50%',background:'#dc2626',color:'#fff',fontSize:'0.62rem',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700}}>{unreadAlerts}</span>}
          </button>
          <button className="btn btn-sm btn-outline" onClick={function(){setShowInvite(!showInvite);if(!showInvite)loadStudents();}}>✉ Invite</button>
          <button className="btn btn-danger btn-sm" onClick={handleEndGrade} disabled={loading}>⏹ End &amp; Grade</button>
        </div>
      </div>

      {/* Alerts panel */}
      {showAlerts && (
        <div className="card" style={{marginBottom:14,maxHeight:220,overflowY:'auto'}}>
          <div style={{fontSize:'0.7rem',fontWeight:700,color:'#9ca3af',letterSpacing:1,marginBottom:10,fontFamily:'JetBrains Mono,monospace'}}>STUDENT ACTIVITY</div>
          {studentAlerts.length===0
            ? <div style={{fontSize:'0.82rem',color:'#6b7280',textAlign:'center',padding:'10px 0'}}>No alerts yet — polling every 6s…</div>
            : studentAlerts.map(function(a,i){
              var col=a.type==='urgent'?'#dc2626':a.type==='success'?'#16a34a':'#d97706';
              return <div key={i} style={{padding:'7px 10px',borderBottom:'1px solid rgba(255,255,255,.06)',borderLeft:'3px solid '+col,marginBottom:3}}>
                <div style={{fontWeight:700,fontSize:'0.8rem',color:col}}>{a.title}</div>
                <div style={{fontSize:'0.75rem',color:'#9ca3af',marginTop:2}}>{a.message}</div>
              </div>;
            })
          }
        </div>
      )}

      {/* Invite panel */}
      {showInvite && (
        <div className="card" style={{marginBottom:14}}>
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            {['account','email'].map(function(m){return <button key={m} onClick={function(){setInviteMode(m);}} className={'btn btn-sm '+(inviteMode===m?'btn-primary':'btn-outline')}>{m==='account'?'By Account':'By Email'}</button>;})}
          </div>
          {inviteMode==='account'?(
            <div>
              <div style={{fontSize:'0.8rem',color:'#9ca3af',marginBottom:8}}>Select students:</div>
              <div style={{maxHeight:140,overflowY:'auto',display:'flex',flexWrap:'wrap',gap:7}}>
                {students.map(function(s){var sel=selectedStu.includes(s.user_id);return <div key={s.user_id} onClick={function(){toggleStudent(s.user_id);}} style={{padding:'5px 12px',borderRadius:20,border:'1.5px solid '+(sel?'var(--accent)':'rgba(255,255,255,.15)'),background:sel?'rgba(124,58,237,.2)':'transparent',color:sel?'#a78bfa':'#9ca3af',fontSize:'0.8rem',fontWeight:sel?700:400,cursor:'pointer'}}>{s.name}</div>;})}
              </div>
              {selectedStu.length>0&&<button className="btn btn-primary btn-sm" style={{marginTop:10}} onClick={sendInvites} disabled={inviting}>{inviting?'Sending…':'Send to '+selectedStu.length+' Student(s)'}</button>}
            </div>
          ):(
            <div style={{display:'flex',gap:8}}>
              <input className="form-input" value={inviteEmail} onChange={function(e){setInviteEmail(e.target.value);}} placeholder="email1, email2…" style={{flex:1}}/>
              <button className="btn btn-primary btn-sm" onClick={sendInvites} disabled={inviting||!inviteEmail.trim()}>{inviting?'…':'Send'}</button>
            </div>
          )}
          {inviteMsg&&<div style={{marginTop:8,fontSize:'0.8rem',color:inviteMsg.startsWith('Error')?'#f87171':'#4ade80'}}>{inviteMsg}</div>}
        </div>
      )}

      {/* 3-col layout */}
      <div className="viva-3col">
        {/* Left: cam + generator */}
        <div style={{display:'flex',flexDirection:'column',gap:12,overflow:'auto'}}>
          <div className="card" style={{padding:10}}>
            <video ref={adminVid} autoPlay muted playsInline style={{width:'100%',borderRadius:8,background:'#000',minHeight:130,objectFit:'cover'}}/>
            <div style={{fontSize:'0.7rem',textAlign:'center',marginTop:5,color:'#9ca3af'}}>Your Camera</div>
          </div>
          <div className="card" style={{padding:12}}>
            <div style={{fontSize:'0.7rem',fontWeight:700,color:'#9ca3af',letterSpacing:1,marginBottom:10,fontFamily:'JetBrains Mono,monospace'}}>GENERATE QUESTIONS</div>
            <input className="form-input" value={genTopic} onChange={function(e){setGenTopic(e.target.value);}} placeholder="Topic…" style={{marginBottom:7}}/>
            <div style={{display:'flex',gap:6,marginBottom:7}}>
              {[3,5,7,10].map(function(n){return <button key={n} onClick={function(){setGenCount(n);}} style={{flex:1,padding:'5px 0',borderRadius:6,border:'1px solid '+(genCount===n?'var(--accent)':'rgba(255,255,255,.15)'),background:genCount===n?'rgba(124,58,237,.25)':'transparent',color:genCount===n?'#a78bfa':'#9ca3af',fontSize:'0.8rem',fontWeight:700,cursor:'pointer'}}>{n}</button>;})}
            </div>
            <button className="btn btn-primary btn-sm" style={{width:'100%'}} onClick={handleGenerateQ} disabled={loading||!genTopic.trim()}>{loading?'…':'⚡ Generate'}</button>
          </div>
        </div>

        {/* Middle: Q + answer */}
        <div style={{display:'flex',flexDirection:'column',gap:12,overflow:'auto'}}>
          {questions.length>0&&questions[currentQ]?(
            <div className="card">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <span className="badge badge-primary">Q{currentQ+1}/{questions.length}</span>
                <span style={{fontSize:'0.72rem',color:'#9ca3af'}}>{transcript.length} saved</span>
              </div>
              <div style={{fontWeight:700,fontSize:'1rem',marginBottom:12,color:'#e5e5e5',lineHeight:1.55}}>{questions[currentQ].question}</div>
              <div style={{padding:'10px 12px',background:'rgba(124,58,237,.1)',borderRadius:8,fontSize:'0.82rem',color:'#a78bfa',marginBottom:14}}>
                <div style={{fontSize:'0.65rem',fontWeight:700,letterSpacing:1,marginBottom:5,fontFamily:'JetBrains Mono,monospace'}}>MODEL ANSWER</div>
                {questions[currentQ].model_answer}
              </div>
              <div className="form-group"><label className="form-label">Student's Answer</label>
                <textarea className="form-textarea" value={studentAnswer} onChange={function(e){setStudentAnswer(e.target.value);}} rows={3} placeholder="Type what student said…"/>
              </div>
              <div className="form-group"><label className="form-label">Examiner Notes</label>
                <textarea className="form-textarea" value={examinerNotes} onChange={function(e){setExaminerNotes(e.target.value);}} rows={2} placeholder="Private notes…"/>
              </div>
              {verdict&&(
                <div style={{padding:12,background:verdict.correct?'rgba(22,163,74,.12)':'rgba(220,38,38,.12)',borderRadius:8,marginBottom:12,border:'1px solid '+(verdict.correct?'rgba(22,163,74,.3)':'rgba(220,38,38,.3)')}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                    <span style={{fontWeight:700,color:verdict.correct?'#4ade80':'#f87171'}}>{verdict.verdict}</span>
                    <span style={{fontWeight:800,color:'#a78bfa'}}>{verdict.score_pct}%</span>
                  </div>
                  <div style={{fontSize:'0.82rem',color:'#d1d5db'}}>{verdict.feedback}</div>
                  {verdict.missing&&verdict.missing!=='None'&&<div style={{marginTop:5,fontSize:'0.78rem',color:'#fbbf24'}}>Missing: {verdict.missing}</div>}
                </div>
              )}
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-warning btn-sm" onClick={handleCheckAnswer} disabled={loading||!studentAnswer.trim()}>⚡ Grade</button>
                <button className="btn btn-success btn-sm" onClick={handleSaveNext} disabled={!verdict}>💾 Save &amp; Next</button>
              </div>
            </div>
          ):(
            <div className="card" style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:200}}>
              <div style={{textAlign:'center',color:'#9ca3af'}}><div style={{fontSize:'2.5rem',marginBottom:10}}>🎤</div><div style={{fontWeight:600}}>Generate questions to begin</div></div>
            </div>
          )}
        </div>

        {/* Right: question list + transcript */}
        <div style={{display:'flex',flexDirection:'column',gap:12,overflow:'auto'}}>
          <div className="card" style={{padding:12}}>
            <div style={{fontSize:'0.7rem',fontWeight:700,color:'#9ca3af',letterSpacing:1,marginBottom:10,fontFamily:'JetBrains Mono,monospace'}}>QUESTIONS ({questions.length})</div>
            {questions.length===0?<div style={{fontSize:'0.8rem',color:'#4b5563',textAlign:'center',padding:'10px 0'}}>None yet</div>
              :questions.map(function(q,i){var done=i<transcript.length,isCur=i===currentQ;return <div key={i} onClick={function(){setCurrentQ(i);}} style={{padding:'7px 8px',borderRadius:6,cursor:'pointer',marginBottom:3,background:isCur?'rgba(124,58,237,.18)':'transparent',fontSize:'0.78rem',color:done?'#4ade80':isCur?'#e5e5e5':'#9ca3af',borderLeft:isCur?'3px solid var(--accent)':'3px solid transparent'}}>{done?'✓ ':'  '}{i+1}. {q.question.slice(0,44)}{q.question.length>44?'…':''}</div>;})}
          </div>
          <div className="card" style={{padding:12,flex:1,overflow:'auto'}}>
            <div style={{fontSize:'0.7rem',fontWeight:700,color:'#9ca3af',letterSpacing:1,marginBottom:10,fontFamily:'JetBrains Mono,monospace'}}>TRANSCRIPT ({transcript.length})</div>
            {transcript.length===0?<div style={{fontSize:'0.8rem',color:'#4b5563',textAlign:'center',padding:'10px 0'}}>No entries yet</div>
              :transcript.map(function(t,i){var v=t.verdict;var col=v?(v.correct?'#4ade80':'#f87171'):'#9ca3af';return <div key={i} style={{padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,.06)'}}>
                <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontWeight:600,fontSize:'0.78rem',color:'#e5e5e5'}}>Q{i+1}</span>{v&&<span style={{fontWeight:800,fontSize:'0.78rem',color:col}}>{v.score_pct}%</span>}</div>
                <div style={{fontSize:'0.75rem',color:'#9ca3af',marginTop:2}}>A: {(t.student_answer||'').slice(0,55)}{(t.student_answer||'').length>55?'…':''}</div>
              </div>;})}
          </div>
        </div>
      </div>
    </div>
  );
}
