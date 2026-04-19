import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { formatDateTime, getExamStatus } from '../../utils/helpers';

export default function ManageExams({ navigate }) {
  var store = useStore();
  var [exams, setExams] = useState([]);
  var [loading, setLoading] = useState(true);
  var [qModal, setQModal] = useState(null);
  var [qList, setQList] = useState([]);
  var [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(function() { loadData(); }, []); // eslint-disable-line

  function loadData() {
    setLoading(true);
    store.loadExams().then(function(d) { setExams(d); setLoading(false); }).catch(function() { setLoading(false); });
  }

  async function handlePublish(id) {
    try { await store.publishExam(id); loadData(); } catch (e) { alert(e.message); }
  }
  async function handleUnpublish(id) {
    try { await store.unpublishExam(id); loadData(); } catch (e) { alert(e.message); }
  }
  async function handleDelete(id) {
    try { await store.deleteExam(id); setConfirmDelete(null); loadData(); } catch (e) { alert(e.message); }
  }
  async function showQuestions(exam) {
    var qs = await store.loadQuestions(exam.exam_id);
    setQList(qs); setQModal(exam);
  }

  if (loading) return <div className="loading-center"><div className="spinner"></div></div>;

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="page-title">📝 Manage Exams</div>
        <button className="btn btn-primary" onClick={function() { navigate('create'); }}>+ Create New</button>
      </div>
      {exams.length === 0 ? <div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-title">No exams yet</div></div> : (
        <div className="grid-2">
          {exams.map(function(exam) {
            var st = getExamStatus(exam);
            var isPublished = exam.status === 'published';
            return (
              <div key={exam.exam_id} className="card" style={{ borderTop: '3px solid ' + (isPublished ? 'var(--success)' : 'var(--warning)'), position: 'relative' }}>
                {exam.question_count === 0 && <div style={{ position: 'absolute', top: 12, right: 12 }}><span className="badge badge-danger">⚠ No Questions</span></div>}
                <div className="card-title">{exam.title}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginBottom: 12 }}>{exam.description}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span className={'badge badge-' + st.color}>{st.label}</span>
                  <span className="badge badge-info">{exam.question_count} questions</span>
                  <span className="badge badge-primary">{exam.total_marks} marks</span>
                  {exam.submission_count > 0 && <span className="badge badge-success">{exam.submission_count} submissions</span>}
                </div>
                {exam.scheduled_at && <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>📅 {formatDateTime(exam.scheduled_at)} — {formatDateTime(exam.end_at)}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  {!isPublished ? <button className="btn btn-success btn-sm" onClick={function() { handlePublish(exam.exam_id); }} disabled={exam.question_count === 0}>🚀 Publish</button> : <button className="btn btn-outline btn-sm" onClick={function() { handleUnpublish(exam.exam_id); }}>⏸ Unpublish</button>}
                  <button className="btn btn-outline btn-sm" onClick={function() { showQuestions(exam); }}>👁 Questions</button>
                  <button className="btn btn-outline btn-sm" onClick={function() { navigate('create', exam); }}>✏ Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={function() { setConfirmDelete(exam); }}>🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {qModal && (
        <div className="modal-overlay" onClick={function() { setQModal(null); }}>
          <div className="modal-content" style={{ maxWidth: 700, maxHeight: '80vh', overflow: 'auto' }} onClick={function(e) { e.stopPropagation(); }}>
            <div className="modal-title">📝 {qModal.title} — Questions</div>
            {qList.map(function(q, i) {
              return (
                <div key={q.question_id} style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <span className="badge badge-primary">{q.question_type}</span>
                    <span className="badge badge-info">{q.marks}m</span>
                  </div>
                  <div style={{ fontWeight: 500 }}>{i + 1}. {q.question_text}</div>
                  {q.options && q.options.length > 0 && <div style={{ marginLeft: 16, marginTop: 6, fontSize: '0.85rem' }}>{q.options.map(function(o, j) { var t = o.text || o; return <div key={j} style={{ color: t === q.correct_answer ? 'var(--success)' : 'var(--text2)', fontWeight: t === q.correct_answer ? 600 : 400 }}>{String.fromCharCode(65 + j)}) {t} {t === q.correct_answer ? ' ✓' : ''}</div>; })}</div>}
                  {q.correct_answer && <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--success)' }}>✅ {q.correct_answer}</div>}
                </div>
              );
            })}
            <button className="btn btn-outline" onClick={function() { setQModal(null); }}>Close</button>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="modal-overlay"><div className="modal-content">
          <div className="modal-title">🗑 Delete Exam?</div>
          <div className="modal-body">Are you sure you want to delete "{confirmDelete.title}"? This action cannot be undone.</div>
          <div className="modal-actions"><button className="btn btn-outline" onClick={function() { setConfirmDelete(null); }}>Cancel</button><button className="btn btn-danger" onClick={function() { handleDelete(confirmDelete.exam_id); }}>Delete</button></div>
        </div></div>
      )}
    </div>
  );
}
