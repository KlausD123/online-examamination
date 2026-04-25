import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { formatDateTime, getExamStatus } from '../../utils/helpers';

var API = 'https://online-examamination-production.up.railway.app/api';
function getToken() { return localStorage.getItem('examai_token'); }

export default function ManageExams({ navigate }) {
  var store = useStore();
  var [exams,         setExams]         = useState([]);
  var [loading,       setLoading]       = useState(true);
  var [qModal,        setQModal]        = useState(null);
  var [qList,         setQList]         = useState([]);
  var [confirmDelete, setConfirmDelete] = useState(null);
  var [exporting,     setExporting]     = useState({}); // exam_id -> true/false
  var [exportErr,     setExportErr]     = useState({}); // exam_id -> error msg

  useEffect(function() { loadData(); }, []); // eslint-disable-line

  function loadData() {
    setLoading(true);
    store.loadExams().then(function(d) { setExams(d); setLoading(false); }).catch(function() { setLoading(false); });
  }

  async function handlePublish(id) {
    try { await store.publishExam(id); loadData(); } catch(e) { alert(e.message); }
  }
  async function handleUnpublish(id) {
    try { await store.unpublishExam(id); loadData(); } catch(e) { alert(e.message); }
  }
  async function handleDelete(id) {
    try { await store.deleteExam(id); setConfirmDelete(null); loadData(); } catch(e) { alert(e.message); }
  }
  async function showQuestions(exam) {
    var qs = await store.loadQuestions(exam.exam_id);
    setQList(qs); setQModal(exam);
  }

  // ── CSV export ────────────────────────────────────────────
  async function handleExportCSV(exam) {
    var id = exam.exam_id;
    if (exam.submission_count === 0) {
      setExportErr(function(prev) { return Object.assign({}, prev, { [id]: 'No submissions yet — nothing to export' }); });
      setTimeout(function() { setExportErr(function(p) { return Object.assign({}, p, { [id]: '' }); }); }, 3500);
      return;
    }
    setExporting(function(prev) { return Object.assign({}, prev, { [id]: true }); });
    setExportErr(function(prev) { return Object.assign({}, prev, { [id]: '' }); });
    try {
      var resp = await fetch(API + '/exams/' + id + '/export-csv', {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      if (!resp.ok) {
        var errData = await resp.json().catch(function() { return {}; });
        throw new Error(errData.error || 'Export failed');
      }
      // Get filename from Content-Disposition header
      var disp     = resp.headers.get('Content-Disposition') || '';
      var match    = disp.match(/filename="(.+?)"/);
      var filename = match ? match[1] : exam.title.replace(/[^a-z0-9]/gi,'_').toLowerCase() + '_results.csv';

      // Download the blob
      var blob = await resp.blob();
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href   = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(e) {
      setExportErr(function(prev) { return Object.assign({}, prev, { [id]: e.message }); });
      setTimeout(function() { setExportErr(function(p) { return Object.assign({}, p, { [id]: '' }); }); }, 4000);
    }
    setExporting(function(prev) { return Object.assign({}, prev, { [id]: false }); });
  }

  if (loading) return <div className="loading-center"><div className="spinner"></div></div>;

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="page-title">📝 Manage Exams</div>
        <button className="btn btn-primary" onClick={function() { navigate('create'); }}>+ Create New</button>
      </div>

      {exams.length === 0
        ? <div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-title">No exams yet</div></div>
        : (
          <div className="grid-2">
            {exams.map(function(exam) {
              var st          = getExamStatus(exam);
              var isPublished = exam.status === 'published';
              var isExp       = exporting[exam.exam_id];
              var expErr      = exportErr[exam.exam_id];

              return (
                <div key={exam.exam_id} className="card"
                  style={{ borderTop:'3px solid '+(isPublished?'var(--success)':'var(--warning)'), position:'relative' }}>

                  {exam.question_count === 0 && (
                    <div style={{ position:'absolute', top:12, right:12 }}>
                      <span className="badge badge-danger">⚠ No Questions</span>
                    </div>
                  )}

                  <div className="card-title">{exam.title}</div>
                  {exam.description && (
                    <div style={{ fontSize:'0.8rem', color:'var(--text3)', marginBottom:12 }}>{exam.description}</div>
                  )}

                  {/* Badges */}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
                    <span className={'badge badge-'+st.color}>{st.label}</span>
                    <span className="badge badge-info">{exam.question_count} questions</span>
                    <span className="badge badge-primary">{exam.total_marks} marks</span>
                    <span className="badge badge-info">⏱ {exam.duration_minutes} min</span>
                    {exam.submission_count > 0 && (
                      <span className="badge badge-success">{exam.submission_count} submissions</span>
                    )}
                  </div>

                  {exam.scheduled_at && (
                    <div style={{ fontSize:'0.78rem', color:'var(--text3)', marginBottom:8 }}>
                      📅 {formatDateTime(exam.scheduled_at)} — {formatDateTime(exam.end_at)}
                    </div>
                  )}

                  {/* Export error */}
                  {expErr && (
                    <div style={{ padding:'6px 10px', background:'rgba(220,38,38,.08)', border:'1px solid rgba(220,38,38,.2)', borderRadius:6, fontSize:'0.78rem', color:'var(--danger)', marginBottom:10 }}>
                      ⚠ {expErr}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap' }}>
                    {/* Publish / Unpublish */}
                    {!isPublished
                      ? <button className="btn btn-success btn-sm" onClick={function(){ handlePublish(exam.exam_id); }} disabled={exam.question_count === 0}>🚀 Publish</button>
                      : <button className="btn btn-outline btn-sm" onClick={function(){ handleUnpublish(exam.exam_id); }}>⏸ Unpublish</button>
                    }

                    {/* Questions preview */}
                    <button className="btn btn-outline btn-sm" onClick={function(){ showQuestions(exam); }}>👁 Questions</button>

                    {/* Edit */}
                    <button className="btn btn-outline btn-sm" onClick={function(){ navigate('create', exam); }}>✏ Edit</button>

                    {/* CSV Export */}
                    <button
                      className="btn btn-sm"
                      style={{
                        background: exam.submission_count > 0 ? 'rgba(22,163,74,.1)' : 'var(--surface3)',
                        color:      exam.submission_count > 0 ? 'var(--success)' : 'var(--text3)',
                        border:     '1px solid ' + (exam.submission_count > 0 ? 'rgba(22,163,74,.3)' : 'var(--border)'),
                        fontWeight: 600,
                        cursor:     isExp ? 'wait' : 'pointer',
                      }}
                      onClick={function(){ handleExportCSV(exam); }}
                      disabled={isExp}
                      title={exam.submission_count === 0 ? 'No submissions to export' : 'Download results as CSV'}
                    >
                      {isExp
                        ? <><div className="spinner" style={{width:12,height:12}}/> Exporting…</>
                        : '📥 Export CSV'
                      }
                    </button>

                    {/* Delete */}
                    <button className="btn btn-danger btn-sm" onClick={function(){ setConfirmDelete(exam); }}>🗑</button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      }

      {/* ── Questions modal ── */}
      {qModal && (
        <div className="modal-overlay" onClick={function(){ setQModal(null); }}>
          <div className="modal-content" style={{ maxWidth:700, maxHeight:'80vh', overflow:'auto' }} onClick={function(e){ e.stopPropagation(); }}>
            <div className="modal-title">📝 {qModal.title} — Questions</div>
            {qList.map(function(q, i) {
              return (
                <div key={q.question_id} style={{ padding:14, border:'1px solid var(--border)', borderRadius:8, marginBottom:10 }}>
                  <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                    <span className="badge badge-primary">{q.question_type}</span>
                    <span className="badge badge-info">{q.marks}m</span>
                  </div>
                  <div style={{ fontWeight:500 }}>{i+1}. {q.question_text}</div>
                  {q.options && q.options.length > 0 && (
                    <div style={{ marginLeft:16, marginTop:6, fontSize:'0.85rem' }}>
                      {q.options.map(function(o, j) {
                        var t = o.text || o;
                        var isCorrect = t === q.correct_answer;
                        return (
                          <div key={j} style={{ color:isCorrect?'var(--success)':'var(--text2)', fontWeight:isCorrect?600:400 }}>
                            {String.fromCharCode(65+j)}) {t} {isCorrect?' ✓':''}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {q.correct_answer && (
                    <div style={{ marginTop:6, fontSize:'0.8rem', color:'var(--success)' }}>✅ {q.correct_answer}</div>
                  )}
                </div>
              );
            })}
            <button className="btn btn-outline" onClick={function(){ setQModal(null); }}>Close</button>
          </div>
        </div>
      )}

      {/* ── Delete confirm modal ── */}
      {confirmDelete && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title">🗑 Delete Exam?</div>
            <div className="modal-body">Are you sure you want to delete <strong>"{confirmDelete.title}"</strong>? This action cannot be undone.</div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={function(){ setConfirmDelete(null); }}>Cancel</button>
              <button className="btn btn-danger" onClick={function(){ handleDelete(confirmDelete.exam_id); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
