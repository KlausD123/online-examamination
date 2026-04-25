import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { generateExamQuestions, generateQuestions } from '../../utils/aiService';
import { apiGet, apiPost } from '../../utils/api';

var DRAFT_KEY   = 'examai_draft_exam';
var SESSION_KEY = 'ce_session'; // CreateExam in-progress state

function saveCS(data) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch(e) {} }
function loadCS() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch(e) { return null; } }
function clearCS() { try { sessionStorage.removeItem(SESSION_KEY); } catch(e) {} }

export default function CreateExam({ navigate, editExam }) {
  var store = useStore();
  var _s = (!editExam && loadCS()) || {};

  var [step,        setStepRaw]    = useState(_s.step || 1);
  var [examId,      setExamId]     = useState(_s.examId || null);
  var [title,       setTitle]      = useState(_s.title || '');
  var [description, setDescription]= useState(_s.description || '');
  var [duration,    setDuration]   = useState(_s.duration || 60);
  var [totalMarks,  setTotalMarks] = useState(_s.totalMarks || 100);
  var [startTime,   setStartTime]  = useState(_s.startTime || '');
  var [endTime,     setEndTime]    = useState(_s.endTime || '');
  var [loading,     setLoading]    = useState(false);
  var [error,       setError]      = useState('');

  // Step 2 state
  var [savedQuestions, setSavedQuestions] = useState([]);
  var [currentMarks,   setCurrentMarks]   = useState(0);
  var [qTab,           setQTab]           = useState(_s.qTab || 'ai');
  var [aiTopic,        setAiTopic]        = useState(_s.aiTopic || '');
  var [aiType,         setAiType]         = useState(_s.aiType || 'MCQ');
  var [aiDiff,         setAiDiff]         = useState(_s.aiDiff || 'Medium');
  var [aiCount,        setAiCount]        = useState(_s.aiCount || 5);
  var [aiLoading,      setAiLoading]      = useState(false);
  var [generated,      setGenerated]      = useState(_s.generated || []);

  // Course / visibility
  var [courses,        setCourses]        = useState([]);
  var [examScope,      setExamScope]      = useState('global');
  var [courseMembers,  setCourseMembers]  = useState([]);
  var [targetStudents, setTargetStudents] = useState([]);

  // Manual
  var [mType,        setMType]        = useState('MCQ');
  var [mDiff,        setMDiff]        = useState('Medium');
  var [mMarks,       setMMarks]       = useState(10);
  var [mText,        setMText]        = useState('');
  var [mOptions,     setMOptions]     = useState(['', '', '', '']);
  var [mCorrect,     setMCorrect]     = useState('');
  var [mExplanation, setMExplanation] = useState('');
  var [showAbandon,  setShowAbandon]  = useState(false);
  var [draftBanner,  setDraftBanner]  = useState(null);

  // Persist form state on every render (skip when editing existing exam)
  useEffect(function() {
    apiGet('/courses').then(function(d){ setCourses(d||[]); }).catch(function(){});
  }, []); // eslint-disable-line

  useEffect(function() {
    if (!examScope.startsWith('targeted_')) { setCourseMembers([]); return; }
    var cid = examScope.replace('targeted_', '');
    apiGet('/courses/' + cid + '/members').then(function(d){ setCourseMembers(d||[]); }).catch(function(){});
  }, [examScope]); // eslint-disable-line

  useEffect(function() {
    if (editExam || step === 1 && !examId) {
      // Still on step 1 with no exam created yet — persist form fields
      if (!editExam) saveCS({ step, title, description, duration, totalMarks, startTime, endTime, qTab, aiTopic, aiType, aiDiff, aiCount, generated });
      return;
    }
    saveCS({ step, examId, title, description, duration, totalMarks, startTime, endTime, qTab, aiTopic, aiType, aiDiff, aiCount, generated });
  });

  function setStep(s) {
    setStepRaw(s);
  }

  useEffect(function() {
    var draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (draft && draft.exam_id && !editExam) {
      setDraftBanner(draft);
    }
    if (editExam) {
      setExamId(editExam.exam_id);
      setTitle(editExam.title);
      setTotalMarks(editExam.total_marks);
      setStep(2);
      loadSaved(editExam.exam_id);
    }
  }, []); // eslint-disable-line

  function loadSaved(eid) {
    store.loadQuestions(eid).then(function(qs) {
      setSavedQuestions(qs);
      var m = 0; qs.forEach(function(q) { m += q.marks; }); setCurrentMarks(m);
    });
  }

  async function handleCreateExam(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      var finalCourseId = examScope.startsWith('course_') ? examScope.replace('course_','') : examScope.startsWith('targeted_') ? examScope.replace('targeted_','') : null;
      var finalExamType = examScope === 'global' ? 'global' : examScope.startsWith('targeted_') ? 'targeted' : 'course_global';
      var r = await store.createExam({ title: title, description: description, duration_minutes: duration, total_marks: totalMarks, scheduled_at: startTime || null, end_at: endTime || null, course_id: finalCourseId, exam_type: finalExamType });
      // If targeted, assign specific students
      if (finalExamType === 'targeted' && targetStudents.length > 0) {
        try { await apiPost('/courses/' + finalCourseId + '/assign-exam', { exam_id: r.exam_id, student_ids: targetStudents }); } catch(e){}
      }
      setExamId(r.exam_id);
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ exam_id: r.exam_id, title: title, total_marks: totalMarks, saved_at: new Date().toISOString() }));
      saveCS({ step: 2, examId: r.exam_id, title, description, duration, totalMarks, startTime, endTime, qTab, aiTopic, aiType, aiDiff, aiCount, generated: [] });
      setStepRaw(2);
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  async function handleAIGenerate() {
    if (!aiTopic) return;
    setAiLoading(true); setError('');
    try {
      var marksLeft = totalMarks - currentMarks;
      var perQ = Math.floor(marksLeft / aiCount);
      if (perQ < 1) { setError('Not enough marks remaining'); setAiLoading(false); return; }

      // Collect all existing question texts (saved + already generated) to avoid repeats
      var existingTexts = savedQuestions.map(function(q) { return q.question_text || ''; })
        .concat(generated.map(function(q) { return q.question_text || ''; }));

      var qs = await generateExamQuestions(aiTopic, aiType, aiDiff, aiCount, perQ, existingTexts);
      // Auto-distribute marks
      var remainder = marksLeft - (perQ * qs.length);
      qs.forEach(function(q, i) {
        q.marks = perQ + (i < remainder ? 1 : 0);
        q._accepted = true;
      });
      setGenerated(qs);
    } catch (err) { setError('AI generation failed: ' + err.message); }
    setAiLoading(false);
  }

  function rebalanceMarks() {
    var accepted = generated.filter(function(q) { return q._accepted; });
    if (accepted.length === 0) return;
    var marksLeft = totalMarks - currentMarks;
    var perQ = Math.floor(marksLeft / accepted.length);
    var remainder = marksLeft - (perQ * accepted.length);
    var updated = generated.map(function(q) {
      if (!q._accepted) return q;
      var idx = accepted.indexOf(q);
      return Object.assign({}, q, { marks: perQ + (idx < remainder ? 1 : 0) });
    });
    setGenerated(updated);
  }

  async function saveGeneratedQuestions() {
    var accepted = generated.filter(function(q) { return q._accepted; });
    if (accepted.length === 0) return;
    var totalNew = 0; accepted.forEach(function(q) { totalNew += q.marks; });
    if (currentMarks + totalNew > totalMarks) { setError('Total marks would exceed limit!'); return; }
    setLoading(true);
    try {
      var payload = accepted.map(function(q) {
        return { exam_id: examId, question_text: q.question_text, question_type: q.question_type, difficulty: q.difficulty, marks: q.marks, correct_answer: q.correct_answer, explanation: q.explanation || '', options: q.options || [] };
      });
      await store.addQuestions(payload);
      setGenerated([]);
      loadSaved(examId);
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  async function handleManualAdd(e) {
    e.preventDefault();
    if (!mText) return;
    setLoading(true);
    try {
      var q = { exam_id: examId, question_text: mText, question_type: mType, difficulty: mDiff, marks: mMarks, correct_answer: mCorrect, explanation: mExplanation };
      if (mType === 'MCQ') { q.options = mOptions.map(function(o) { return { text: o }; }); }
      await store.addQuestions([q]);
      setMText(''); setMOptions(['', '', '', '']); setMCorrect(''); setMExplanation('');
      loadSaved(examId);
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  async function handleRemoveQuestion(qid) {
    await store.removeQuestion(qid);
    loadSaved(examId);
  }

  async function handlePublish() {
    setLoading(true);
    try {
      await store.publishExam(examId);
      localStorage.removeItem(DRAFT_KEY);
      clearCS();
      navigate('exams');
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  function handleAbandon() {
    if (savedQuestions.length === 0) {
      store.deleteExam(examId);
      localStorage.removeItem(DRAFT_KEY);
      clearCS();
    } else {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ exam_id: examId, title: title, total_marks: totalMarks, saved_at: new Date().toISOString() }));
      clearCS(); // session cleared; draft banner handles resume
    }
    setShowAbandon(false);
    navigate('exams');
  }

  function resumeDraft() {
    clearCS();
    setExamId(draftBanner.exam_id);
    setTitle(draftBanner.title);
    setTotalMarks(draftBanner.total_marks);
    setStepRaw(2);
    loadSaved(draftBanner.exam_id);
    setDraftBanner(null);
  }

  function discardDraft() {
    store.deleteExam(draftBanner.exam_id);
    localStorage.removeItem(DRAFT_KEY);
    clearCS();
    setDraftBanner(null);
  }

  var marksLeft = totalMarks - currentMarks;
  var pct = totalMarks > 0 ? Math.round((currentMarks / totalMarks) * 100) : 0;

  return (
    <div className="fade-up">
      {draftBanner && (
        <div style={{ padding: 16, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 12, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--warning)' }}>⚠️ Unfinished exam found</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginTop: 2 }}>"{draftBanner.title}" — {draftBanner.total_marks} marks</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-warning btn-sm" onClick={resumeDraft}>▶ Resume</button>
            <button className="btn btn-outline btn-sm" onClick={discardDraft}>🗑 Discard</button>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">{step === 1 ? '✨ Create New Exam' : '📝 Add Questions'}</div>
        {step === 2 && <button className="btn btn-outline btn-sm" onClick={function() { setShowAbandon(true); }}>← Save as Draft</button>}
      </div>

      {error && <div style={{ padding: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 8, color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 16 }}>{error}</div>}

      {step === 1 && (
        <div className="card" style={{ maxWidth: 640 }}>
          <form onSubmit={handleCreateExam}>
            <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={title} onChange={function(e) { setTitle(e.target.value); }} required /></div>
            <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={description} onChange={function(e) { setDescription(e.target.value); }} /></div>
            <div className="form-group">
              <label className="form-label">Visibility</label>
              <select className="form-select" value={examScope} onChange={function(e){
                setExamScope(e.target.value);
                setCourseId(''); setTargetStudents([]);
              }}>
                <option value="global">🌐 Global — all students</option>
                {courses.map(function(c){ return [
                  <option key={c.course_id + '_all'} value={'course_' + c.course_id}>🏫 {c.name} — all enrolled</option>,
                  <option key={c.course_id + '_sel'} value={'targeted_' + c.course_id}>🎯 {c.name} — selected students only</option>
                ]; })}
              </select>
              <div style={{ fontSize:'0.75rem', color:'var(--text3)', marginTop:4 }}>
                {examScope === 'global' && 'Every registered student can see this exam'}
                {examScope.startsWith('course_') && 'All students enrolled in this course will see it'}
                {examScope.startsWith('targeted_') && 'Only the students you select below will see this exam'}
              </div>
            </div>

            {/* Student selector for targeted exams */}
            {examScope.startsWith('targeted_') && (
              <div className="form-group">
                <label className="form-label">Select Students</label>
                {courseMembers.length === 0
                  ? <div style={{ fontSize:'0.8rem', color:'var(--text3)' }}>Loading enrolled students…</div>
                  : (
                    <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', maxHeight:220, overflowY:'auto' }}>
                      {courseMembers.map(function(m) {
                        var sel = targetStudents.indexOf(m.user_id) > -1;
                        return (
                          <div key={m.user_id} onClick={function(){
                            setTargetStudents(function(p){ return sel ? p.filter(function(x){return x!==m.user_id;}) : p.concat([m.user_id]); });
                          }} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 14px', cursor:'pointer', borderBottom:'1px solid var(--border)', background:sel?'var(--accent-glow)':'transparent' }}>
                            <span style={{ width:16, height:16, borderRadius:4, border:'2px solid '+(sel?'var(--accent)':'var(--border)'), background:sel?'var(--accent)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                              {sel && <span style={{ color:'#fff', fontSize:'0.6rem', fontWeight:900 }}>✓</span>}
                            </span>
                            <span style={{ fontWeight:sel?700:400 }}>{m.name}</span>
                            <span style={{ color:'var(--text3)', fontSize:'0.78rem' }}>{m.email}</span>
                            <span style={{ color:'var(--text3)', fontSize:'0.75rem', marginLeft:'auto' }}>{m.year}</span>
                          </div>
                        );
                      })}
                    </div>
                  )
                }
                {targetStudents.length > 0 && (
                  <div style={{ marginTop:6, fontSize:'0.8rem', color:'var(--accent)', fontWeight:600 }}>
                    ✅ {targetStudents.length} student{targetStudents.length!==1?'s':''} selected
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group"><label className="form-label">Duration (minutes)</label><input className="form-input" type="number" value={duration} onChange={function(e) { setDuration(e.target.value === '' ? '' : Number(e.target.value)); }} min={1} placeholder="60" /></div>
              <div className="form-group"><label className="form-label">Total Marks</label><input className="form-input" type="number" value={totalMarks} onChange={function(e) { setTotalMarks(e.target.value === '' ? '' : Number(e.target.value)); }} min={1} placeholder="100" /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Start Date &amp; Time <span style={{ fontSize:'0.72rem', color:'var(--text3)', fontWeight:400 }}>(students can access from this time)</span></label>
                <input className="form-input" type="datetime-local" value={startTime} onChange={function(e) { setStartTime(e.target.value); }} />
              </div>
              <div className="form-group">
                <label className="form-label">End Date &amp; Time <span style={{ fontSize:'0.72rem', color:'var(--text3)', fontWeight:400 }}>(exam hidden after this time)</span></label>
                <input className="form-input" type="datetime-local" value={endTime} onChange={function(e) { setEndTime(e.target.value); }} />
              </div>
            </div>
            {startTime && endTime && (
              <div style={{ padding:'8px 12px', background:'rgba(124,58,237,.08)', borderRadius:8, fontSize:'0.82rem', color:'var(--accent)', marginBottom:12 }}>
                📅 Exam visible from <strong>{new Date(startTime).toLocaleString()}</strong> to <strong>{new Date(endTime).toLocaleString()}</strong>
              </div>
            )}
            <button className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create & Add Questions →'}</button>
          </form>
        </div>
      )}

      {step === 2 && (
        <div>
          {/* Marks tracker */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 16 }}>
              <div><span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Questions</span><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{savedQuestions.length}</div></div>
              <div><span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Marks Added</span><div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--accent)' }}>{currentMarks} / {totalMarks}</div></div>
              <div><span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Remaining</span><div style={{ fontSize: '1.3rem', fontWeight: 700, color: marksLeft > 0 ? 'var(--warning)' : 'var(--success)' }}>{marksLeft}</div></div>
              <div><span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Status</span><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{currentMarks === totalMarks ? '✅ Ready' : '⏳ In Progress'}</div></div>
            </div>
            <div className="progress-bar" style={{ height: 10 }}><div className="progress-fill" style={{ width: pct + '%', background: currentMarks === totalMarks ? 'var(--success)' : undefined }}></div></div>
          </div>

          {/* Tabs */}
          <div className="tabs">
            <button className={'tab-btn' + (qTab === 'ai' ? ' active' : '')} onClick={function() { setQTab('ai'); }}>🤖 AI Generate</button>
            <button className={'tab-btn' + (qTab === 'manual' ? ' active' : '')} onClick={function() { setQTab('manual'); }}>✍ Manual Add</button>
            <button className={'tab-btn' + (qTab === 'saved' ? ' active' : '')} onClick={function() { setQTab('saved'); }}>💾 Saved ({savedQuestions.length})</button>
          </div>

          {qTab === 'ai' && (
            <div className="card">
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Topic / Notes</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="form-input" value={aiTopic} onChange={function(e) { setAiTopic(e.target.value); }} placeholder="e.g. Data Structures or paste notes" style={{ flex: 1 }}/>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      📄 PDF
                      <input type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={function(e) {
                        var file = e.target.files[0]; if (!file) return;
                        var reader = new FileReader();
                        reader.onload = function(ev) { setAiTopic(function(prev) { return (prev ? prev + '\n' : '') + ev.target.result.slice(0, 2000); }); };
                        reader.readAsText(file); e.target.value = '';
                      }}/>
                    </label>
                  </div>
                </div>
                <div className="form-group"><label className="form-label">Type</label><select className="form-select" value={aiType} onChange={function(e) { setAiType(e.target.value); }}><option>MCQ</option><option>TRUE_FALSE</option><option>SHORT_ANSWER</option><option>DESCRIPTIVE</option></select></div>
                <div className="form-group"><label className="form-label">Difficulty</label><select className="form-select" value={aiDiff} onChange={function(e) { setAiDiff(e.target.value); }}><option>Easy</option><option>Medium</option><option>Hard</option></select></div>
                <div className="form-group"><label className="form-label">Count</label><input className="form-input" type="number" value={aiCount} onChange={function(e) { setAiCount(Number(e.target.value)); }} min={1} max={20} /></div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={handleAIGenerate} disabled={aiLoading || !aiTopic}>{aiLoading ? '🤖 Generating...' : '⚡ Generate Questions'}</button>
                {generated.length > 0 && <button className="btn btn-outline" onClick={rebalanceMarks}>⚖ Rebalance Marks</button>}
              </div>

              {generated.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>Generated Questions ({generated.filter(function(q) { return q._accepted; }).length} accepted)</div>
                  {generated.map(function(q, i) {
                    return (
                      <div key={i} style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, opacity: q._accepted ? 1 : 0.4, background: q._accepted ? 'var(--surface2)' : 'var(--surface3)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span className={'badge badge-' + (q.difficulty === 'Easy' ? 'success' : q.difficulty === 'Hard' ? 'danger' : 'warning')}>{q.difficulty}</span>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input type="number" value={q.marks} onChange={function(e) { var u = generated.slice(); u[i] = Object.assign({}, q, { marks: Number(e.target.value) }); setGenerated(u); }} style={{ width: 60, textAlign: 'center' }} className="form-input" min={1} />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>marks</span>
                            <button className="btn btn-sm btn-ghost" onClick={function() { var u = generated.slice(); u[i] = Object.assign({}, q, { _accepted: !q._accepted }); setGenerated(u); }}>{q._accepted ? '❌ Reject' : '✅ Accept'}</button>
                          </div>
                        </div>
                        <div style={{ fontWeight: 500, marginBottom: 6 }}>{q.question_text}</div>
                        {q.options && <div style={{ marginLeft: 16, fontSize: '0.85rem' }}>{q.options.map(function(o, j) { var t = typeof o === 'string' ? o : o.text; return <div key={j} style={{ padding: '3px 0', color: t === q.correct_answer ? 'var(--success)' : 'var(--text2)' }}>{String.fromCharCode(65 + j)}) {t} {t === q.correct_answer ? '✓' : ''}</div>; })}</div>}
                      </div>
                    );
                  })}
                  <button className="btn btn-success" onClick={saveGeneratedQuestions} disabled={loading}>💾 Save Accepted Questions</button>
                </div>
              )}
            </div>
          )}

          {qTab === 'manual' && (
            <div className="card">
              <form onSubmit={handleManualAdd}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className="form-group"><label className="form-label">Type</label><select className="form-select" value={mType} onChange={function(e) { setMType(e.target.value); }}><option>MCQ</option><option>TRUE_FALSE</option><option>SHORT_ANSWER</option><option>DESCRIPTIVE</option></select></div>
                  <div className="form-group"><label className="form-label">Difficulty</label><select className="form-select" value={mDiff} onChange={function(e) { setMDiff(e.target.value); }}><option>Easy</option><option>Medium</option><option>Hard</option></select></div>
                  <div className="form-group"><label className="form-label">Marks (max {marksLeft})</label><input className="form-input" type="number" value={mMarks} onChange={function(e) { setMMarks(Math.min(Number(e.target.value), marksLeft)); }} min={1} max={marksLeft} /></div>
                </div>
                <div className="form-group"><label className="form-label">Question</label><textarea className="form-textarea" value={mText} onChange={function(e) { setMText(e.target.value); }} required /></div>
                {mType === 'MCQ' && (
                  <div style={{ marginBottom: 16 }}>
                    <label className="form-label">Options</label>
                    {mOptions.map(function(o, i) {
                      return <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{String.fromCharCode(65 + i)})</span>
                        <input className="form-input" value={o} onChange={function(e) { var u = mOptions.slice(); u[i] = e.target.value; setMOptions(u); }} placeholder={'Option ' + String.fromCharCode(65 + i)} />
                        <input type="radio" name="correct" checked={mCorrect === o && o !== ''} onChange={function() { setMCorrect(mOptions[i]); }} />
                      </div>;
                    })}
                  </div>
                )}
                {mType === 'TRUE_FALSE' && (
                  <div className="form-group"><label className="form-label">Correct Answer</label><select className="form-select" value={mCorrect} onChange={function(e) { setMCorrect(e.target.value); }}><option value="">Select</option><option>True</option><option>False</option></select></div>
                )}
                {(mType === 'SHORT_ANSWER' || mType === 'DESCRIPTIVE') && (
                  <div className="form-group"><label className="form-label">Model Answer</label><textarea className="form-textarea" value={mCorrect} onChange={function(e) { setMCorrect(e.target.value); }} /></div>
                )}
                <div className="form-group"><label className="form-label">Explanation</label><textarea className="form-textarea" value={mExplanation} onChange={function(e) { setMExplanation(e.target.value); }} /></div>
                <button className="btn btn-primary" disabled={loading || marksLeft <= 0}>{loading ? 'Adding...' : '+ Add Question'}</button>
              </form>
            </div>
          )}

          {qTab === 'saved' && (
            <div className="card">
              {savedQuestions.length === 0 ? <div className="empty-state"><div className="empty-state-icon">📭</div><div className="empty-state-title">No questions added yet</div></div> :
                savedQuestions.map(function(q, i) {
                  return (
                    <div key={q.question_id} style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                          <span className="badge badge-primary">{q.question_type}</span>
                          <span className={'badge badge-' + (q.difficulty === 'Easy' ? 'success' : q.difficulty === 'Hard' ? 'danger' : 'warning')}>{q.difficulty}</span>
                          <span className="badge badge-info">{q.marks} marks</span>
                        </div>
                        <div style={{ fontWeight: 500 }}>{i + 1}. {q.question_text}</div>
                      </div>
                      <button className="btn btn-danger btn-sm" onClick={function() { handleRemoveQuestion(q.question_id); }}>🗑</button>
                    </div>
                  );
                })
              }
            </div>
          )}

          {currentMarks === totalMarks && (
            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <button className="btn btn-success btn-lg" onClick={handlePublish} disabled={loading}>🚀 Publish Exam</button>
            </div>
          )}
        </div>
      )}

      {showAbandon && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title">⚠️ {savedQuestions.length === 0 ? 'Delete Exam?' : 'Save as Draft?'}</div>
            <div className="modal-body">{savedQuestions.length === 0 ? 'This exam has no questions and will be permanently deleted.' : 'Exam saved as draft. You still need ' + marksLeft + ' more marks.'}</div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={function() { setShowAbandon(false); }}>Cancel</button>
              <button className="btn btn-danger" onClick={handleAbandon}>{savedQuestions.length === 0 ? 'Delete' : 'Save Draft & Exit'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
