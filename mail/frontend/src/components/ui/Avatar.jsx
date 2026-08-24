// Circular avatar showing initials derived from a name or email address.
// The background color is deterministically derived from the source string so
// the same sender always gets the same color (Gmail-like).

const COLORS = [
  '#1a73e8', // blue
  '#d93025', // red
  '#188038', // green
  '#e37400', // orange
  '#9334e6', // purple
  '#1a8e9e', // teal
  '#c5221f', // dark red
  '#7627bb', // violet
  '#e52592', // pink
  '#5f6368', // gray
];

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

function initialsOf(name, email) {
  const source = (name || '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (email) return email.trim().slice(0, 2).toUpperCase();
  return '?';
}

function colorFor(key) {
  let hash = 0;
  const str = (key || '').toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

export default function Avatar({
  name,
  email,
  size = 'md',
  className = '',
  title,
}) {
  const initials = initialsOf(name, email);
  const bg = colorFor(email || name || '?');
  return (
    <span
      title={title || name || email || ''}
      aria-hidden="true"
      style={{ backgroundColor: bg }}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase text-white ${
        SIZES[size] || SIZES.md
      } ${className}`}
    >
      {initials}
    </span>
  );
}
