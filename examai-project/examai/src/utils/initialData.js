export const INITIAL_USERS = [
  {
    user_id:       'u1',
    name:          'Admin User',
    email:         'admin@exam.ai',
    password_hash: 'Admin@1234',
    role:          'admin',
    created_at:    new Date().toISOString(),
  },
];

export const INITIAL_STUDENTS = [];
export const INITIAL_ADMINS   = [{ admin_id: 'a1', user_id: 'u1' }];
export const SAMPLE_EXAM      = null;
export const SAMPLE_QUESTIONS = [];
