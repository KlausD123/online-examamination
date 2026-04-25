import React, { useState, useEffect } from 'react';
import { useStore } from './store/useStore';
import CoursesPanel from './components/admin/CoursesPanel';
import MyCourses from './components/student/MyCourses';
import AuthPage from './components/AuthPage';
import AdminDashboard from './components/admin/AdminDashboard';
import CreateExam from './components/admin/CreateExam';
import ManageExams from './components/admin/ManageExams';
import StudentsPanel from './components/admin/StudentsPanel';
import Analytics from './components/admin/Analytics';
import Notifications from './components/admin/Notifications';
import VivaRoom from './components/admin/VivaRoom';
import StudentDashboard from './components/student/StudentDashboard';
import AvailableExams from './components/student/AvailableExams';
import MyResults from './components/student/MyResults';
import Leaderboard from './components/student/Leaderboard';
import PracticeZone from './components/student/PracticeZone';
import StudentProfile from './components/student/StudentProfile';
import VivaJoin from './components/student/VivaJoin';
import VivaPractice from './components/student/VivaPractice';

var adminNav = [
  { key: 'dashboard', label: '📊 Dashboard' },
  { key: 'exams',     label: '📝 Exams' },
  { key: 'create',    label: '+ Create' },
  { key: 'courses',   label: '🏫 Courses' },
  { key: 'students',  label: '👥 Students' },
  { key: 'analytics', label: '📈 Analytics' },
  { key: 'announce',  label: '📢 Announce' },
  { key: 'viva',      label: '🎙 Viva Room' }
];

var studentNav = [
  { key: 'dashboard',      label: '🏠 Dashboard' },
  { key: 'exams',          label: '📝 Take Exam' },
  { key: 'mycourses',      label: '🏫 Courses' },
  { key: 'leaderboard',    label: '🏆 Leaderboard' },
  { key: 'results',        label: '📊 My Results' },
  { key: 'practice',       label: '🎯 Practice' },
  { key: 'viva-practice',  label: '🎙 Viva Practice' },
  { key: 'updates',        label: '🔔 Updates' },
  { key: 'viva',           label: '🎙 Viva' },
];

export default function App() {
  var store = useStore();
  var [page, setPageRaw] = useState(function() {
    return sessionStorage.getItem('examai_page') || 'dashboard';
  });
  var [pageData, setPageData] = useState(null);
  var [authChecking, setAuthChecking] = useState(!!localStorage.getItem('examai_token'));

  function setPage(p) {
    sessionStorage.setItem('examai_page', p);
    setPageRaw(p);
  }

  useEffect(function() {
    var token = localStorage.getItem('examai_token');
    if (token) {
      store.loadProfile().then(function(p) {
        if (p) store.setCurrentUser(p);
        setAuthChecking(false);
      }).catch(function() {
        localStorage.removeItem('examai_token');
        setAuthChecking(false);
      });
    }
  }, []); // eslint-disable-line

  function navigate(key, data) { setPage(key); setPageData(data || null); }

  if (authChecking) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #f8f8fc)' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ width: 40, height: 40, margin: '0 auto 16px' }}/>
        <div style={{ fontSize: '0.9rem', color: '#6b7280', fontFamily: 'JetBrains Mono, monospace' }}>Loading…</div>
      </div>
    </div>
  );

  if (!store.currentUser) return React.createElement(AuthPage, null);

  var isAdmin = store.currentUser.role === 'admin';
  var nav     = isAdmin ? adminNav : studentNav;

  function renderPage() {
    if (isAdmin) {
      switch (page) {
        case 'dashboard': return React.createElement(AdminDashboard, { navigate: navigate });
        case 'exams':     return React.createElement(ManageExams,    { navigate: navigate });
        case 'create':    return React.createElement(CreateExam,     { navigate: navigate, editExam: pageData });
        case 'students':  return React.createElement(StudentsPanel,  null);
        case 'analytics': return React.createElement(Analytics,      null);
        case 'announce':  return React.createElement(Notifications,  null);
        case 'viva':      return React.createElement(VivaRoom,       null);
        case 'courses':   return React.createElement(CoursesPanel,   null);
        case 'profile':   return React.createElement(StudentProfile, null);
        default:          return React.createElement(AdminDashboard, { navigate: navigate });
      }
    } else {
      switch (page) {
        case 'dashboard':     return React.createElement(StudentDashboard, { navigate: navigate });
        case 'exams':         return React.createElement(AvailableExams,   { navigate: navigate });
        case 'leaderboard':   return React.createElement(Leaderboard,      null);
        case 'results':       return React.createElement(MyResults,        { navigate: navigate });
        case 'practice':      return React.createElement(PracticeZone,     null);
        case 'viva-practice': return React.createElement(VivaPractice,     null);
        case 'updates':       return React.createElement(Notifications,    null);
        case 'viva':          return React.createElement(VivaJoin,         null);
        case 'mycourses':     return React.createElement(MyCourses,        null);
        case 'profile':       return React.createElement(StudentProfile,   null);
        default:              return React.createElement(StudentDashboard, { navigate: navigate });
      }
    }
  }

  if (store.examLocked) {
    return (
      <div>
        <div className="topbar" style={{ background: 'rgba(220,38,38,0.95)', borderBottom: 'none' }}>
          <span className="topbar-brand" style={{ color: '#fff' }}>🎓 <span>DExam</span></span>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: 600 }}>⚠️ Exam in Progress — Navigation Locked</div>
        </div>
        <div className="main-content">{renderPage()}</div>
      </div>
    );
  }

  // Avatar: real photo or initials
  var avatarUrl = store.currentUser.avatar_url;
  var initials  = (store.currentUser.name || 'U').charAt(0).toUpperCase();

  return (
    <div>
      <div className="topbar">
        <a className="topbar-brand" href="#" onClick={function(e) { e.preventDefault(); navigate('dashboard'); }}>
          🎓 <span>DExam</span>
        </a>
        <div className="topbar-nav">
          {nav.map(function(item) {
            return (
              <button key={item.key} className={page === item.key ? 'active' : ''} onClick={function() { navigate(item.key); }}>
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="topbar-right">
          {/* Clickable profile avatar */}
          <div className="topbar-user" onClick={function() { navigate('profile'); }}
            style={{ cursor: 'pointer', border: page === 'profile' ? '2px solid var(--accent)' : '2px solid transparent', borderRadius: 40, transition: 'var(--transition)' }}
            title="View Profile">
            <div className="topbar-avatar" style={{ overflow: 'hidden' }}>
              {avatarUrl
                ? <img src={avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}/>
                : initials
              }
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{store.currentUser.name}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>{store.currentUser.role}</div>
            </div>
          </div>
          <button className="topbar-logout" onClick={function() { sessionStorage.removeItem('examai_page'); store.logout(); }}>Logout</button>
        </div>
      </div>

      <div className="main-content fade-up">{renderPage()}</div>

      {/* Toast notifications */}
      {store.toasts && store.toasts.length > 0 && (
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, display:'flex', flexDirection:'column', gap:10 }}>
          {store.toasts.map(function(t) {
            var bg = t.type==='error'?'#dc2626':t.type==='success'?'#16a34a':t.type==='warning'?'#d97706':'#2563eb';
            return (
              <div key={t.id} style={{ background:bg, color:'#fff', padding:'12px 18px', borderRadius:10, fontSize:'0.875rem', fontWeight:600, boxShadow:'0 8px 24px rgba(0,0,0,.2)', maxWidth:380, animation:'fadeUp 0.2s ease-out' }}>
                {t.msg}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
