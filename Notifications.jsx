import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { formatDateTime } from '../../utils/helpers';

export default function Notifications() {
  var store = useStore();
  var [notifications, setNotifications] = useState([]);
  var [loading, setLoading] = useState(true);
  var [title, setTitle] = useState('');
  var [message, setMessage] = useState('');
  var [type, setType] = useState('info');
  var isAdmin = store.currentUser && store.currentUser.role === 'admin';

  useEffect(function() { load(); }, []); // eslint-disable-line

  function load() {
    store.loadNotifications().then(function(d) { setNotifications(d); setLoading(false); });
  }

  async function handleCreate(e) {
    e.preventDefault();
    await store.createNotification({ title: title, message: message, type: type });
    setTitle(''); setMessage('');
    load();
  }

  var typeColors = { info: 'var(--info)', warning: 'var(--warning)', urgent: 'var(--danger)', success: 'var(--success)' };

  if (loading) return <div className="loading-center"><div className="spinner"></div></div>;

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 24 }}>{isAdmin ? '📢 Announcements' : '🔔 Updates'}</div>
      {isAdmin && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-title">Create Announcement</div>
          <form onSubmit={handleCreate} style={{ marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
              <div className="form-group"><input className="form-input" value={title} onChange={function(e) { setTitle(e.target.value); }} placeholder="Title" required /></div>
              <div className="form-group"><select className="form-select" value={type} onChange={function(e) { setType(e.target.value); }}><option value="info">Info</option><option value="warning">Warning</option><option value="urgent">Urgent</option><option value="success">Success</option></select></div>
            </div>
            <div className="form-group"><textarea className="form-textarea" value={message} onChange={function(e) { setMessage(e.target.value); }} placeholder="Message" required /></div>
            <button className="btn btn-primary">📢 Send Announcement</button>
          </form>
        </div>
      )}
      {notifications.length === 0 ? <div className="empty-state"><div className="empty-state-icon">🔕</div><div className="empty-state-title">No notifications</div></div> : (
        <div>
          {notifications.map(function(n) {
            return (
              <div key={n.notification_id} className="card" style={{ marginBottom: 12, borderLeft: '4px solid ' + (typeColors[n.type] || 'var(--border)') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{n.title}</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text2)' }}>{n.message}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: 6 }}>{formatDateTime(n.created_at)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={'badge badge-' + (n.type === 'urgent' ? 'danger' : n.type === 'success' ? 'success' : n.type === 'warning' ? 'warning' : 'info')}>{n.type}</span>
                    {isAdmin && <button className="btn btn-ghost btn-sm" onClick={function() { store.deleteNotification(n.notification_id).then(load); }}>🗑</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
