import React, { useState, useEffect, useRef } from 'react';
import { groqChat } from '../../utils/aiService';
import { useStore } from '../../store/useStore';

function parseJSON(raw) {
  try { return JSON.parse(raw.replace(/```json|```/g,'').trim()); } catch(e) {
    var m = raw.match(/\{[\s\S]*\}/); if (m) try { return JSON.parse(m[0]); } catch(e2) {}
    return null;
  }
}

var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// Session persistence helpers
function saveVP(data) { try { sessionStorage.setItem('vp_session', JSON.stringify(data)); } catch(e) {} }
function loadVP() { try { return JSON.parse(sessionStorage.getItem('vp_session') || 'null'); } catch(e) { return null; } }
function clearVP() { try { sessionStorage.removeItem('vp_session'); } catch(e) {} }

export default function VivaPractice() {
  var store = useStore();
  var _s = loadVP() || {};

  // Setup
  var [phase,     setPhaseRaw]  = useState(_s.phase || 'setup');
  var [topic,     setTopic]     = useState(_s.topic || '');
  var [topicInfo, setTopicInfo] = useState(_s.topicInfo || '');
  var [numQ,      setNumQ]      = useState(_s.numQ || 5);
  var [loading,   setLoading]   = useState(false);

  // Practice
  var [questions,  setQuestions]  = useState(_s.questions || []);
  var [qIndex,     setQIndex]     = useState(_s.qIndex || 0);
  var [transcript, setTranscript] = useState(_s.transcript || []);
  var [recording,  setRecording]  = useState(false);
  var [liveText,   setLiveText]   = useState('');
  var [interimText,setInterimText]= useState('');
  var [verdict,    setVerdict]    = useState(null);
  var [grading,    setGrading]    = useState(false);
  var [ttsSupport, setTtsSupport] = useState(false);
  var [srSupport,  setSrSupport]  = useState(false);
  var [speaking,   setSpeaking]   = useState(false);

  var recRef  = useRef(null);
  var synthRef= useRef(window.speechSynthesis);

  // Results
  var [results,   setResults]   = useState(_s.results || null);
  var [analyzing, setAnalyzing] = useState(false);

  function setPhase(p) {
    setPhaseRaw(p);
    if (p === 'setup') { clearVP(); return; }
    try { const cur = loadVP() || {}; saveVP({ ...cur, phase: p }); } catch(e) {}
  }

  // Persist key state on every render
  useEffect(function() {
    if (phase === 'setup') return;
    saveVP({ phase, topic, topicInfo, numQ, questions, qIndex, transcript, results });
  });

  useEffect(function() {
    setSrSupport(!!SR);
    setTtsSupport(!!(window.speechSynthesis));
  }, []);

  // ====================================================
  async function handleStart() {
    if (!topic.trim()) { store.addToast('Enter a topic first', 'error'); return; }
    setLoading(true);
    try {
      var vpRnd = Math.floor(Math.random() * 9999);
      var sys = 'You are a viva examiner. Return ONLY valid JSON array. Always generate COMPLETELY DIFFERENT questions each call — vary concepts, depth and phrasing.';
      var contextPart = topicInfo.trim() ? ' Context/Notes: ' + topicInfo.trim().slice(0, 800) : '';
      var usr = 'Generate ' + numQ + ' UNIQUE oral viva questions on "' + topic + '".' + contextPart +
        ' Each question must test a different aspect. Mix conceptual, applied, and analytical. Seed: ' + vpRnd + '.' +
        ' Return JSON: [{"question":"?","model_answer":"2-4 sentence answer","hint":"1 key point"}]';
      var raw = await groqChat(sys, usr, 2000, 0.7);
      var qs  = parseJSON(raw);
      if (!Array.isArray(qs) || qs.length === 0) throw new Error('Could not parse questions');
      setQuestions(qs);
      setQIndex(0);
      setTranscript([]);
      setVerdict(null);
      setLiveText('');
      setPhase('practice');
      // Initialize refs for auto flow
      questionsRef.current = qs;
      qIndexRef.current = 0;
      transcriptRef.current = [];
      liveTextRef.current = '';
      flowActive.current = true;
      saveVP({ phase: 'practice', topic, topicInfo, numQ, questions: qs, qIndex: 0, transcript: [], results: null });
      // Auto-speak first question then start listening
      speakText(qs[0].question, function() {
        if (flowActive.current) startListening();
      });
    } catch(e) { store.addToast('Failed to generate: ' + e.message, 'error'); }
    setLoading(false);
  }

  // ====================================================
  var silenceTimer  = useRef(null);
  var liveTextRef   = useRef('');
  var recordingRef  = useRef(false);
  var qIndexRef     = useRef(0);
  var transcriptRef = useRef([]);
  var questionsRef  = useRef([]);
  var flowActive    = useRef(false);

  function speakText(text, onDone) {
    if (!synthRef.current) { if (onDone) onDone(); return; }
    synthRef.current.cancel();
    setSpeaking(true);
    var utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.88; utt.pitch = 1.0;
    utt.onend = function() { setSpeaking(false); if (onDone) onDone(); };
    utt.onerror = function() { setSpeaking(false); if (onDone) onDone(); };
    synthRef.current.speak(utt);
  }

  function startListening() {
    if (!SR) return;
    liveTextRef.current = '';
    setLiveText('');
    setInterimText('');
    setRecording(true);
    recordingRef.current = true;

    var rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    // Reset silence timer every time speech is detected
    // Trigger phrases that mean "I'm done"
    var FINAL_PHRASES = [
      'final answer', 'that is my answer', "that's my answer", 'my final answer',
      'i am done', "i'm done", 'done', 'submit', 'that is all', "that's all",
      'end answer', 'final', 'submit answer'
    ];

    rec.onresult = function(e) {
      clearTimeout(silenceTimer.current);
      var finalChunk = '', interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalChunk += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      if (finalChunk) {
        liveTextRef.current += finalChunk;
        setLiveText(liveTextRef.current);
        // Check if student said a final-answer phrase
        var lower = finalChunk.toLowerCase().trim();
        var saidFinal = FINAL_PHRASES.some(function(p) { return lower.includes(p); });
        if (saidFinal) {
          // Remove the trigger phrase from transcript
          FINAL_PHRASES.forEach(function(p) {
            liveTextRef.current = liveTextRef.current.replace(new RegExp(p, 'gi'), '').trim();
          });
          setLiveText(liveTextRef.current);
          clearTimeout(silenceTimer.current);
          setTimeout(function() { if (recordingRef.current) stopListeningAndGrade(); }, 300);
          return;
        }
      }
      setInterimText(interim);
      // 4 seconds of silence → auto-grade
      silenceTimer.current = setTimeout(function() {
        if (recordingRef.current && liveTextRef.current.trim().length > 3) {
          stopListeningAndGrade();
        }
      }, 4000);
    };

    rec.onend = function() {
      if (recordingRef.current) { try { rec.start(); } catch(e2) {} }
    };
    rec.onerror = function(e) { if (e.error !== 'no-speech') console.warn('STT error:', e.error); };
    rec.start();
    recRef.current = rec;
  }

  function stopListening() {
    clearTimeout(silenceTimer.current);
    recordingRef.current = false;
    setRecording(false);
    setInterimText('');
    if (recRef.current) { try { recRef.current.stop(); } catch(e) {} recRef.current = null; }
  }

  // Called manually OR after 3s silence
  async function stopListeningAndGrade() {
    stopListening();
    var answer = liveTextRef.current.trim();
    var qi = qIndexRef.current;
    var qs = questionsRef.current;
    if (!qs[qi]) return;

    setGrading(true); setVerdict(null);
    var q = qs[qi];
    var v = null;
    try {
      var sys = 'You are an experienced oral viva examiner. Grade spoken student answers fairly. Students speak conversationally and may use different words than the model answer — that is fine. Judge whether the student understands the CONCEPT, not whether they matched exact words. A short clear answer showing understanding should score well. Return ONLY valid JSON.';
      var usr = 'Question: ' + q.question +
        '\nModel Answer (reference only — student does not need to match this exactly): ' + q.model_answer +
        '\nStudent Spoken Answer: ' + (answer || '(no answer)') +
        '\nEvaluate: Does the student demonstrate understanding of the core concept? Did they cover the key idea(s) even if briefly?' +
        '\nReturn: {"correct":true/false,"score_pct":0-100,"verdict":"Correct/Partially Correct/Incorrect","feedback":"2-3 encouraging sentences explaining what was good and what was missing","missing":"key concept they missed, or None if answer was sufficient"}';
      var raw = await groqChat(sys, usr, 400, 0.3);
      v = parseJSON(raw);
      setVerdict(v);
    } catch(e) { v = { correct: false, score_pct: 0, verdict: 'Error', feedback: 'Grading failed', missing: '' }; }
    setGrading(false);

    // Save to transcript
    var entry = { question: q.question, model_answer: q.model_answer, student_said: answer, verdict: v };
    var newT = transcriptRef.current.concat([entry]);
    transcriptRef.current = newT;
    setTranscript(newT);

    // Speak feedback then move to next question
    var feedbackText = (v && v.verdict ? v.verdict + '. ' : '') + (v && v.feedback ? v.feedback : '');
    speakText(feedbackText, function() {
      var isLast = qi >= qs.length - 1;
      if (isLast) {
        flowActive.current = false;
        endSession(newT);
      } else {
        // Next question
        var nextIdx = qi + 1;
        qIndexRef.current = nextIdx;
        setQIndex(nextIdx);
        setLiveText(''); liveTextRef.current = '';
        setVerdict(null);
        // Speak next question then start listening
        speakText(qs[nextIdx].question, function() {
          if (flowActive.current) startListening();
        });
      }
    });
  }

  // ====================================================
  function startRecording() { startListening(); }
  function stopRecording() { stopListening(); }
  function handleGrade() { stopListeningAndGrade(); }

  function handleNext() {
    // Manual next (if user wants to skip)
    stopListening();
    var qi = qIndexRef.current;
    var qs = questionsRef.current;
    var answer = liveTextRef.current.trim();
    var entry = { question: qs[qi].question, model_answer: qs[qi].model_answer, student_said: answer, verdict: verdict };
    var newT = transcriptRef.current.concat([entry]);
    transcriptRef.current = newT;
    setTranscript(newT);
    synthRef.current && synthRef.current.cancel();
    var isLast = qi >= qs.length - 1;
    if (isLast) { flowActive.current = false; endSession(newT); return; }
    var nextIdx = qi + 1;
    qIndexRef.current = nextIdx;
    setQIndex(nextIdx);
    setLiveText(''); liveTextRef.current = '';
    setVerdict(null);
    speakText(qs[nextIdx].question, function() {
      if (flowActive.current) startListening();
    });
  }

  // ====================================================
  async function endSession(finalTranscript) {
    synthRef.current && synthRef.current.cancel();
    stopRecording();
    setPhase('results');
    setAnalyzing(true);

    var correct = (finalTranscript || transcript).filter(function(e) { return e.verdict && e.verdict.correct; }).length;
    var total   = (finalTranscript || transcript).length;
    var avgPct  = total > 0 ? Math.round((finalTranscript || transcript).reduce(function(a, e) { return a + (e.verdict ? (e.verdict.score_pct || 0) : 0); }, 0) / total) : 0;
    var grade   = avgPct >= 90 ? 'A+' : avgPct >= 80 ? 'A' : avgPct >= 70 ? 'B' : avgPct >= 60 ? 'C' : avgPct >= 50 ? 'D' : 'F';

    try {
      var sys = 'You are a viva examiner. Return ONLY valid JSON.';
      var log = (finalTranscript || transcript).map(function(e, i) {
        return 'Q' + (i+1) + ': ' + e.question + ' | Student: ' + (e.student_said || '(no answer)') + ' | ' + (e.verdict ? e.verdict.verdict : 'Not graded');
      }).join('; ');
      var usr = 'Analyze this viva practice session on "' + topic + '":\n' + log +
        '\nReturn: {"overall_feedback":"3-4 sentences","strong_topics":["t"],"weak_topics":["t"],"improvement_tips":["tip1","tip2","tip3"],"predicted_exam_readiness":"Not Ready/Almost Ready/Ready"}';
      var raw = await groqChat(sys, usr, 600, 0.5);
      var analysis = parseJSON(raw);

      var r = {
        grade: grade, avgPct: avgPct, correct: correct, total: total,
        analysis: analysis, transcript: finalTranscript || transcript
      };
      setResults(r);

      // Save to localStorage (separate from exam results)
      var record = {
        id:              Date.now(),
        mode:            'viva',
        subject:         topic,
        difficulty:      'Adaptive',
        total_questions: total,
        correct:         correct,
        score_pct:       avgPct,
        grade:           grade,
        date:            new Date().toISOString(),
        analysis:        analysis ? {
          overall_feedback:           analysis.overall_feedback,
          strong_topics:              analysis.strong_topics,
          weak_topics:                analysis.weak_topics,
          improvement_tips:           analysis.improvement_tips,
          predicted_exam_readiness:   analysis.predicted_exam_readiness,
        } : null,
      };
      var prev = JSON.parse(localStorage.getItem('practice_results') || '[]');
      prev.unshift(record);
      localStorage.setItem('practice_results', JSON.stringify(prev.slice(0, 50)));
    } catch(e) {
      setResults({ grade: grade, avgPct: avgPct, correct: correct, total: total, analysis: null, transcript: finalTranscript || transcript });
    }
    setAnalyzing(false);
  }

  function resetAll() {
    flowActive.current = false;
    clearTimeout(silenceTimer.current);
    synthRef.current && synthRef.current.cancel();
    stopListening();
    clearVP();
    setPhaseRaw('setup'); setTopic(''); setTopicInfo(''); setQuestions([]); setQIndex(0);
    setTranscript([]); setVerdict(null); setLiveText(''); setResults(null);
    liveTextRef.current = ''; qIndexRef.current = 0; transcriptRef.current = []; questionsRef.current = [];
  }

  var gc = function(g) { return g==='A+'||g==='A'?'#16a34a':g==='F'?'#dc2626':g==='B'?'#2563eb':'#d97706'; };
  var gb = function(g) { return g==='A+'||g==='A'?'#dcfce7':g==='F'?'#fee2e2':g==='B'?'#dbeafe':'#fef3c7'; };

  // ====================================================
  // SETUP PHASE
  // ====================================================
  if (phase === 'setup') return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">🎙 Viva Practice</div>
        </div>
      </div>

      {/* Browser support warning */}
      {!srSupport && (
        <div style={{ padding: '12px 16px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, marginBottom: 20, fontSize: '0.85rem', color: 'var(--danger)' }}>
          ⚠️ Speech recognition requires Chrome or Edge. You can still type your answers manually.
        </div>
      )}

      <div style={{ maxWidth: 600 }}>
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 16 }}>Session Setup</div>

          <div className="form-group">
            <label className="form-label">Topic *</label>
            <input className="form-input" value={topic} onChange={function(e){setTopic(e.target.value);}} placeholder="e.g. Database Normalization, Binary Trees, OS Scheduling..."/>
          </div>

          <div className="form-group">
            <label className="form-label">Topic Notes / Syllabus (optional)</label>
            <textarea className="form-textarea" value={topicInfo} onChange={function(e){setTopicInfo(e.target.value);}} rows={4} placeholder="Paste your notes, syllabus, or key concepts here..."/>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text2)' }}>
                📄 Upload PDF/Text
                <input type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={function(e) {
                  var file = e.target.files[0]; if (!file) return;
                  var reader = new FileReader();
                  reader.onload = function(ev) { setTopicInfo(function(prev) { return (prev ? prev + '\n' : '') + ev.target.result.slice(0, 3000); }); };
                  reader.readAsText(file); e.target.value = '';
                }}/>
              </label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>or paste text above</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Number of Questions</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {[3, 5, 7, 10].map(function(n) {
                return (
                  <button key={n} onClick={function(){setNumQ(n);}}
                    style={{ flex: 1, padding: '10px', borderRadius: 9, border: '1.5px solid ' + (numQ===n?'var(--accent)':'var(--border)'), background: numQ===n?'var(--accent-glow)':'var(--surface)', color: numQ===n?'var(--accent)':'var(--text2)', fontWeight: 700, cursor: 'pointer' }}>
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          <button className="btn btn-primary btn-lg" onClick={handleStart} disabled={loading || !topic.trim()}
            style={{ width: '100%', justifyContent: 'center', marginBottom: 20 }}>
            {loading ? <><div className="spinner" style={{width:18,height:18}}></div> Generating Questions...</> : '🚀 Start Viva Practice'}
          </button>
        </div>


      </div>
    </div>
  );

  // ====================================================
  // PRACTICE PHASE
  // ====================================================
  if (phase === 'practice') {
    var q = questions[qIndex];
    var answered = transcript.length;
    return (
      <div className="fade-up">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, padding: '14px 18px', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
          <div>
            <div style={{ fontWeight: 700 }}>🎙 {topic}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Q{qIndex+1} of {questions.length} · {answered} answered</div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {/* Progress dots */}
            <div style={{ display: 'flex', gap: 5 }}>
              {questions.map(function(_, i) {
                var t = transcript[i];
                var bg = t ? (t.verdict && t.verdict.correct ? '#16a34a' : '#dc2626') : i === qIndex ? 'var(--accent)' : 'var(--border)';
                return <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: bg }}/>;
              })}
            </div>
            <button className="btn btn-danger btn-sm" onClick={function(){if(window.confirm('End session?')) endSession(transcript);}}>⏹ End</button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Main area */}
          <div>
            {/* Question card */}
            <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid var(--accent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <span className="badge badge-primary">Question {qIndex+1}</span>
                {ttsSupport && (
                  <button className="btn btn-ghost btn-sm" onClick={function(){speakText(q.question);}} disabled={speaking}>
                    {speaking ? '🔊 Speaking...' : '🔊 Read Aloud'}
                  </button>
                )}
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.55, color: 'var(--text)' }}>{q.question}</div>
              {q.hint && (
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--accent-glow)', borderRadius: 7, fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 500 }}>
                  💡 Hint: {q.hint}
                </div>
              )}
            </div>

            {/* Answer area */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {speaking  && <><span style={{ width:8,height:8,borderRadius:'50%',background:'#7c3aed',display:'inline-block',animation:'pulse 1s infinite' }}/> 🔊 AI Speaking…</>}
                  {recording && !grading && <><span style={{ width:8,height:8,borderRadius:'50%',background:'#dc2626',display:'inline-block',animation:'pulse 1s infinite' }}/> 🎤 Listening…</>}
                  {grading   && <><div className="spinner" style={{width:12,height:12,display:'inline-block'}}/> ⚡ Grading…</>}
                  {!speaking && !recording && !grading && verdict && <>✅ Graded — AI feedback playing…</>}
                  {!speaking && !recording && !grading && !verdict && <>📝 Your Answer</>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {!recording && !speaking && !grading && !verdict && (
                    <button className="btn btn-primary btn-sm" onClick={function(){flowActive.current=true; startListening();}}>🎤 Start</button>
                  )}
                  {recording && (
                    <button className="btn btn-warning btn-sm" onClick={function(){stopListeningAndGrade();}}>✋ Grade Now</button>
                  )}
                  {verdict && !grading && !speaking && (
                    <button className="btn btn-success btn-sm" onClick={handleNext}>Next →</button>
                  )}
                </div>
              </div>

              <div style={{ minHeight: 100, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1.5px solid ' + (recording ? '#dc2626' : speaking ? '#7c3aed' : 'var(--border)'), fontSize: '0.95rem', lineHeight: 1.65, color: 'var(--text)', position: 'relative', transition: 'var(--transition)' }}>
                {liveText || <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>
                  {speaking ? 'Listen to the question…' : recording ? 'Speak your answer now…' : 'Your answer will appear here as you speak'}
                </span>}
                {interimText && <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}> {interimText}</span>}
              </div>

              {/* Type fallback */}
              {!recording && !speaking && !grading && (
                <div style={{ marginTop: 8 }}>
                  <textarea className="form-textarea" rows={2} value={liveText} onChange={function(e){setLiveText(e.target.value); liveTextRef.current=e.target.value;}} placeholder="Or type your answer here…" style={{ fontSize: '0.88rem' }}/>
                  {liveText.trim() && !verdict && (
                    <button className="btn btn-warning btn-sm" style={{ marginTop: 6 }} onClick={function(){stopListeningAndGrade();}} disabled={grading}>⚡ Grade Typed Answer</button>
                  )}
                </div>
              )}
            </div>

            {/* Verdict */}
            {verdict && (
              <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid ' + (verdict.correct ? '#16a34a' : verdict.verdict === 'Partially Correct' ? '#d97706' : '#dc2626') }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: '1.3rem' }}>{verdict.correct ? '✅' : verdict.verdict === 'Partially Correct' ? '⚠️' : '❌'}</span>
                  <span style={{ fontWeight: 700, color: verdict.correct ? '#16a34a' : verdict.verdict === 'Partially Correct' ? '#d97706' : '#dc2626' }}>
                    {verdict.verdict}
                  </span>
                  <span className="badge badge-info" style={{ marginLeft: 'auto' }}>{verdict.score_pct}%</span>
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text2)', lineHeight: 1.6, marginBottom: verdict.missing && verdict.missing !== 'None' ? 8 : 0 }}>{verdict.feedback}</div>
                {verdict.missing && verdict.missing !== 'None' && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--warning)', padding: '6px 10px', background: 'rgba(217,119,6,0.08)', borderRadius: 6 }}>
                    ⚠️ Missing: {verdict.missing}
                  </div>
                )}
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 7 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text3)', fontWeight: 600, marginBottom: 5 }}>MODEL ANSWER</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text2)', lineHeight: 1.6 }}>{q.model_answer}</div>
                </div>
                <button className="btn btn-success" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} onClick={handleNext}>
                  {qIndex < questions.length - 1 ? 'Next Question →' : '🏁 Finish & See Results'}
                </button>
              </div>
            )}

            {!verdict && liveText.trim() && !grading && (
              <div style={{ textAlign: 'center' }}>
                <button className="btn btn-warning" onClick={handleGrade}>⚡ Grade My Answer</button>
              </div>
            )}
          </div>

          {/* Right: transcript sidebar */}
          <div>
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 12, fontSize: '0.9rem' }}>📋 Progress ({answered}/{questions.length})</div>
              {transcript.length === 0
                ? <div style={{ fontSize: '0.85rem', color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>Answer and grade each question to see progress</div>
                : transcript.map(function(t, i) {
                  var v = t.verdict;
                  return (
                    <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text3)' }}>Q{i+1}</span>
                        {v && <span style={{ fontSize: '0.78rem', fontWeight: 700, color: v.correct ? '#16a34a' : v.verdict === 'Partially Correct' ? '#d97706' : '#dc2626' }}>{v.score_pct}%</span>}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 3 }}>{t.question.slice(0, 50)}...</div>
                      {v && <span className={'badge badge-' + (v.correct ? 'success' : v.verdict === 'Partially Correct' ? 'warning' : 'danger')} style={{ fontSize: '0.65rem' }}>{v.verdict}</span>}
                    </div>
                  );
                })
              }
              {transcript.length > 0 && (
                <button className="btn btn-outline btn-sm" style={{ width: '100%', marginTop: 12, justifyContent: 'center' }} onClick={function(){endSession(transcript);}}>
                  ⏹ End & Get Results
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ====================================================
  // RESULTS PHASE
  // ====================================================
  var finalCorrect = (results && results.correct) || 0;
  var finalTotal   = (results && results.total)   || 0;
  var finalGrade   = (results && results.grade)   || 'F';
  var finalPct     = (results && results.avgPct)  || 0;
  var analysis     = results && results.analysis;

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className="btn btn-ghost" onClick={resetAll}>← New Session</button>
        <div className="page-title">🎙 Viva Practice Results</div>
        <div style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text3)', background: 'var(--accent-glow)', padding: '4px 12px', borderRadius: 20 }}>Topic: {topic}</div>
      </div>

      {/* Score card */}
      <div className="card" style={{ marginBottom: 20, background: gb(finalGrade), borderLeft: '4px solid ' + gc(finalGrade) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', fontWeight: 900, color: gc(finalGrade), lineHeight: 1 }}>{finalGrade}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>GRADE</div>
          </div>
          <div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: gc(finalGrade), lineHeight: 1 }}>{finalPct}%</div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text2)', marginTop: 4 }}>{finalCorrect}/{finalTotal} correct answers</div>
          </div>
          <div style={{ flex: 1, maxWidth: 300 }}>
            <div className="progress-bar"><div className="progress-fill" style={{ width: finalPct + '%', background: gc(finalGrade) }}></div></div>
          </div>
        </div>
      </div>

      {analyzing ? (
        <div className="loading-center"><div className="spinner"></div><span>Generating analysis...</span></div>
      ) : analysis && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title" style={{ marginBottom: 14 }}>📊 AI Analysis</div>
          {analysis.overall_feedback && (
            <div style={{ padding: '12px 14px', background: 'var(--surface2)', borderRadius: 8, marginBottom: 16, fontSize: '0.9rem', color: 'var(--text2)', lineHeight: 1.7 }}>
              {analysis.overall_feedback}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--success)', marginBottom: 8, fontSize: '0.85rem' }}>💪 Strengths</div>
              {(analysis.strong_topics || []).length === 0
                ? <div style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Keep practicing to build strengths</div>
                : (analysis.strong_topics || []).map(function(t, i) { return <div key={i} style={{ fontSize: '0.85rem', padding: '4px 0', color: 'var(--text2)' }}>✅ {t}</div>; })
              }
            </div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: 8, fontSize: '0.85rem' }}>📌 Needs Work</div>
              {(analysis.weak_topics || []).length === 0
                ? <div style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Great job — no major gaps!</div>
                : (analysis.weak_topics || []).map(function(t, i) { return <div key={i} style={{ fontSize: '0.85rem', padding: '4px 0', color: 'var(--text2)' }}>⚠️ {t}</div>; })
              }
            </div>
          </div>
          {(analysis.improvement_tips || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, fontSize: '0.85rem' }}>📈 Improvement Tips</div>
              {analysis.improvement_tips.map(function(t, i) { return <div key={i} style={{ fontSize: '0.85rem', padding: '4px 0', color: 'var(--text2)' }}>{i+1}. {t}</div>; })}
            </div>
          )}
          {analysis.predicted_exam_readiness && (
            <div style={{ padding: '10px 14px', background: 'var(--accent-glow)', borderRadius: 8, fontWeight: 700, color: 'var(--accent)' }}>
              🎯 Exam Readiness: {analysis.predicted_exam_readiness}
            </div>
          )}
        </div>
      )}

      {/* Q&A Breakdown */}
      <div className="card">
        <div className="card-title" style={{ marginBottom: 16 }}>📋 Answer Breakdown</div>
        {(results && results.transcript || []).map(function(t, i) {
          var v = t.verdict;
          var col = v ? (v.correct ? '#16a34a' : v.verdict === 'Partially Correct' ? '#d97706' : '#dc2626') : '#9ca3af';
          return (
            <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 700, color: 'var(--text3)', fontSize: '0.82rem', flexShrink: 0 }}>Q{i+1}</span>
                <div style={{ fontWeight: 600, fontSize: '0.92rem', flex: 1 }}>{t.question}</div>
                {v && <span style={{ fontWeight: 700, color: col, fontSize: '0.85rem', flexShrink: 0 }}>{v.score_pct}%</span>}
              </div>
              {t.student_said && (
                <div style={{ marginLeft: 28, fontSize: '0.85rem', color: 'var(--text2)', marginBottom: 6, padding: '6px 10px', background: 'var(--surface2)', borderRadius: 6 }}>
                  <strong>You said:</strong> {t.student_said}
                </div>
              )}
              {v && v.feedback && (
                <div style={{ marginLeft: 28, fontSize: '0.82rem', color: col, fontWeight: 500 }}>{v.feedback}</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="btn btn-primary btn-lg" onClick={resetAll}>🔄 Practice Again</button>
      </div>
    </div>
  );
}
