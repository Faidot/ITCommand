import { useEffect, useState } from 'react';
import adminClient, { extractError } from '../api/adminClient.js';
import ConfigForm from '../components/ConfigForm.jsx';

/**
 * SMTP configuration page.
 * Loads via GET /api/admin/config, saves via POST /api/admin/config/smtp,
 * and can send a test email / probe via POST /api/admin/test/smtp.
 */
export default function SMTPConfig() {
  const [form, setForm] = useState({
    host: '',
    port: 587,
    secure: false,
    requireTLS: true,
    fromName: '',
    fromAddress: '',
  });

  // Optional fields for a real "send test email".
  const [testFields, setTestFields] = useState({
    email: '',
    password: '',
    to: '',
  });

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
        const smtp = data.smtp || {};
        setForm((f) => ({
          host: smtp.host ?? f.host,
          port: smtp.port ?? f.port,
          secure: smtp.secure ?? f.secure,
          requireTLS: smtp.requireTLS ?? f.requireTLS,
          fromName: smtp.fromName ?? f.fromName,
          fromAddress: smtp.fromAddress ?? f.fromAddress,
        }));
      } catch (err) {
        if (!cancelled) setLoadError(extractError(err, 'Failed to load SMTP config.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const payload = {
        host: form.host.trim(),
        port: Number(form.port),
        secure: !!form.secure,
        requireTLS: !!form.requireTLS,
        fromName: form.fromName.trim(),
        fromAddress: form.fromAddress.trim(),
      };
      await adminClient.post('/api/admin/config/smtp', payload);
      setMessage({ type: 'success', text: 'SMTP configuration saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: extractError(err, 'Failed to save.') });
    } finally {
      setSaving(false);
    }
  };

  // Send test email (or reachability probe if fields are blank).
  const handleTest = async () => {
    setTestResult(null);
    setTesting(true);
    try {
      const body = {};
      if (testFields.email && testFields.password && testFields.to) {
        body.email = testFields.email.trim();
        body.password = testFields.password;
        body.to = testFields.to.trim();
      }
      const { data } = await adminClient.post('/api/admin/test/smtp', body);
      setTestResult(data);
    } catch (err) {
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
        SMTP Configuration
      </h2>

      {loadError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {loadError}
        </div>
      )}

      <ConfigForm
        title="Outgoing Mail (SMTP)"
        description="Settings used to send mail from the server."
        onSubmit={handleSubmit}
        saving={saving}
        message={message}
        onTest={handleTest}
        testing={testing}
        testLabel="Send Test Email"
        testResult={testResult}
      >
        <div>
          <label htmlFor="smtp-host" className="form-label">
            Host
          </label>
          <input
            id="smtp-host"
            type="text"
            className="form-input"
            placeholder="smtp.example.com"
            value={form.host}
            onChange={(e) => update('host', e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="smtp-port" className="form-label">
              Port
            </label>
            <input
              id="smtp-port"
              type="number"
              className="form-input"
              value={form.port}
              onChange={(e) => update('port', e.target.value)}
              min={1}
              max={65535}
              required
            />
          </div>

          <div className="flex flex-col justify-end gap-3">
            {/* Secure toggle (implicit TLS, e.g. port 465) */}
            <label className="flex cursor-pointer items-center gap-3">
              <span className="form-label mb-0 w-28">Secure (SSL)</span>
              <button
                type="button"
                role="switch"
                aria-checked={form.secure}
                onClick={() => update('secure', !form.secure)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  form.secure ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    form.secure ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>

            {/* RequireTLS toggle (STARTTLS upgrade required) */}
            <label className="flex cursor-pointer items-center gap-3">
              <span className="form-label mb-0 w-28">Require TLS</span>
              <button
                type="button"
                role="switch"
                aria-checked={form.requireTLS}
                onClick={() => update('requireTLS', !form.requireTLS)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  form.requireTLS ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    form.requireTLS ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="smtp-fromname" className="form-label">
              From Name
            </label>
            <input
              id="smtp-fromname"
              type="text"
              className="form-input"
              placeholder="TeraMailer"
              value={form.fromName}
              onChange={(e) => update('fromName', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="smtp-fromaddr" className="form-label">
              From Address
            </label>
            <input
              id="smtp-fromaddr"
              type="email"
              className="form-input"
              placeholder="no-reply@example.com"
              value={form.fromAddress}
              onChange={(e) => update('fromAddress', e.target.value)}
            />
          </div>
        </div>

        {/* Optional fields for a real send test */}
        <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Send test email (optional)
          </legend>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Provide a mailbox email + password and a recipient to send a real
            test email. Leave blank to only probe host/port reachability.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="smtp-test-email" className="form-label">
                Email
              </label>
              <input
                id="smtp-test-email"
                type="email"
                autoComplete="off"
                className="form-input"
                value={testFields.email}
                onChange={(e) =>
                  setTestFields((c) => ({ ...c, email: e.target.value }))
                }
              />
            </div>
            <div>
              <label htmlFor="smtp-test-pass" className="form-label">
                Password
              </label>
              <input
                id="smtp-test-pass"
                type="password"
                autoComplete="off"
                className="form-input"
                value={testFields.password}
                onChange={(e) =>
                  setTestFields((c) => ({ ...c, password: e.target.value }))
                }
              />
            </div>
            <div>
              <label htmlFor="smtp-test-to" className="form-label">
                Send To
              </label>
              <input
                id="smtp-test-to"
                type="email"
                autoComplete="off"
                className="form-input"
                value={testFields.to}
                onChange={(e) =>
                  setTestFields((c) => ({ ...c, to: e.target.value }))
                }
              />
            </div>
          </div>
        </fieldset>
      </ConfigForm>
    </div>
  );
}
