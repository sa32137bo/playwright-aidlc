/**
 * Tiny XML reader for machine-generated Office markup.
 *
 * Not a general parser and not trying to be: no DTDs, no namespaces resolution,
 * no entity declarations. Office writes extremely regular XML, and a real parser
 * would be a dependency for no gain. Tag names are kept verbatim including their
 * prefix ("w:p", "a:blip") because that is how the callers match them.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
  });
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) attrs[m[1]] = decodeEntities(m[2]);
    else attrs[m[3]] = decodeEntities(m[4]);
  }
  return attrs;
}

/**
 * Parse into a tree of { name, attrs, children }. Text nodes are plain strings.
 * Unclosed tags are tolerated by unwinding to the nearest matching ancestor —
 * a malformed document should degrade, not throw away the whole conversion.
 */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<([!?/]?)([\w:.-]*)([^>]*?)(\/?)>/g;
  let last = 0;
  let m;

  while ((m = re.exec(xml))) {
    const [full, prefix, name, rest, selfClose] = m;

    if (m.index > last) {
      const text = xml.slice(last, m.index);
      if (text) stack[stack.length - 1].children.push(decodeEntities(text));
    }
    last = m.index + full.length;

    if (prefix === '!' || prefix === '?') {
      // Comment, CDATA, doctype or processing instruction.
      if (full.startsWith('<![CDATA[')) {
        const end = xml.indexOf(']]>', m.index);
        if (end > -1) {
          stack[stack.length - 1].children.push(xml.slice(m.index + 9, end));
          re.lastIndex = end + 3;
          last = re.lastIndex;
        }
      } else if (full.startsWith('<!--')) {
        const end = xml.indexOf('-->', m.index);
        if (end > -1) { re.lastIndex = end + 3; last = re.lastIndex; }
      }
      continue;
    }

    if (prefix === '/') {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }

    const node = { name, attrs: parseAttrs(rest), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }

  return root;
}

/** Direct children with this tag name. */
export function kids(node, name) {
  if (!node || !node.children) return [];
  return node.children.filter((c) => typeof c !== 'string' && c.name === name);
}

/** First direct child with this tag name. */
export function kid(node, name) {
  return kids(node, name)[0] || null;
}

/** First descendant with this tag name, depth-first. */
export function find(node, name) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) return c;
    const deep = find(c, name);
    if (deep) return deep;
  }
  return null;
}

/** Every descendant with this tag name, in document order. */
export function findAll(node, name, out = []) {
  if (!node || !node.children) return out;
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

/** Concatenated text of every descendant text node. */
export function textOf(node) {
  if (typeof node === 'string') return node;
  if (!node || !node.children) return '';
  return node.children.map(textOf).join('');
}
