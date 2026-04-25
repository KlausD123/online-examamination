import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { apiPost } from '../../utils/api';

// ── Groq Vision proctoring — uses backend to keep key secret ─────────────────
async function checkFrameWithGroq(videoEl) {
  try {
    var canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    canvas.getContext('2d').drawImage(videoEl, 0, 0, 320, 240);
    var base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    // Call backend which holds the API key
    var data = await apiPost('/ai/vision', { image: base64, prompt: 'Count the number of people/persons visible. Reply with ONLY a single digit: 0, 1, 2, 3 etc.' });
    var num = parseInt((data.result || '1').match(/\d+/)?.[0]) || 1;
    console.log('[Proctor] Persons detected:', num);
    return num;
  } catch(e) { console.warn('[Proctor] Vision check failed:', e); return 1; }
}

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
  var [faceStatus,  setFaceStatus]  = useState('loading');
  var [faceCount,   setFaceCount]   = useState(0);
  var [voiceAlert,  setVoiceAlert]  = useState(false);
  var [faceApiReady,setFaceApiReady]= useState(false);
  var [aiWrittenLoading, setAiWrittenLoading] = useState(null);
  var [aiWrittenResult,  setAiWrittenResult]  = useState(null);
  var [gradingWritten,   setGradingWritten]   = useState(null);
  var [writtenGrade,     setWrittenGrade]     = useState(null);

  var violRef         = useRef(0);
  var cheatedRef      = useRef(false);
  var submittingRef   = useRef(false);
  var videoRef        = useRef(null);
  var canvasRef       = useRef(null);
  var streamRef       = useRef(null);
  var voiceIntervalRef= useRef(null);
  var faceIntervalRef = useRef(null);
  var loudFramesRef   = useRef(0);
  var noFaceFramesRef = useRef(0);
  var multiFaceFramesRef = useRef(0);

  // AI check written answer via backend
  async function checkAIWritten(qid, text) {
    setAiWrittenLoading(qid); setAiWrittenResult(null);
    try {
      var data = await apiPost('/ai/chat', {
        messages: [{ role: 'user', content: 'Analyze if this student answer was written by AI or a human.\n\nAnswer: "' + text + '"\n\nReturn ONLY JSON: {"isAI":true/false,"confidence":0-100,"reason":"one sentence"}' }],
        max_tokens: 120, temperature: 0.1
      });
      var raw = data.choices[0].message.content.trim();
      var result = JSON.parse(raw.replace(/```json|```/g, '').trim());
      setAiWrittenResult({ qid: qid, ...result });
    } catch(e) { setAiWrittenResult({ qid: qid, isAI: false, confidence: 0, reason: 'Check failed' }); }
    setAiWrittenLoading(null);
  }

  async function gradeWritten(qid, question, modelAnswer, studentAnswer) {
    setGradingWritten(qid); setWrittenGrade(null);
    try {
      var data = await apiPost('/ai/chat', {
        messages: [{ role: 'user', content: 'Grade this student answer by concept understanding.\n\nQuestion: ' + question + '\nModel Answer (reference): ' + (modelAnswer||'N/A') + '\nStudent Answer: ' + studentAnswer + '\n\nReturn ONLY JSON: {"verdict":"Correct|Partially Correct|Incorrect","score_pct":0-100,"feedback":"1-2 sentences"}' }],
        max_tokens: 150, temperature: 0.2
      });
      var raw = data.choices[0].message.content.trim();
      var result = JSON.parse(raw.replace(/```json|```/g, '').trim());
      setWrittenGrade({ qid: qid, ...result });
    } catch(e) { setWrittenGrade({ qid: qid, verdict: 'Error', score_pct: 0, feedback: 'Grading failed' }); }
    setGradingWritten(null);
  }

  useEffect(function () {
    store.loadQuestions(exam.exam_id).then(function (qs) { setQuestions(qs); setLoading(false); });
  }, []); // eslint-disable-line

  useEffect(function () {
    startMonitoring();
    return function () { stopMonitoring(); };
  }, []); // eslint-disable-line

  async function startMonitoring() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      streamRef.current = stream;
      setCamOn(true); setMicOn(true);
      stream.getVideoTracks().forEach(function(t) {
        t.onended = function() {
          setCamOn(false);
          triggerViolation('Camera was turned off during exam — violation');
          // Auto-recover
          setTimeout(function() {
            navigator.mediaDevices.getUserMedia({ video: true, audio: false })
              .then(function(s) {
                s.getVideoTracks().forEach(function(vt) {
                  streamRef.current.addTrack(vt);
                  vt.onended = t.onended; // re-attach handler
                });
                if (videoRef.current) videoRef.current.srcObject = streamRef.current;
                setCamOn(true);
              }).catch(function(){ triggerViolation('Camera could not be restored'); });
          }, 2000);
        };
      });
      stream.getAudioTracks().forEach(function(t) {
        t.onended = function() {
          setMicOn(false); triggerViolation('Microphone was turned off during the exam');
          setTimeout(function() {
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function(s) {
              s.getAudioTracks().forEach(function(at) { streamRef.current.addTrack(at); });
              setMicOn(true);
            }).catch(function(){});
          }, 3000);
        };
      });
      var iv = setInterval(function () {
        if (videoRef.current) {
          videoRef.current.srcObject = stream; clearInterval(iv);
          videoRef.current.onloadedmetadata = startFaceDetection;
        }
      }, 200);
    } catch (e) { setCamError('Camera/mic unavailable: ' + (e.message||'')); setFaceStatus('unavailable'); }
  }

  function stopMonitoring() {
    clearInterval(faceIntervalRef.current); clearInterval(voiceIntervalRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(function(t){t.stop();});
  }

  function triggerViolation(reason) {
    if (cheatedRef.current || submittingRef.current) return;
    violRef.current += 1; setViolations(violRef.current);
    if (violRef.current === 1) { setViolReason(reason); setShowWarning(true); }
    else { cheatedRef.current = true; doCheatSubmit(reason); }
  }

  function startFaceDetection() {
    setFaceApiReady(true); setFaceStatus('ok');
    faceIntervalRef.current = setInterval(async function() {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      if (cheatedRef.current || submittingRef.current) return;
      var count = await checkFrameWithGroq(videoRef.current);
      setFaceCount(count);
      if (count === 0) {
        noFaceFramesRef.current++;
        setFaceStatus('no_face');
        // Trigger after 3 consecutive checks (15s) — avoid false positives
        if (noFaceFramesRef.current >= 3) {
          noFaceFramesRef.current = 0;
          triggerViolation('No person detected in camera for extended time');
        }
      } else if (count > 1) {
        multiFaceFramesRef.current++;
        noFaceFramesRef.current = 0;
        setFaceStatus('multiple');
        // IMMEDIATE violation on first confirmed multi-person detection
        if (multiFaceFramesRef.current >= 1) {
          multiFaceFramesRef.current = 0;
          triggerViolation('Multiple people detected in camera — only you should be visible');
        }
      } else {
        noFaceFramesRef.current = 0;
        multiFaceFramesRef.current = 0;
        setFaceStatus('ok');
      }
    }, 5000); // Check every 5 seconds
  }

  var handleVisibility = useCallback(function () {
    if (document.hidden && !cheatedRef.current && !submittingRef.current) {
      triggerViolation('Tab switch / window change detected');
      setTimeout(function() { try { window.focus(); } catch(e) {} }, 100);
    }
  }, []); // eslint-disable-line

  useEffect(function () {
    document.addEventListener('visibilitychange', handleVisibility);
    function blockContext(e) { e.preventDefault(); }
    document.addEventListener('contextmenu', blockContext);
    function blockUnload(e) {
      if (!submittingRef.current && !cheatedRef.current) { e.preventDefault(); e.returnValue = 'Exam in progress!'; }
    }
    window.addEventListener('beforeunload', blockUnload);
    return function () {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('contextmenu', blockContext);
      window.removeEventListener('beforeunload', blockUnload);
    };
  }, [handleVisibility]); // eslint-disable-line

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

  async function doCheatSubmit(reason) {
    if (submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); stopMonitoring();
    try {
      await store.submitExam(submissionId, [], exam.exam_id, true);
      await apiPost('/notifications', { title: 'INTEGRITY VIOLATION: ' + (store.currentUser.name||'Student'), message: (store.currentUser.name||'Student') + ' violated exam rules in "' + exam.title + '". Reason: ' + reason + '. Score: ZERO.', type: 'urgent' });
    } catch(e) {}
    onComplete();
  }

  async function doFinalSubmit(autoTime) {
    if (submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setShowConfirm(false); stopMonitoring();
    var ansArr = questions.map(function(q) { return { question_id: q.question_id, answer_text: answers[q.question_id]||'' }; });
    var correctCount = 0;
    questions.forEach(function(q) { if (answers[q.question_id] && answers[q.question_id].trim().toLowerCase() === String(q.correct_answer||'').trim().toLowerCase()) correctCount++; });
    var result = null;
    try { result = await store.submitExam(submissionId, ansArr, exam.exam_id, false); } catch(e) {}
    try {
      var score = result && result.total_score != null ? result.total_score : '?';
      var grade = result && result.grade ? result.grade : '-';
      await apiPost('/notifications', { title: 'Exam Submitted: ' + (store.currentUser.name||'Student'), message: (store.currentUser.name||'Student') + ' submitted "' + exam.title + '".' + (autoTime?' [AUTO-SUBMITTED]':'') + ' Score: ' + score + '/' + exam.total_marks + ' Grade: ' + grade, type: 'success' });
    } catch(e) {}
    onComplete();
  }

  function setAnswer(qid, val) { setAnswers(function(p){var a=Object.assign({},p);a[qid]=val;return a;}); }

  var mins = Math.floor(timeLeft/60), secs = timeLeft%60;
  var timeStr = String(mins).padStart(2,'0') + ':' + String(secs).padStart(2,'0');
  var isUrgent = timeLeft < 300;
  var answeredCount = Object.keys(answers).filter(function(k){return answers[k];}).length;
  var faceInfo = {
    loading:{label:'Loading…',color:'#9ca3af',bg:'#f3f4f6',icon:'🔄'},
    ok:{label:'OK ✓',color:'#16a34a',bg:'#dcfce7',icon:'✅'},
    no_face:{label:'No Person!',color:'#dc2626',bg:'#fee2e2',icon:'👤'},
    multiple:{label:'Multiple!',color:'#dc2626',bg:'#fee2e2',icon:'👥'},
    unavailable:{label:'Camera Off',color:'#dc2626',bg:'#fee2e2',icon:'🚫'},
  };
  var fi = faceInfo[faceStatus] || faceInfo.loading;

  if (loading) return <div className="loading-center"><div className="spinner"/><span>Loading exam...</span></div>;
  var q = questions[currentQ];

  return (
    <div className="fade-up" style={{ maxWidth:1060, margin:'0 auto' }}>
      <style>{'.toast-container,.topbar,.nav-sidebar{display:none!important}'}</style>

      {(!camOn||!micOn)&&<div style={{position:'fixed',top:0,left:0,right:0,zIndex:9999,background:'#dc2626',color:'#fff',textAlign:'center',padding:'8px 16px',fontWeight:700,fontSize:'0.85rem'}}>⚠️ {!camOn&&!micOn?'Camera and microphone are off':!camOn?'Camera is off':'Microphone is off'} — violation. Restoring…</div>}
      {voiceAlert&&<div style={{position:'fixed',top:72,left:'50%',transform:'translateX(-50%)',zIndex:3000,background:'#dc2626',color:'#fff',padding:'11px 28px',borderRadius:30,fontWeight:700,fontSize:'0.9rem'}}>🔊 Multiple voices detected!</div>}
      {faceStatus==='multiple'&&<div style={{position:'fixed',top:72,left:'50%',transform:'translateX(-50%)',zIndex:3000,background:'#dc2626',color:'#fff',padding:'11px 28px',borderRadius:30,fontWeight:700}}>👥 Multiple people detected!</div>}
      {faceStatus==='no_face'&&<div style={{position:'fixed',top:72,left:'50%',transform:'translateX(-50%)',zIndex:3000,background:'#d97706',color:'#fff',padding:'11px 28px',borderRadius:30,fontWeight:700}}>👤 Please stay in frame</div>}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,padding:'12px 18px',background:'var(--surface)',borderRadius:12,border:'1px solid var(--border)',flexWrap:'wrap',gap:10}}>
        <div><div style={{fontWeight:700,fontSize:'1.05rem'}}>{exam.title}</div><div style={{fontSize:'0.77rem',color:'var(--text3)'}}>{answeredCount}/{questions.length} answered · {exam.total_marks} marks</div></div>
        <div className={'exam-timer'+(isUrgent?' urgent':'')}>{timeStr}</div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <div style={{padding:'4px 10px',borderRadius:20,background:fi.bg,color:fi.color,fontSize:'0.73rem',fontWeight:700}}>{fi.icon} {fi.label}</div>
          {faceApiReady&&<div style={{padding:'4px 10px',borderRadius:20,background:faceCount===1?'rgba(22,163,74,.1)':'rgba(220,38,38,.1)',color:faceCount===1?'#16a34a':'#dc2626',fontSize:'0.73rem',fontWeight:700}}>👤 {faceCount} person{faceCount!==1?'s':''}</div>}
          <div style={{padding:'4px 10px',borderRadius:20,background:micOn?'rgba(22,163,74,.12)':'rgba(220,38,38,.1)',color:micOn?'#16a34a':'#dc2626',fontSize:'0.73rem',fontWeight:700}}>🎤 {micOn?'On':'Off'}</div>
          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:'0.73rem',color:violations>0?'var(--danger)':'var(--text3)',fontWeight:600}}>Violations: {[0,1].map(function(i){return <span key={i} style={{width:11,height:11,borderRadius:'50%',background:i<violations?'var(--danger)':'var(--border)',display:'inline-block',marginLeft:3}}/>;})}</div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 248px',gap:18}}>
        <div className="card">
          {q&&<div>
            <div style={{display:'flex',gap:8,marginBottom:14}}>
              <span className="badge badge-primary">Q{currentQ+1}/{questions.length}</span>
              <span className="badge badge-info">{q.marks} marks</span>
              <span className={'badge badge-'+(q.difficulty==='Easy'?'success':q.difficulty==='Hard'?'danger':'warning')}>{q.difficulty||'Medium'}</span>
            </div>
            <div style={{fontSize:'1.05rem',fontWeight:500,marginBottom:22,lineHeight:1.65}}>{q.question_text}</div>
            {q.question_type==='MCQ'&&q.options&&q.options.map(function(opt,i){var t=opt.text||opt;var sel=answers[q.question_id]===t;return(<div key={i} onClick={function(){setAnswer(q.question_id,t);}} style={{padding:'12px 16px',border:'2px solid '+(sel?'var(--accent)':'var(--border)'),borderRadius:10,marginBottom:10,cursor:'pointer',background:sel?'var(--accent-glow)':'var(--surface)',display:'flex',alignItems:'center',gap:12}}><span style={{width:28,height:28,borderRadius:'50%',border:'2px solid '+(sel?'var(--accent)':'var(--border)'),display:'flex',alignItems:'center',justifyContent:'center',fontWeight:600,fontSize:'0.78rem',background:sel?'var(--accent)':'transparent',color:sel?'#fff':'var(--text3)',flexShrink:0}}>{String.fromCharCode(65+i)}</span><span style={{fontWeight:sel?600:400}}>{t}</span></div>);})}
            {q.question_type==='TRUE_FALSE'&&<div style={{display:'flex',gap:12}}>{['True','False'].map(function(v){var sel=answers[q.question_id]===v;return<button key={v} className={'btn '+(sel?'btn-primary':'btn-outline')} style={{flex:1,justifyContent:'center'}} onClick={function(){setAnswer(q.question_id,v);}}>{v}</button>;})}</div>}
            {(q.question_type==='SHORT_ANSWER'||q.question_type==='DESCRIPTIVE')&&<div>
              <textarea className="form-textarea" value={answers[q.question_id]||''} onChange={function(e){setAnswer(q.question_id,e.target.value);}} rows={q.question_type==='DESCRIPTIVE'?6:3} placeholder="Type your answer..."/>
              {answers[q.question_id]&&answers[q.question_id].length>30&&<div style={{marginTop:8,display:'flex',gap:8}}>
                <button type="button" className="btn btn-outline btn-sm" onClick={function(){checkAIWritten(q.question_id,answers[q.question_id]);}} disabled={aiWrittenLoading===q.question_id}>{aiWrittenLoading===q.question_id?'⚡ Checking…':'🤖 Check AI-Generated'}</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={function(){gradeWritten(q.question_id,q.question_text,q.correct_answer||q.explanation||'',answers[q.question_id]);}} disabled={gradingWritten===q.question_id}>{gradingWritten===q.question_id?'⚡ Grading…':'📊 Preview Grade'}</button>
              </div>}
              {aiWrittenResult&&aiWrittenResult.qid===q.question_id&&<div style={{marginTop:8,padding:'8px 12px',borderRadius:8,background:aiWrittenResult.isAI?'rgba(220,38,38,.08)':'rgba(22,163,74,.08)',border:'1px solid '+(aiWrittenResult.isAI?'rgba(220,38,38,.3)':'rgba(22,163,74,.3)'),fontSize:'0.82rem'}}><strong style={{color:aiWrittenResult.isAI?'#dc2626':'#16a34a'}}>{aiWrittenResult.isAI?'🚨 Likely AI-generated':'✅ Appears human-written'}</strong><span style={{color:'var(--text3)',marginLeft:8}}>Confidence: {aiWrittenResult.confidence}%</span>{aiWrittenResult.reason&&<div style={{color:'var(--text3)',marginTop:4,fontSize:'0.78rem'}}>{aiWrittenResult.reason}</div>}</div>}
              {writtenGrade&&writtenGrade.qid===q.question_id&&<div style={{marginTop:8,padding:'8px 12px',borderRadius:8,background:'rgba(124,58,237,.08)',border:'1px solid rgba(124,58,237,.25)',fontSize:'0.82rem'}}><strong style={{color:'var(--accent)'}}>Preview: {writtenGrade.verdict} — {writtenGrade.score_pct}%</strong>{writtenGrade.feedback&&<div style={{color:'var(--text3)',marginTop:4,fontSize:'0.78rem'}}>{writtenGrade.feedback}</div>}</div>}
            </div>}
          </div>}
          <div style={{display:'flex',justifyContent:'space-between',marginTop:22}}>
            <button className="btn btn-outline" disabled={currentQ===0} onClick={function(){setCurrentQ(function(p){return p-1;});}}>← Previous</button>
            {currentQ<questions.length-1?<button className="btn btn-primary" onClick={function(){setCurrentQ(function(p){return p+1;});}}>Next →</button>:<button className="btn btn-success" onClick={function(){setShowConfirm(true);}} disabled={submitting}>📤 Submit Exam</button>}
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div className="card" style={{padding:10}}>
            <div style={{fontSize:'0.68rem',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:1,marginBottom:7,fontFamily:'JetBrains Mono,monospace',textAlign:'center'}}>📹 Proctoring</div>
            <div style={{position:'relative',borderRadius:8,overflow:'hidden',background:'#000',lineHeight:0}}>
              {camOn?<video ref={videoRef} autoPlay muted playsInline style={{width:'100%',height:148,objectFit:'cover',display:'block'}}/>:<div style={{width:'100%',height:110,background:'#1a1a2e',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:6}}><span style={{fontSize:'1.5rem',opacity:.4}}>📷</span><span style={{fontSize:'0.68rem',color:'#6b7280'}}>{camError||'No camera'}</span></div>}
            </div>
            <div style={{marginTop:8,padding:'6px 10px',background:fi.bg,borderRadius:7,textAlign:'center',border:'1px solid '+fi.color+'33'}}>
              <div style={{fontSize:'0.72rem',fontWeight:700,color:fi.color}}>{fi.icon} {fi.label}</div>
              {faceApiReady&&faceCount>0&&<div style={{fontSize:'0.65rem',color:faceCount===1?'#16a34a':'#dc2626',marginTop:2}}>{faceCount} person{faceCount!==1?'s':''} detected</div>}
            </div>
          </div>
          <div className="card" style={{flex:1}}>
            <div style={{fontWeight:600,marginBottom:10,fontSize:'0.85rem'}}>Questions</div>
            <div className="question-nav">{questions.map(function(qq,i){var cls=i===currentQ?'current':(answers[qq.question_id]?'answered':'');return<button key={i} className={cls} onClick={function(){setCurrentQ(i);}}>{i+1}</button>;})}</div>
            <button className="btn btn-success btn-sm" style={{width:'100%',marginTop:14,justifyContent:'center'}} onClick={function(){setShowConfirm(true);}} disabled={submitting}>📤 Submit</button>
          </div>
        </div>
      </div>

      {showWarning&&<div className="modal-overlay"><div className="modal-content" style={{textAlign:'center'}}><div style={{fontSize:'3rem',marginBottom:12}}>⚠️</div><div className="modal-title">Violation Detected!</div><div className="modal-body"><strong>Reason:</strong> {violReason}<br/><br/>This is your <strong>first and only warning</strong>. A second violation will submit your exam with <strong>zero score</strong>.</div><button className="btn btn-primary" onClick={function(){setShowWarning(false);}}>I Understand — Continue</button></div></div>}
      {showConfirm&&<div className="modal-overlay"><div className="modal-content"><div className="modal-title">📤 Submit Exam?</div><div className="modal-body">Answered <strong>{answeredCount} of {questions.length}</strong> questions. Cannot be undone.</div><div className="modal-actions"><button className="btn btn-outline" onClick={function(){setShowConfirm(false);}}>Cancel</button><button className="btn btn-success" onClick={function(){doFinalSubmit(false);}} disabled={submitting}>{submitting?'Submitting…':'✅ Confirm Submit'}</button></div></div></div>}
    </div>
  );
}
