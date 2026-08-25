import { useEffect, useState } from 'react';
import adminClient, { extractError } from '../api/adminClient.js';
import ConfigForm from '../components/ConfigForm.jsx';

/**
 * IMAP configuration page.
 * Loads current config via GET /api/admin/config, saves via
 * POST /api/admin/config/imap, and can probe connectivity via
 * POST /api/admin/test/imap (optionally with mailbox credentials).
 */
export default function IMAPConfig() {
  const [form, setForm] = useState({
    host: '',
    port: 993,
    tls: true,
    timeout: 30000,
    maxConnections: 10,
  });

  // Optional mailbox credentials for a real auth test.
  const [testCreds, setTestCreds] = useState({ email: '', password: '' });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Load existing configuration.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await adminClient.get('/api/admin/config');
        if (cancelled) return;
        const imap = data.imap || {};
        setForm((f) => ({
          host: imap.host ?? f.host,
          port: imap.port ?? f.port,
          tls: imap.tls ?? f.tls,
          timeout: imap.timeout ?? f.timeout,
          maxConnections: imap.maxConnections ?? f.maxConnections,
        }));
      } catch (err) {
        if (!cancelled) setLoadError(extractError(err, 'Failed to load IMAP config.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Save handler.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const payload = {
        host: form.host.trim(),
        port: Number(form.port),
        tls: !!form.tls,
        timeout: Number(form.timeout),
        maxConnections: Number(form.maxConnections),
      };
      await adminClient.post('/api/admin/config/imap', payload);
      setMessage({ type: 'success', text: 'IMAP configuration saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: extractError(err, 'Failed to save.') });
    } finally {
      setSaving(false);
    }
  };

  // Test connection. Test endpoints always return HTTP 200 with {ok,...}.
  const handleTest = async () => {
    setTestResult(null);
    setTesting(true);
    try {
      const body = {};
      if (testCreds.email && testCreds.password) {
        body.email = testCreds.email.trim();
        body.password = testCreds.password;
      }
      const { data } = await adminClient.post('/api/admin/test/imap', body);
      setTestResult(data);
    } catch (err) {
      // Network / unexpected error (test endpoints normally return 200).
      setTestResult({ ok: false, error: extractError(err, 'Test request failed.') });
    } finally {
      setTesting(false);
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
        IMAP Configuration
      </h2>

      {loadError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {loadError}
        </div>
      )}

      <ConfigForm
        title="Incoming Mail (IMAP)"
        description="Settings used to connect to the IMAP server."
        onSubmit={handleSubmit}
        saving={saving}
        message={message}
        onTest={handleTest}
        testing={testing}
        testLabel="Test Connection"
        testResult={testResult}
      >
        <div>
          <label htmlFor="imap-host" className="form-label">
            Host
          </label>
          <input
            id="imap-host"
            type="text"
            className="form-input"
            placeholder="imap.example.com"
            value={form.host}
            onChange={(e) => update('host', e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="imap-port" className="form-label">
              Port
            </label>
            <input
              id="imap-port"
              type="number"
              className="form-input"
              value={form.port}
              onChange={(e) => update('port', e.target.value)}
              min={1}
              max={65535}
              required
            />
          </div>

          <div className="flex items-end">
            {/* TLS toggle */}
            <label className="flex cursor-pointer items-center gap-3">
              <span className="form-label mb-0">Use TLS</span>
              <button
                type="button"
                role="switch"
                aria-checked={form.tls}
                onClick={() => update('tls', !form.tls)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  form.tls ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    form.tls ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="imap-timeout" className="form-label">
              Timeout (ms)
            </label>
            <input
              id="imap-timeout"
              type="number"
              className="form-input"
              value={form.timeout}
              onChange={(e) => update('timeout', e.target.value)}
              min={0}
            />
          </div>
          <div>
            <label htmlFor="imap-maxconn" className="form-label">
              Max Connections
            </label>
            <input
              id="imap-maxconn"
              type="number"
              className="form-input"
              value={form.maxConnections}
              onChange={(e) => update('maxConnections', e.target.value)}
              min={1}
            />
          </div>
        </div>

        {/* Optional creds for a real auth test */}
        <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Test credentials (optional)
          </legend>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Provide a mailbox email and password to perform a real IMAP login.
            Leave blank to only probe host/port reachability.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="imap-test-email" className="form-label">
                Email
              </label>
              <input
                id="imap-test-email"
                type="email"
                autoComplete="off"
                className="form-input"
                value={testCreds.email}
                onChange={(e) =>
                  setTestCreds((c) => ({ ...c, email: e.target.value }))
                }
              />
            </div>
            <div>
              <label htmlFor="imap-test-pass" className="form-label">
                Password
              </label>
              <input
                id="imap-test-pass"
                type="password"
                autoComplete="off"
                className="form-input"
                value={testCreds.password}
                onChange={(e) =>
                  setTestCreds((c) => ({ ...c, password: e.target.value }))
                }
              />
            </div>
          </div>
        </fieldset>
      </ConfigForm>
    </div>
  );
}
