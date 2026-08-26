const fs = require('fs-extra');
const path = require('path');
const domino = require('@mixmark-io/domino');
const { simplifyHtml } = require('./htmlSimplifier');

/** Minimal readable stylesheet for standalone HTML exports. */
const PAGE_STYLE = `
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6; color: #222; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
p.date { color: #777; font-size: 0.9em; margin-top: -0.5rem; }
img, video { max-width: 100%; height: auto; }
table { border-collapse: collapse; }
table, th, td { border: 1px solid #ccc; }
th, td { padding: 0.4em 0.6em; vertical-align: top; }
mark { background: #ffff00; }
a { color: #0b57d0; }
pre, code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f5f5f5; }
`.trim();

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Converts a filesystem relative path into a URL-encoded posix path. */
function toPosixUrl(relPath) {
    if (!relPath) return '';
    return relPath.split(path.sep).map(encodeURIComponent).join('/');
}

/**
 * Builds an HTML body fragment with local asset references rewritten to be
 * relative to `fromDir`.
 * @param {string} html - page HTML with data-local-* attributes
 * @param {string} fromDir - directory the resulting document will live in
 * @param {string} sectionDir - directory holding the `assets/` folder
 * @returns {{ body: string, assets: string[] }}
 */
function buildHtmlBody(html, fromDir, sectionDir) {
    const doc = domino.createDocument(`<!doctype html><html><body>${html || ''}</body></html>`);
    const container = doc.body;
    const relDir = toPosixUrl(path.relative(fromDir, sectionDir));
    const assetBase = relDir ? `${relDir}/assets` : 'assets';
    const assets = [];

    const addAsset = (name) => {
        if (name && !assets.includes(name)) assets.push(name);
    };

    for (const img of Array.from(container.getElementsByTagName('img'))) {
        const localId = img.getAttribute('data-local-src');
        if (!localId) continue;
        const fileName = localId.includes('.') ? localId : `${localId}.png`;
        img.setAttribute('src', `${assetBase}/${encodeURIComponent(fileName)}`);
        img.setAttribute('alt', img.getAttribute('alt') || '');
        img.removeAttribute('data-local-src');
        addAsset(fileName);
    }

    for (const video of Array.from(container.getElementsByTagName('video'))) {
        const localId = video.getAttribute('data-local-video');
        if (!localId) continue;
        const fileName = localId.includes('.') ? localId : `${localId}.mp4`;
        video.setAttribute('controls', '');
        video.setAttribute('src', `${assetBase}/${encodeURIComponent(fileName)}`);
        video.removeAttribute('data-local-video');
        addAsset(fileName);
    }

    for (const link of Array.from(container.getElementsByTagName('a'))) {
        const fileName = link.getAttribute('data-local-file');
        if (!fileName) continue;
        link.setAttribute('href', `${assetBase}/${encodeURIComponent(fileName)}`);
        link.removeAttribute('data-local-file');
        link.removeAttribute('data-filename');
        link.textContent = fileName;
        addAsset(fileName);
    }

    return { body: container.innerHTML, assets };
}

/** Wraps a body fragment into a minimal standalone HTML document. */
function buildStandaloneHtml(title, dateTime, body) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
        `<style>${PAGE_STYLE}</style></head><body>` +
        `<h1>${escapeHtml(title)}</h1><p class="date">${escapeHtml(dateTime)}</p>` +
        `${body}</body></html>`;
}

/**
 * Writes the Markdown (and optionally standalone HTML) output for one page and
 * records the page in `pageIdMap` for link resolution and JSON export.
 *
 * @param {object} params
 * @param {object} params.pageIdMap
 * @param {object} params.pageInfo - { id, name }
 * @param {object} params.content - { dateTime, internalLinks }
 * @param {string} params.updatedHtml - page HTML with rewritten data-local-* attrs
 * @param {string} params.sectionDir - directory holding the page + its assets/
 * @param {string} params.outputBase - notebook root directory
 * @param {string} params.sanitizedNoteName - page file base name
 * @param {object} params.td - Turndown instance
 * @param {object} params.options - { simplify, html, json }
 * @returns {Promise<{ filePath: string, markdown: string, htmlPath: (string|null) }>}
 */
async function writePageOutputs({ pageIdMap, pageInfo, content, updatedHtml, sectionDir, outputBase, sanitizedNoteName, td, options = {} }) {
    const finalHtml = options.simplify === false ? updatedHtml : simplifyHtml(updatedHtml);

    const markdown = td.turndown(finalHtml);
    const filePath = path.join(sectionDir, `${sanitizedNoteName}.md`);
    const sectionRelDir = path.relative(outputBase, sectionDir);

    pageIdMap[pageInfo.id] = {
        path: filePath,
        internalLinks: content.internalLinks,
        isDir: false,
        title: pageInfo.name,
        dateTime: content.dateTime,
        html: finalHtml,
        sectionRelDir,
        baseName: sanitizedNoteName
    };

    await fs.writeFile(filePath, `${content.dateTime}\n\n${markdown}`);

    let htmlPath = null;
    if (options.html) {
        const htmlDir = path.join(sectionDir, '_html');
        await fs.ensureDir(htmlDir);
        htmlPath = path.join(htmlDir, `${sanitizedNoteName}.html`);
        const { body } = buildHtmlBody(finalHtml, htmlDir, sectionDir);
        await fs.writeFile(htmlPath, buildStandaloneHtml(pageInfo.name, content.dateTime, body));
    }

    return { filePath, markdown, htmlPath };
}

/**
 * Writes one JSON file per exported page. Must run AFTER internal links have
 * been resolved so the embedded markdown is final.
 * @param {object} pageIdMap
 * @param {string} outputBase
 * @returns {Promise<number>} number of JSON files written
 */
async function writeJsonOutputs(pageIdMap, outputBase) {
    let written = 0;

    for (const [pageId, info] of Object.entries(pageIdMap)) {
        if (!info || info.isDir || typeof info.html !== 'string') continue;

        const sectionRelDir = info.sectionRelDir || '';
        const sectionDir = path.join(outputBase, sectionRelDir);
        const jsonDir = path.join(sectionDir, '_json');
        await fs.ensureDir(jsonDir);

        const { body, assets } = buildHtmlBody(info.html, jsonDir, sectionDir);

        let markdown = '';
        try {
            markdown = await fs.readFile(info.path, 'utf8');
        } catch (e) {
            markdown = '';
        }

        const sectionPath = sectionRelDir.split(path.sep).filter(Boolean).join('/');

        const payload = {
            id: pageId,
            title: info.title || info.baseName || '',
            dateTime: info.dateTime || '',
            section: sectionPath,
            sectionPath,
            markdown,
            html: body,
            // Asset paths relative to the section folder, so a consumer can
            // locate the files from the JSON alone (from _json/ they are ../<path>).
            assets: assets.map((name) => `assets/${name}`)
        };

        await fs.writeFile(
            path.join(jsonDir, `${info.baseName}.json`),
            JSON.stringify(payload, null, 2)
        );
        written++;
    }

    return written;
}

module.exports = { writePageOutputs, writeJsonOutputs, buildHtmlBody, buildStandaloneHtml };
