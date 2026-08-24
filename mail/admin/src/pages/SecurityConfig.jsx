import { useEffect, useState } from 'react';
import adminClient, { extractError } from '../api/adminClient.js';
import ConfigForm from '../components/ConfigForm.jsx';

/**
 * Security configuration page.
 *  - General security settings (session TTL, login attempts, lockout, IP allowlist)
 *  - A separate "Change admin password" form (posts {newPassword}).
 *
 * Both forms hit POST /api/admin/config/security.
 */
export default function SecurityConfig() {
  const [form, setForm] = useState({
    sessionTTL: 3600,
    maxLoginAttempts: 5,
    lockoutDuration: 900,
  });
  // IP whitelist is edited as raw textarea text (one per line) and split on save.
  const [ipWhitelistText, setIpWhitelistText] = useState('');
  const [adminUsername, setAdminUsername] = useState('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Settings form state
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Password form state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMessage, setPwMessage] = useState(null);

  // Load existing security config.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await adminClient.get('/api/admin/config');
        if (cancelled) return;
        const sec = data.security || {};
        setForm((f) => ({
          sessionTTL: sec.sessionTTL ?? f.sessionTTL,
          maxLoginAttempts: sec.maxLoginAttempts ?? f.maxLoginAttempts,
          lockoutDuration: sec.lockoutDuration ?? f.lockoutDuration,
        }));
        setIpWhitelistText(
          Array.isArray(sec.ipWhitelist) ? sec.ipWhitelist.join('\n') : ''
        );
        setAdminUsername(sec.adminUsername || '');
      } catch (err) {
        if (!cancelled) setLoadError(extractError(err, 'Failed to load security config.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Save general security settings.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      // Split textarea into a trimmed, non-empty array.
      const ipWhitelist = ipWhitelistText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const payload = {
        sessionTTL: Number(form.sessionTTL),
        maxLoginAttempts: Number(form.maxLoginAttempts),
        lockoutDuration: Number(form.lockoutDuration),
        ipWhitelist,
      };
      await adminClient.post('/api/admin/config/security', payload);
      setMessage({ type: 'success', text: 'Security settings saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: extractError(err, 'Failed to save.') });
    } finally {
      setSaving(false);
    }
  };

  // Change admin password.
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPwMessage(null);

    if (newPassword.length < 8) {
      setPwMessage({ type: 'error', text: 'Password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setSavingPw(true);
    try {
      await adminClient.post('/api/admin/config/security', { newPassword });
      setPwMessage({ type: 'success', text: 'Admin password updated.' });
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPwMessage({ type: 'error', text: extractError(err, 'Failed to change password.') });
    } finally {
      setSavingPw(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800 dark:text-white">
        Security
      </h2>

      {loadError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {loadError}
        </div>
      )}

      {/* General security settings */}
      <ConfigForm
        title="Access &amp; Session Policy"
        description="Controls sessions, login throttling and IP restrictions."
        onSubmit={handleSubmit}
        saving={saving}
        message={message}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="sec-ttl" className="form-label">
              Session Timeout (s)
            </label>
            <input
              id="sec-ttl"
              type="number"
              className="form-input"
              value={form.sessionTTL}
              onChange={(e) => update('sessionTTL', e.target.value)}
              min={0}
            />
          </div>
          <div>
            <label htmlFor="sec-attempts" className="form-label">
              Max Login Attempts
            </label>
            <input
              id="sec-attempts"
              type="number"
              className="form-input"
              value={form.maxLoginAttempts}
              onChange={(e) => update('maxLoginAttempts', e.target.value)}
              min={1}
            />
          </div>
          <div>
            <label htmlFor="sec-lockout" className="form-label">
              Lockout Duration (s)
            </label>
            <input
              id="sec-lockout"
              type="number"
              className="form-input"
              value={form.lockoutDuration}
              onChange={(e) => update('lockoutDuration', e.target.value)}
              min={0}
            />
          </div>
        </div>

        <div>
          <label htmlFor="sec-ipwhitelist" className="form-label">
            IP Whitelist
          </label>
          <textarea
            id="sec-ipwhitelist"
            className="form-input min-h-[120px] font-mono text-xs"
            placeholder={'One IP or CIDR per line, e.g.\n203.0.113.10\n10.0.0.0/8'}
            value={ipWhitelistText}
            onChange={(e) => setIpWhitelistText(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">
            One entry per line. Leave empty to allow all IPs.
          </p>
        </div>
      </ConfigForm>

      {/* Change admin password */}
      <form
        onSubmit={handlePasswordSubmit}
        className="card max-w-2xl space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Change Admin Password
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {adminUsername ? (
              <>
                Updating password for{' '}
                <span className="font-medium">{adminUsername}</span>.
              </>
            ) : (
              'Set a new admin password.'
            )}
          </p>
        </div>

        {pwMessage && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              pwMessage.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400'
            }`}
          >
            {pwMessage.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sec-newpw" className="form-label">
              New Password
            </label>
            <input
              id="sec-newpw"
              type="password"
              autoComplete="new-password"
              className="form-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="sec-confirmpw" className="form-label">
              Confirm Password
            </label>
            <input
              id="sec-confirmpw"
              type="password"
              autoComplete="new-password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <button type="submit" className="btn-primary" disabled={savingPw}>
            {savingPw ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </form>
    </div>
  );
}
