export function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(d) {
  if (!d) return '';
  var s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function getGradeColor(g) {
  if (g === 'A') return '#16a34a';
  if (g === 'B') return '#2563eb';
  if (g === 'C') return '#d97706';
  if (g === 'D') return '#ea580c';
  return '#dc2626';
}

export function getExamStatus(exam) {
  var now = new Date();
  if (exam.status === 'draft') return { label: 'DRAFT', color: 'warning' };
  if (exam.scheduled_at && new Date(exam.scheduled_at) > now) return { label: 'UPCOMING', color: 'info' };
  if (exam.end_at && new Date(exam.end_at) < now) return { label: 'EXPIRED', color: 'danger' };
  return { label: 'LIVE NOW', color: 'success' };
}
