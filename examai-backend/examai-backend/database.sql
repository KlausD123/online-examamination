SET FOREIGN_KEY_CHECKS = 0;
-- Railway MySQL: database is already created and selected automatically
-- DO NOT change the database name here

CREATE TABLE IF NOT EXISTS users (
  user_id    INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  email      VARCHAR(255) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,        -- bcrypt OR plain text (auto-upgraded on login)
  role       ENUM('admin','student') DEFAULT 'student',
  avatar_url TEXT NULL,
  bio        TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
  student_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNIQUE NOT NULL,
  department VARCHAR(255) DEFAULT '',
  year       VARCHAR(50) DEFAULT '1st Year',
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS exams (
  exam_id          INT AUTO_INCREMENT PRIMARY KEY,
  title            VARCHAR(255) NOT NULL,
  description      TEXT,
  duration_minutes INT DEFAULT 60,
  total_marks      INT DEFAULT 100,
  status           ENUM('draft','published','archived') DEFAULT 'draft',
  scheduled_at     DATETIME NULL,
  end_at           DATETIME NULL,
  created_by       INT NOT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  course_id        INT NULL,
  exam_type        ENUM('global','course_global','targeted') DEFAULT 'global',
  FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS questions (
  question_id    INT AUTO_INCREMENT PRIMARY KEY,
  exam_id        INT NOT NULL,
  question_text  TEXT NOT NULL,
  question_type  ENUM('MCQ','TRUE_FALSE','SHORT_ANSWER','DESCRIPTIVE') DEFAULT 'MCQ',
  difficulty     ENUM('Easy','Medium','Hard') DEFAULT 'Medium',
  marks          INT DEFAULT 10,
  correct_answer VARCHAR(255) DEFAULT '',
  explanation    TEXT NULL,
  question_order INT DEFAULT 0,
  FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS options (
  option_id    INT AUTO_INCREMENT PRIMARY KEY,
  question_id  INT NOT NULL,
  text         TEXT NOT NULL,
  option_order INT DEFAULT 0,
  FOREIGN KEY (question_id) REFERENCES questions(question_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS submissions (
  submission_id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id       INT NOT NULL,
  student_id    INT NOT NULL,
  status        ENUM('in_progress','submitted','cheated') DEFAULT 'in_progress',
  start_time    DATETIME NULL,
  submit_time   DATETIME NULL,
  FOREIGN KEY (exam_id)    REFERENCES exams(exam_id),
  FOREIGN KEY (student_id) REFERENCES users(user_id),
  UNIQUE KEY unique_attempt (exam_id, student_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS answers (
  answer_id     INT AUTO_INCREMENT PRIMARY KEY,
  submission_id INT NOT NULL,
  question_id   INT NOT NULL,
  answer_text   TEXT,
  FOREIGN KEY (submission_id) REFERENCES submissions(submission_id) ON DELETE CASCADE,
  FOREIGN KEY (question_id)   REFERENCES questions(question_id),
  UNIQUE KEY unique_answer (submission_id, question_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS results (
  result_id         INT AUTO_INCREMENT PRIMARY KEY,
  submission_id     INT UNIQUE NOT NULL,
  total_score       DECIMAL(8,2) DEFAULT 0,
  grade             VARCHAR(3) DEFAULT 'F',
  cheating_detected TINYINT(1) DEFAULT 0,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_id) REFERENCES submissions(submission_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  message         TEXT NOT NULL,
  type            ENUM('info','warning','urgent','success') DEFAULT 'info',
  admin_id        INT NULL,
  recipient_id    INT NULL,        -- NULL = global, set = targeted to specific student
  viva_room_id    VARCHAR(36) NULL,
  expires_at      DATETIME NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS viva_sessions (
  viva_id         VARCHAR(36) PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  topic           VARCHAR(255) DEFAULT '',
  questions       JSON NOT NULL,
  questions_count INT DEFAULT 0,
  created_by      INT NOT NULL,
  status          VARCHAR(20) DEFAULT 'active',
  ended_at        DATETIME NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS viva_results (
  result_id       INT AUTO_INCREMENT PRIMARY KEY,
  viva_id         VARCHAR(36) NOT NULL,
  student_id      INT NULL,
  student_name    VARCHAR(255) NULL,
  total_score     DECIMAL(5,2) DEFAULT 0,
  grade           VARCHAR(3) DEFAULT 'F',
  full_transcript TEXT NULL,
  ai_report       JSON NULL,
  correct_count   INT DEFAULT 0,
  total_questions INT DEFAULT 0,
  result_visible  TINYINT(1) DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (viva_id) REFERENCES viva_sessions(viva_id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- Default admin (password = Admin@123)
INSERT IGNORE INTO users (name, email, password, role)
VALUES ('Admin', 'admin@dexam.com', '$2b$10$8K1p/a0dL1LXMIgoEDFrwOfMQsZzTTWnekvHjbH9kA1.I7k7N7hG6', 'admin');







-- ── Course Rooms ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  course_id   INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  join_code   VARCHAR(12) UNIQUE NOT NULL,
  course_type ENUM('global','private') DEFAULT 'private',
  created_by  INT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS course_members (
  member_id  INT AUTO_INCREMENT PRIMARY KEY,
  course_id  INT NOT NULL,
  student_id INT NOT NULL,
  joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_member (course_id, student_id),
  FOREIGN KEY (course_id)  REFERENCES courses(course_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(user_id)     ON DELETE CASCADE
) ENGINE=InnoDB;




-- ── Targeted exam assignments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_assignments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  exam_id    INT NOT NULL,
  student_id INT NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_assign (exam_id, student_id),
  FOREIGN KEY (exam_id)    REFERENCES exams(exam_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;


