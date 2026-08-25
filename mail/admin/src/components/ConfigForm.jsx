/**
 * ConfigForm — reusable form wrapper for the config pages.
 *
 * It renders a titled card containing arbitrary form fields (passed as
 * children), a Save button, and an optional Test button. Save/Test results are
 * displayed inline as colored messages.
 *
 * Props:
 *  - title:        string                heading text
 *  - description:  string (optional)     subheading text
 *  - onSubmit:     (e) => Promise|void   called on form submit (Save)
 *  - saving:       boolean               disables Save + shows spinner text
 *  - saveLabel:    string (optional)     defaults to "Save"
 *  - message:      { type:'success'|'error', text:string } | null  inline save result
 *
 *  - onTest:       () => void (optional) when present, renders a Test button
 *  - testing:      boolean (optional)    disables Test + shows spinner text
 *  - testLabel:    string (optional)     defaults to "Test"
 *  - testResult:   { ok:boolean, message?:string, error?:string } | null
 *
 *  - children:     form fields
 *  - footerExtra:  ReactNode (optional)  extra controls beside the buttons
 */
export default function ConfigForm({
  title,
  description,
  onSubmit,
  saving = false,
  saveLabel = 'Save',
  message = null,
  onTest,
  testing = false,
  testLabel = 'Test',
  testResult = null,
  children,
  footerExtra = null,
}) {
  return (
    <form onSubmit={onSubmit} className="card max-w-2xl">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>

      {/* Form fields */}
      <div className="space-y-4">{children}</div>

      {/* Inline save message */}
      {message && (
        <div
          className={`mt-4 rounded-md border px-3 py-2 text-sm ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Inline test result */}
      {testResult && (
        <div
          className={`mt-4 rounded-md border px-3 py-2 text-sm ${
            testResult.ok
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400'
          }`}
        >
          {testResult.ok ? '✓ ' : '✗ '}
          {testResult.message || testResult.error || 'No details provided.'}
        </div>
      )}

      {/* Footer actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : saveLabel}
        </button>

        {onTest && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onTest}
            disabled={testing}
          >
            {testing ? 'Testing…' : testLabel}
          </button>
        )}

        {footerExtra}
      </div>
    </form>
  );
}
