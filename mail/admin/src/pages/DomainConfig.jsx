import { useEffect, useState } from 'react';
import adminClient, { extractError } from '../api/adminClient.js';
import ConfigForm from '../components/ConfigForm.jsx';

/**
 * Domain & branding configuration.
 * allowedDomains is edited via a chip/tag input and submitted as an array.
 */
export default function DomainConfig() {
  const [form, setForm] = useState({
    name: '',
    domain: '',
    logo: '',
    maxUploadMb: 25,
  });
  const [allowedDomains, setAllowedDomains] = useState([]);
  const [domainInput, setDomainInput] = useState('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Load existing app config.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await adminClient.get('/api/admin/config');
        if (cancelled) return;
        const app = data.app || {};
        setForm((f) => ({
          name: app.name ?? f.name,
          domain: app.domain ?? f.domain,
          logo: app.logo ?? f.logo,
          maxUploadMb: app.maxUploadMb ?? f.maxUploadMb,
        }));
        setAllowedDomains(Array.isArray(app.allowedDomains) ? app.allowedDomains : []);
      } catch (err) {
        if (!cancelled) setLoadError(extractError(err, 'Failed to load domain config.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Add a domain chip (dedup + trim). Triggered on Enter or comma.
  const addDomain = () => {
    const value = domainInput.trim().replace(/,$/, '').toLowerCase();
    if (!value) return;
    setAllowedDomains((list) =>
      list.includes(value) ? list : [...list, value]
    );
    setDomainInput('');
  };

  const removeDomain = (value) => {
    setAllowedDomains((list) => list.filter((d) => d !== value));
  };

  const handleDomainKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addDomain();
    } else if (e.key === 'Backspace' && !domainInput && allowedDomains.length) {
      // Quick-delete last chip when input is empty.
      setAllowedDomains((list) => list.slice(0, -1));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      // Fold any pending text into the array before submitting.
      const pending = domainInput.trim().replace(/,$/, '').toLowerCase();
      const finalDomains =
        pending && !allowedDomains.includes(pending)
          ? [...allowedDomains, pending]
          : allowedDomains;
      setAllowedDomains(finalDomains);
      setDomainInput('');

      const payload = {
        name: form.name.trim(),
        domain: form.domain.trim(),
        logo: form.logo.trim(),
        maxUploadMb: Number(form.maxUploadMb),
        allowedDomains: finalDomains,
      };
      await adminClient.post('/api/admin/config/domain', payload);
      setMessage({ type: 'success', text: 'Domain & branding saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: extractError(err, 'Failed to save.') });
    } finally {
      setSaving(false);
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
        Domain &amp; Branding
      </h2>

      {loadError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {loadError}
        </div>
      )}

      <ConfigForm
        title="Application Settings"
        description="Branding and domain restrictions for the webmail app."
        onSubmit={handleSubmit}
        saving={saving}
        message={message}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="app-name" className="form-label">
              App Name
            </label>
            <input
              id="app-name"
              type="text"
              className="form-input"
              placeholder="TeraMailer"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="app-domain" className="form-label">
              Primary Domain
            </label>
            <input
              id="app-domain"
              type="text"
              className="form-input"
              placeholder="mail.example.com"
              value={form.domain}
              onChange={(e) => update('domain', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="app-logo" className="form-label">
            Logo URL
          </label>
          <input
            id="app-logo"
            type="url"
            className="form-input"
            placeholder="https://example.com/logo.png"
            value={form.logo}
            onChange={(e) => update('logo', e.target.value)}
          />
          {form.logo && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-slate-400">Preview:</span>
              {/* Fallback gracefully if the URL is broken */}
              <img
                src={form.logo}
                alt="Logo preview"
                className="h-8 max-w-[160px] object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          )}
        </div>

        {/* Allowed domains tag input */}
        <div>
          <label htmlFor="app-alloweddomains" className="form-label">
            Allowed Domains
          </label>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-white p-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200 dark:border-slate-600 dark:bg-slate-800">
            {allowedDomains.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
              >
                {d}
                <button
                  type="button"
                  onClick={() => removeDomain(d)}
                  className="text-brand-600 hover:text-brand-900 dark:text-brand-300"
                  aria-label={`Remove ${d}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              id="app-alloweddomains"
              type="text"
              className="min-w-[140px] flex-1 border-0 bg-transparent p-1 text-sm text-slate-900 outline-none dark:text-slate-100"
              placeholder={
                allowedDomains.length ? 'Add another…' : 'example.com'
              }
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              onKeyDown={handleDomainKeyDown}
              onBlur={addDomain}
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Press Enter or comma to add. Only users at these domains may sign in.
          </p>
        </div>

        <div className="sm:max-w-xs">
          <label htmlFor="app-maxupload" className="form-label">
            Max Upload Size (MB)
          </label>
          <input
            id="app-maxupload"
            type="number"
            className="form-input"
            value={form.maxUploadMb}
            onChange={(e) => update('maxUploadMb', e.target.value)}
            min={1}
          />
        </div>
      </ConfigForm>
    </div>
  );
}
