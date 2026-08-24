import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// Search input that drives IMAP search via the `search` query param.
// Submitting (Enter or the search icon) updates the URL; clearing removes it.
export default function SearchBar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [value, setValue] = useState(searchParams.get('search') || '');
  const inputRef = useRef(null);

  // Keep local input in sync if the URL changes externally (e.g. nav).
  useEffect(() => {
    setValue(searchParams.get('search') || '');
  }, [searchParams]);

  const submit = (e) => {
    e?.preventDefault();
    const next = new URLSearchParams(searchParams);
    const trimmed = value.trim();
    if (trimmed) {
      next.set('search', trimmed);
    } else {
      next.delete('search');
    }
    // Searching resets pagination.
    next.delete('page');
    setSearchParams(next);
  };

  const clear = () => {
    setValue('');
    const next = new URLSearchParams(searchParams);
    next.delete('search');
    next.delete('page');
    setSearchParams(next);
    inputRef.current?.focus();
  };

  return (
    <form
      onSubmit={submit}
      role="search"
      className="flex w-full items-center rounded-xl border border-transparent bg-black/[0.04] px-3.5 transition-colors focus-within:border-primary/30 focus-within:bg-white focus-within:shadow-sm dark:bg-dark-surface dark:focus-within:bg-dark-elevated"
    >
      <button
        type="submit"
        aria-label="Search mail"
        className="text-gray-500 hover:text-primary dark:text-gray-400"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search mail"
        aria-label="Search mail"
        className="w-full bg-transparent px-3 py-2.5 text-sm text-gray-800 placeholder-gray-500 focus:outline-none dark:text-gray-100"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      )}
    </form>
  );
}
