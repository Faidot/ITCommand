const ALLOWED_TAGS = new Set([
  "a", "blockquote", "br", "code", "col", "colgroup", "div", "em", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "li", "mark",
  "ol", "p", "pre", "s", "span", "strong", "sub", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "u", "ul",
]);

const DROP_WITH_CONTENTS = new Set([
  "base", "button", "embed", "form", "iframe", "input", "link", "math", "meta",
  "object", "script", "select", "style", "svg", "template", "textarea",
]);

const GLOBAL_ATTRIBUTES = new Set(["title"]);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  code: new Set(["class"]),
  img: new Set(["src", "alt", "width", "height"]),
  col: new Set(["span"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  ol: new Set(["start"]),
};

function safeUrl(raw: string, image = false) {
  const value = raw.trim();
  if (!value) return false;

  // Strip whitespace/control characters before checking schemes so values such
  // as "java\nscript:" cannot evade the protocol check.
  const compact = value.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase();
  if (compact.startsWith("javascript:") || compact.startsWith("vbscript:")) return false;
  if (compact.startsWith("data:")) {
    return image && /^data:image\/(?:png|gif|jpe?g|webp);base64,/i.test(compact);
  }

  try {
    const parsed = new URL(value, window.location.origin);
    return image
      ? parsed.protocol === "http:" || parsed.protocol === "https:"
      : ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Sanitize the rich HTML saved by the Tiptap KB editor before rendering it.
 * This deliberately keeps a small formatting allowlist and strips styles,
 * event handlers, embedded documents, forms, and unsafe URL schemes.
 */
export function sanitizeStoredHtml(html: string) {
  if (!html || typeof window === "undefined" || typeof DOMParser === "undefined") return "";

  const doc = new DOMParser().parseFromString(html, "text/html");
  const elements = Array.from(doc.body.querySelectorAll("*"));

  for (const element of elements) {
    const tag = element.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      if (DROP_WITH_CONTENTS.has(tag)) element.remove();
      else element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const allowed = GLOBAL_ATTRIBUTES.has(name) || TAG_ATTRIBUTES[tag]?.has(name);
      if (!allowed || name.startsWith("on")) {
        element.removeAttribute(attr.name);
      }
    }

    if (tag === "a") {
      const href = element.getAttribute("href");
      if (href && !safeUrl(href)) element.removeAttribute("href");
      if (element.getAttribute("target") === "_blank") {
        element.setAttribute("rel", "noopener noreferrer");
      } else {
        element.removeAttribute("target");
        element.removeAttribute("rel");
      }
    }

    if (tag === "code") {
      const className = element.getAttribute("class");
      if (className && !/^language-[a-z0-9_-]+$/i.test(className)) {
        element.removeAttribute("class");
      }
    }

    if (tag === "img") {
      const src = element.getAttribute("src");
      if (!src || !safeUrl(src, true)) element.remove();
    }
  }

  return doc.body.innerHTML;
}
