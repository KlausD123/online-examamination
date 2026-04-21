import React from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api';

var StoreContext = React.createContext(null);

export function StoreProvider(props) {
  var s = React.useState;
  var currentUser = s(null), setCurrentUser = currentUser[1];
  var currentStudent = s(null), setCurrentStudent = currentStudent[1];
  var exams = s([]), setExams = exams[1];
  var questions = s([]), setQuestions = questions[1];
  var submissions = s([]), setSubmissions = submissions[1];
  var results = s([]), setResults = results[1];
  var students = s([]), setStudents = students[1];
  var notifications = s([]), setNotifications = notifications[1];
  var examLocked = s(false), setExamLocked = examLocked[1];

  async function login(email, password) {
    var data = await apiPost('/auth/login', { email: email, password: password });
    localStorage.setItem('examai_token', data.token);
    setCurrentUser(data.user);
    if (data.user.role === 'student') {
      try { var p = await apiGet('/profile'); setCurrentStudent(p); } catch(e) {}
    }
    return data.user;
  }

  async function register(name, email, password, department, year) {
    await apiPost('/auth/register', { name: name, email: email, password: password, department: department, year: year });
  }

  function logout() {
    localStorage.removeItem('examai_token');
    setCurrentUser(null);
    setCurrentStudent(null);
    setExams([]);
    setQuestions([]);
    setSubmissions([]);
  }

  async function loadProfile() {
    try {
      var p = await apiGet('/profile');
      setCurrentUser(function(prev) { return prev ? Object.assign({}, prev, p) : p; });
      setCurrentStudent(p);
      return p;
    } catch(e) { return null; }
  }

  async function loadExams() { var d = await apiGet('/exams'); setExams(d); return d; }

  async function createExam(data) { var r = await apiPost('/exams', data); return r; }

  async function publishExam(examId) { return await apiPost('/exams/' + examId + '/publish'); }

  async function unpublishExam(examId) { return await apiPost('/exams/' + examId + '/unpublish'); }

  async function deleteExam(examId) { return await apiDelete('/exams/' + examId); }

  async function loadQuestions(examId) { var d = await apiGet('/questions/' + examId); setQuestions(d); return d; }

  async function addQuestions(qs) { return await apiPost('/questions', qs); }

  async function removeQuestion(id) { return await apiDelete('/questions/' + id); }

  async function startExam(examId) { return await apiPost('/submissions/start', { exam_id: examId }); }

  async function submitExam(submissionId, answers, examId, cheated) {
    return await apiPost('/submissions/submit', { submission_id: submissionId, answers: answers, exam_id: examId, cheated: cheated });
  }

  async function loadSubmissions(userId) { var d = await apiGet('/submissions/student/' + userId); setSubmissions(d); return d; }

  async function loadResult(submissionId) { return await apiGet('/submissions/result/' + submissionId); }

  async function loadAnswers(submissionId) { return await apiGet('/submissions/answers/' + submissionId); }

  async function loadLeaderboard(examId) { return await apiGet('/exams/' + examId + '/leaderboard'); }

  async function loadStudents() { var d = await apiGet('/students'); setStudents(d); return d; }

  async function loadNotifications() { var d = await apiGet('/notifications'); setNotifications(d); return d; }

  async function createNotification(data) { return await apiPost('/notifications', data); }

  async function deleteNotification(id) { return await apiDelete('/notifications/' + id); }

  async function loadAnalytics() { return await apiGet('/analytics'); }

  async function updateProfile(data) { return await apiPut('/profile', data); }

  function getStudentSid() {
    return (currentStudent[0] && currentStudent[0].student_id) || (currentUser[0] && currentUser[0].user_id);
  }

  var toasts = s([]), setToasts = toasts[1];

  function addToast(msg, type) {
    var id = Date.now() + Math.random();
    setToasts(function(prev) { return prev.concat([{ id: id, msg: msg, type: type || 'info' }]); });
    setTimeout(function() { setToasts(function(prev) { return prev.filter(function(t) { return t.id !== id; }); }); }, 4000);
  }

  var value = {
    currentUser: currentUser[0], setCurrentUser: setCurrentUser,
    currentStudent: currentStudent[0], setCurrentStudent: setCurrentStudent,
    exams: exams[0], questions: questions[0], submissions: submissions[0],
    results: results[0], students: students[0], notifications: notifications[0],
    examLocked: examLocked[0], setExamLocked: setExamLocked,
    login: login, register: register, logout: logout, loadProfile: loadProfile,
    loadExams: loadExams, createExam: createExam, publishExam: publishExam,
    unpublishExam: unpublishExam, deleteExam: deleteExam,
    loadQuestions: loadQuestions, addQuestions: addQuestions, removeQuestion: removeQuestion,
    startExam: startExam, submitExam: submitExam, loadSubmissions: loadSubmissions,
    loadResult: loadResult, loadAnswers: loadAnswers, loadLeaderboard: loadLeaderboard,
    loadStudents: loadStudents, loadNotifications: loadNotifications,
    createNotification: createNotification, deleteNotification: deleteNotification,
    loadAnalytics: loadAnalytics, updateProfile: updateProfile, getStudentSid: getStudentSid,
    setExams: setExams, setQuestions: setQuestions, setSubmissions: setSubmissions,
    setNotifications: setNotifications,
    toasts: toasts[0], addToast: addToast, setExamLocked: setExamLocked
  };

  return React.createElement(StoreContext.Provider, { value: value }, props.children);
}

export function useStore() { return React.useContext(StoreContext); }
