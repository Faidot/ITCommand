'use strict';

/**
 * Minimal file + console logger with a `tail` helper used by the admin Logs
 * page. Writes newline-delimited records to logs/app.log.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function write(level, msg, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta ? ' ' + safeJson(meta) : '';
  const line = `${ts} [${level}] ${msg}${metaStr}`;
  fs.appendFile(LOG_FILE, line + '\n', () => {});
  const out = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  out(line);
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

module.exports = {
  info: (msg, meta) => write('INFO', msg, meta),
  warn: (msg, meta) => write('WARN', msg, meta),
  error: (msg, meta) => write('ERROR', msg, meta),

  /** A writable stream adapter for morgan. */
  stream: {
    write: (msg) => write('INFO', msg.trim()),
  },

  /**
   * Return the last `n` log lines, optionally filtered by level
   * (ERROR | WARN | INFO).
   */
  tail(n = 500, level) {
    try {
      const data = fs.readFileSync(LOG_FILE, 'utf-8').trimEnd();
      if (!data) return [];
      let lines = data.split('\n');
      if (level) lines = lines.filter((l) => l.includes(`[${level}]`));
      return lines.slice(-n);
    } catch {
      return [];
    }
  },

  LOG_FILE,
};
