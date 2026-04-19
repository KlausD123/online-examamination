import { useState } from 'react';
import ChangePassword from './ChangePassword';

const Sidebar = ({ user, activePage, setActivePage, logout, examLocked, store }) => {
  const [showChangePwd, setShowChangePwd] = useState(false);
  const isAdmin = user.role === 'admin';

  const adminNav = [
    { key: 'dashboard',    icon: '◈', label: 'Dashboard'    },
    { key: 'exams',        icon: '📋', label: 'Manage Exams' },
    { key: 'create-exam',  icon: '＋', label: 'Create Exam'  },
    { key: 'students',     icon: '👥', label: 'Students'     },
    { key: 'analytics',    icon: '📊', label: 'Analytics'    },
  ];

  const studentNav = [
    { key: 'dashboard',       icon: '◈', label: 'Dashboard'      },
    { key: 'available-exams', icon: '📋', label: 'Available Exams' },
    { key: 'my-results',      icon: '🏆', label: 'My Results'      },
  ];

  const nav = isAdmin ? adminNav : studentNav;

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        Exam<span>AI</span>
        <sub>EXAMINATION PLATFORM</sub>
      </div>

      <nav className="sidebar-nav">
        {examLocked && (
          <div style={{ margin: '12px 12px 8px', padding: '10px 12px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 700, marginBottom: 2 }}>🔒 EXAM IN PROGRESS</div>
            <div style={{ fontSize: 10, color: 'var(--danger)', opacity: 0.8 }}>Submit exam to unlock navigation</div>
          </div>
        )}
        <div className="nav-section">{isAdmin ? 'Admin' : 'Student'}</div>
        {nav.map(item => (
          <div
            key={item.key}
            className={`nav-item ${activePage === item.key ? 'active' : ''} ${examLocked && item.key !== 'available-exams' ? 'locked' : ''}`}
            onClick={() => setActivePage(item.key)}
            style={{ opacity: examLocked && item.key !== 'available-exams' ? 0.4 : 1, cursor: examLocked && item.key !== 'available-exams' ? 'not-allowed' : 'pointer' }}
          >
            <span className="nav-icon">{examLocked && item.key !== 'available-exams' ? '🔒' : item.icon}</span>
            {item.label}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-badge">
          <div className="user-avatar">{user.name.charAt(0)}</div>
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-role">{user.role}</div>
          </div>
          {!examLocked && (
            <div style={{ display:'flex', gap:4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowChangePwd(true)} title="Change Password" style={{ padding:'4px 8px' }}>🔒</button>
              <button className="btn btn-ghost btn-sm" onClick={logout} title="Logout" style={{ padding:'4px 8px' }}>⏏</button>
            </div>
          )}
        </div>
      </div>

      {showChangePwd && <ChangePassword store={store} onClose={() => setShowChangePwd(false)} />}
    </div>
  );
};

export default Sidebar;
