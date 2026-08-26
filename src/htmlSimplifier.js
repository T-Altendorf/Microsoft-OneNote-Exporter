const domino = require('@mixmark-io/domino');

// OneNote web UI chrome that carries no content
const JUNK_CLASSES = [
    'TableHover',
    'TableInsertRowGap',
    'TableColumnHandle',
    'TableColumnWidthSpacer',
    'TableColumnResizeHandle'
];

// Attributes that survive the strip pass
const KEPT_ATTRIBUTES = new Set([
    'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'type', 'start',
    'data-local-src', 'data-local-file', 'data-filename', 'data-local-video',
    'data-internal-link', 'data-embed-id'
]);

const DROPPED_ATTRIBUTES = new Set([
    'style', 'class', 'id', 'lang', 'dir', 'contenteditable', 'tabindex', 'role'
]);

const INLINE_WRAPPERS = ['b', 'i', 'u', 's', 'mark'];

const BLOCK_TAGS = new Set([
    'DIV', 'P', 'TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'PRE',
    'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
]);

const NEUTRAL_BACKGROUNDS = new Set([
    'transparent', 'none', 'inherit', 'initial', 'unset', 'revert',
    'white', '#fff', '#ffffff', 'rgb(255,255,255)', 'rgba(255,255,255,1)'
]);

/** Parses an inline style attribute into a lowercased property map. */
function parseStyle(el) {
    const raw = el.getAttribute && el.getAttribute('style');
    const map = {};
    if (!raw) return map;
    for (const decl of raw.split(';')) {
        const idx = decl.indexOf(':');
        if (idx === -1) continue;
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const value = decl.slice(idx + 1).trim().toLowerCase();
        if (prop) map[prop] = value;
    }
    return map;
}

/** Class tokens of an element (case-sensitive, as OneNote emits them). */
function classTokens(el) {
    const raw = el.getAttribute && el.getAttribute('class');
    if (!raw) return [];
    return raw.split(/\s+/).filter(Boolean);
}

function isBoldWeight(value) {
    if (!value) return false;
    if (value === 'bold' || value === 'bolder') return true;
    const num = parseInt(value, 10);
    return Number.isFinite(num) && num >= 600 && num <= 900;
}

function isHighlightBackground(value) {
    if (!value) return false;
    const normalized = value.replace(/\s+/g, '');
    if (NEUTRAL_BACKGROUNDS.has(normalized)) return false;
    // `background: none repeat scroll 0 0 transparent` style shorthands
    if (/rgba\([^)]*,0(\.0+)?\)$/.test(normalized)) return false;
    return true;
}

/** Semantic formatting implied by an element's style/class, outermost first. */
function detectFormatting(el) {
    const style = parseStyle(el);
    const classes = classTokens(el);
    const hasClass = (needle) => classes.some(c => c.includes(needle));

    const decoration = `${style['text-decoration'] || ''} ${style['text-decoration-line'] || ''}`;
    const background = style['background-color'] || style['background'];

    const props = [];
    if (isBoldWeight(style['font-weight']) || hasClass('Bold')) props.push('b');
    if (['italic', 'oblique'].includes(style['font-style']) || hasClass('Italic')) props.push('i');
    if (decoration.includes('underline') || hasClass('Underline')) props.push('u');
    if (decoration.includes('line-through') || hasClass('Strikethrough')) props.push('s');
    if (isHighlightBackground(background)) props.push('mark');
    return props;
}

/**
 * Heading level implied by an inline font-size, or null.
 * Calibrated to OneNote defaults: body 11pt (14.67px), Heading 3 = 12pt bold,
 * Heading 2 = 14pt (18.67px), Heading 1 = 16pt (21.33px). Body-sized text is
 * never promoted; 12pt only counts as h3 when it is also bold.
 */
function headingLevelFor(el, style) {
    const size = style['font-size'];
    if (!size) return null;
    const match = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(size.replace(/\s+/g, ''));
    if (!match) return null;
    let px = parseFloat(match[1]);
    if (match[2] === 'pt') px = px * 4 / 3;
    if (px >= 20) return 1;
    if (px >= 18) return 2;
    if (px >= 16 && isBoldWeight(style['font-weight'])) return 3;
    return null;
}

/** True when the element is one uniform run of text (no nested font sizes). */
function isSingleTextRun(el) {
    if (!el.textContent || !el.textContent.trim()) return false;
    const descendants = el.getElementsByTagName('*');
    for (let i = 0; i < descendants.length; i++) {
        const child = descendants[i];
        if (BLOCK_TAGS.has(child.nodeName)) return false;
        if (parseStyle(child)['font-size']) return false;
    }
    return true;
}

function removeJunkAndNoise(root, doc) {
    // Comments
    const stack = [root];
    const comments = [];
    while (stack.length) {
        const node = stack.pop();
        for (let i = 0; i < node.childNodes.length; i++) {
            const child = node.childNodes[i];
            if (child.nodeType === 8) comments.push(child);
            else if (child.nodeType === 1) stack.push(child);
        }
    }
    comments.forEach(c => c.parentNode && c.parentNode.removeChild(c));

    // script/style tags
    Array.from(root.getElementsByTagName('script')).forEach(n => n.parentNode && n.parentNode.removeChild(n));
    Array.from(root.getElementsByTagName('style')).forEach(n => n.parentNode && n.parentNode.removeChild(n));

    // OneNote UI junk
    Array.from(root.getElementsByTagName('*')).forEach(el => {
        if (!el.parentNode) return;
        const classes = classTokens(el);
        if (classes.some(c => JUNK_CLASSES.some(junk => c.includes(junk)))) {
            el.parentNode.removeChild(el);
        }
    });
}

/** Extracts semantic formatting + headings, before attributes are stripped. */
function applySemantics(root, doc) {
    const alreadyHasHeadings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
        .some(tag => root.getElementsByTagName(tag).length > 0);

    const elements = Array.from(root.getElementsByTagName('*'));
    for (const el of elements) {
        if (!el.parentNode) continue;

        const style = parseStyle(el);
        let props = detectFormatting(el);

        // Heading mapping (conservative: uniform single run of text only)
        let headingLevel = null;
        if (!alreadyHasHeadings && ['P', 'DIV', 'SPAN'].includes(el.nodeName)) {
            const level = headingLevelFor(el, style);
            if (level && isSingleTextRun(el)) headingLevel = level;
        }

        let target = el;
        if (headingLevel) {
            const heading = doc.createElement(`h${headingLevel}`);
            while (el.firstChild) heading.appendChild(el.firstChild);
            for (const attr of Array.from(el.attributes)) {
                heading.setAttribute(attr.name, attr.value);
            }
            el.parentNode.replaceChild(heading, el);
            target = heading;
            // Headings already read as emphasised; don't double up with bold.
            props = props.filter(p => p !== 'b');
        }

        if (!props.length) continue;
        if (INLINE_WRAPPERS.includes(target.nodeName.toLowerCase())) {
            // Already a semantic wrapper; don't wrap it in itself.
            props = props.filter(p => p !== target.nodeName.toLowerCase());
            if (!props.length) continue;
        }

        // Build nested wrappers, outermost first, and move children inside.
        const outer = doc.createElement(props[0]);
        let innermost = outer;
        for (let i = 1; i < props.length; i++) {
            const next = doc.createElement(props[i]);
            innermost.appendChild(next);
            innermost = next;
        }
        while (target.firstChild) innermost.appendChild(target.firstChild);
        target.appendChild(outer);
    }
}

function stripAttributes(root) {
    for (const el of Array.from(root.getElementsByTagName('*'))) {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (KEPT_ATTRIBUTES.has(name)) continue;
            if (DROPPED_ATTRIBUTES.has(name) || name.startsWith('aria-') || name.startsWith('data-')) {
                el.removeAttribute(attr.name);
            }
        }
    }
}

function unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
}

function unwrapBareInlineContainers(root) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const el of Array.from(root.getElementsByTagName('*'))) {
            if (!el.parentNode) continue;
            const tag = el.nodeName;
            if ((tag === 'SPAN' || tag === 'FONT') && el.attributes.length === 0) {
                unwrap(el);
                changed = true;
            }
        }
    }
}

function hasNonWhitespaceText(el) {
    for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child.nodeType === 3 && child.nodeValue.trim()) return true;
    }
    return false;
}

function collapseWrapperDivs(root) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const el of Array.from(root.getElementsByTagName('div'))) {
            if (!el.parentNode) continue;
            if (el.attributes.length > 0) continue;
            if (hasNonWhitespaceText(el)) continue;
            const children = Array.from(el.childNodes).filter(n => n.nodeType === 1);
            if (children.length !== 1) continue;
            if (!BLOCK_TAGS.has(children[0].nodeName)) continue;
            unwrap(el);
            changed = true;
        }
    }
}

function mergeAdjacentInlines(root) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const el of Array.from(root.getElementsByTagName('*'))) {
            if (!el.parentNode) continue;
            if (!INLINE_WRAPPERS.includes(el.nodeName.toLowerCase())) continue;
            if (el.attributes.length > 0) continue;
            const next = el.nextSibling;
            if (!next || next.nodeType !== 1) continue;
            if (next.nodeName !== el.nodeName) continue;
            if (next.attributes.length > 0) continue;
            while (next.firstChild) el.appendChild(next.firstChild);
            next.parentNode.removeChild(next);
            changed = true;
        }
    }
}

/**
 * Simplifies OneNote web HTML into clean semantic HTML.
 * Pure function; idempotent.
 * @param {string} html
 * @returns {string}
 */
function simplifyHtml(html) {
    if (!html || typeof html !== 'string') return '';

    const doc = domino.createDocument(`<!doctype html><html><body>${html}</body></html>`);
    const container = doc.body;

    removeJunkAndNoise(container, doc);
    applySemantics(container, doc);
    stripAttributes(container);
    unwrapBareInlineContainers(container);
    collapseWrapperDivs(container);
    mergeAdjacentInlines(container);

    return container.innerHTML;
}

module.exports = { simplifyHtml, detectInlineFormatting: detectFormatting };
