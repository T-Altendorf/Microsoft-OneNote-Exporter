const fs = require('fs-extra');
const path = require('path');
const { writePageOutputs, writeJsonOutputs, buildHtmlBody, buildStandaloneHtml } = require('../src/outputWriters');
const { createMarkdownConverter } = require('../src/parser');
const { resolveInternalLinks } = require('../src/linkResolver');

const TEMP_ROOT = path.resolve(__dirname, '../.test-temp');

describe('outputWriters', () => {
    let outputBase;
    let sectionDir;
    let td;

    beforeEach(async () => {
        outputBase = path.join(TEMP_ROOT, `nb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        // Nested: <notebook>/Group A/Section B
        sectionDir = path.join(outputBase, 'Group A', 'Section B');
        await fs.ensureDir(path.join(sectionDir, 'assets'));
        td = createMarkdownConverter();
    });

    afterAll(async () => {
        await fs.remove(TEMP_ROOT);
    });

    const basePage = () => ({
        pageIdMap: {},
        pageInfo: { id: 'page-1', name: 'My Page' },
        content: { dateTime: '2026-01-02 10:00', internalLinks: [] },
        updatedHtml: '<p><span style="font-weight:bold">Hello</span> world</p>',
        sectionDir,
        outputBase,
        sanitizedNoteName: 'My Page',
        td
    });

    describe('buildHtmlBody', () => {
        test('rewrites local assets relative to the html file directory', () => {
            const htmlDir = path.join(sectionDir, '_html');
            const { body, assets } = buildHtmlBody(
                '<img data-local-src="img_1"><video data-local-video="vid_1.webm"></video>' +
                '<a data-local-file="notes.pdf" data-filename="notes.pdf">x</a>',
                htmlDir,
                sectionDir
            );
            expect(body).toContain('src="../assets/img_1.png"');
            expect(body).toContain('src="../assets/vid_1.webm"');
            expect(body).toContain('href="../assets/notes.pdf"');
            expect(body).toContain('controls');
            expect(body).not.toContain('data-local-');
            expect(assets).toEqual(['img_1.png', 'vid_1.webm', 'notes.pdf']);
        });

        test('leaves internal links untouched', () => {
            const { body } = buildHtmlBody(
                '<a href="onenote:Sec.one#Page" data-internal-link="link_0">Other</a>',
                sectionDir,
                sectionDir
            );
            expect(body).toContain('href="onenote:Sec.one#Page"');
        });
    });

    describe('buildStandaloneHtml', () => {
        test('produces a complete document with escaped title', () => {
            const doc = buildStandaloneHtml('A & B', '2026-01-02', '<p>x</p>');
            expect(doc.startsWith('<!doctype html><html><head><meta charset="utf-8">')).toBe(true);
            expect(doc).toContain('<title>A &amp; B</title>');
            expect(doc).toContain('<h1>A &amp; B</h1>');
            expect(doc).toContain('<p class="date">2026-01-02</p>');
            expect(doc).toContain('mark { background: #ffff00; }');
            expect(doc.endsWith('</body></html>')).toBe(true);
        });
    });

    describe('writePageOutputs', () => {
        test('writes markdown with the date header and simplifies by default', async () => {
            const params = basePage();
            const { filePath, markdown } = await writePageOutputs(params);
            expect(filePath).toBe(path.join(sectionDir, 'My Page.md'));
            const written = await fs.readFile(filePath, 'utf8');
            expect(written).toBe('2026-01-02 10:00\n\n**Hello** world');
            expect(markdown).toBe('**Hello** world');
            expect(params.pageIdMap['page-1'].html).toBe('<p><b>Hello</b> world</p>');
        });

        test('records metadata for later exports', async () => {
            const params = basePage();
            await writePageOutputs(params);
            const entry = params.pageIdMap['page-1'];
            expect(entry.title).toBe('My Page');
            expect(entry.dateTime).toBe('2026-01-02 10:00');
            expect(entry.baseName).toBe('My Page');
            expect(entry.sectionRelDir).toBe(path.join('Group A', 'Section B'));
            expect(entry.isDir).toBe(false);
        });

        test('options.simplify === false keeps the raw html', async () => {
            const params = { ...basePage(), options: { simplify: false } };
            await writePageOutputs(params);
            expect(params.pageIdMap['page-1'].html).toContain('style="font-weight:bold"');
        });

        test('does not write html or json when disabled', async () => {
            const params = basePage();
            const { htmlPath } = await writePageOutputs(params);
            expect(htmlPath).toBeNull();
            expect(await fs.pathExists(path.join(sectionDir, '_html'))).toBe(false);
            expect(await fs.pathExists(path.join(outputBase, 'html'))).toBe(false);
        });

        test('options.html writes a standalone document with nested relative assets', async () => {
            const params = {
                ...basePage(),
                updatedHtml: '<p><img data-local-src="img_1"></p>',
                options: { html: true }
            };
            const { htmlPath } = await writePageOutputs(params);
            expect(htmlPath).toBe(path.join(sectionDir, '_html', 'My Page.html'));
            expect(await fs.pathExists(path.join(outputBase, 'html'))).toBe(false);
            const doc = await fs.readFile(htmlPath, 'utf8');
            expect(doc).toContain('<title>My Page</title>');
            expect(doc).toContain('<h1>My Page</h1>');
            expect(doc).toContain('src="../assets/img_1.png"');
        });
    });

    describe('writeJsonOutputs', () => {
        test('writes json with final markdown, html body and assets', async () => {
            const params = {
                ...basePage(),
                updatedHtml: '<p><span style="font-weight:bold">Hi</span></p><p><img data-local-src="img_1"></p>'
            };
            await writePageOutputs(params);
            const count = await writeJsonOutputs(params.pageIdMap, outputBase);
            expect(count).toBe(1);

            const jsonPath = path.join(sectionDir, '_json', 'My Page.json');
            expect(await fs.pathExists(path.join(outputBase, 'json'))).toBe(false);
            const raw = await fs.readFile(jsonPath, 'utf8');
            expect(raw).toContain('\n  "id"'); // 2-space indented
            const data = JSON.parse(raw);
            expect(data.id).toBe('page-1');
            expect(data.title).toBe('My Page');
            expect(data.dateTime).toBe('2026-01-02 10:00');
            expect(data.section).toBe('Group A/Section B');
            expect(data.sectionPath).toBe('Group A/Section B');
            expect(Object.keys(data)).toEqual(
                ['id', 'title', 'dateTime', 'section', 'sectionPath', 'markdown', 'html', 'assets']);
            expect(data.markdown).toContain('**Hi**');
            expect(data.markdown.startsWith('2026-01-02 10:00')).toBe(true);
            expect(data.html).toContain('<b>Hi</b>');
            expect(data.html).toContain('src="../assets/img_1.png"');
            expect(data.assets).toEqual(['assets/img_1.png']);
        });

        test('skips directory entries', async () => {
            const pageIdMap = { 'group-1': { path: sectionDir, isDir: true } };
            expect(await writeJsonOutputs(pageIdMap, outputBase)).toBe(0);
            expect(await fs.pathExists(path.join(sectionDir, '_json'))).toBe(false);
        });

        test('embeds markdown after internal links have been resolved', async () => {
            const targetDir = path.join(outputBase, 'Group A', 'Section B');
            const params = {
                ...basePage(),
                pageInfo: { id: 'page-1', name: 'Source' },
                sanitizedNoteName: 'Source',
                updatedHtml: '<p><a href="onenote:Section B.one#Target" data-internal-link="link_0">Target</a></p>',
                content: {
                    dateTime: '2026-01-02 10:00',
                    internalLinks: [{ id: 'link_0', href: 'onenote:Section B.one#Target' }]
                }
            };
            await writePageOutputs(params);
            params.pageIdMap['page-2'] = {
                path: path.join(targetDir, 'Target.md'),
                isDir: false,
                internalLinks: []
            };
            await fs.writeFile(path.join(targetDir, 'Target.md'), 'target');

            await resolveInternalLinks(params.pageIdMap, outputBase);
            await writeJsonOutputs(params.pageIdMap, outputBase);

            const data = JSON.parse(await fs.readFile(
                path.join(sectionDir, '_json', 'Source.json'), 'utf8'));
            expect(data.markdown).not.toContain('onenote-link:');
        });
    });
    describe('nested section groups', () => {
        test('_html and _json live inside the deepest section folder', async () => {
            const deepDir = path.join(outputBase, 'Group A', 'Group B', 'Section C');
            await fs.ensureDir(path.join(deepDir, 'assets'));
            const params = {
                ...basePage(),
                sectionDir: deepDir,
                updatedHtml: '<p><img data-local-src="img_1"></p>',
                options: { html: true, json: true }
            };
            const { filePath, htmlPath } = await writePageOutputs(params);
            await writeJsonOutputs(params.pageIdMap, outputBase);

            expect(filePath).toBe(path.join(deepDir, 'My Page.md'));
            expect(htmlPath).toBe(path.join(deepDir, '_html', 'My Page.html'));
            const jsonPath = path.join(deepDir, '_json', 'My Page.json');
            expect(await fs.pathExists(jsonPath)).toBe(true);

            // No parallel trees at the notebook root.
            expect(await fs.pathExists(path.join(outputBase, 'html'))).toBe(false);
            expect(await fs.pathExists(path.join(outputBase, 'json'))).toBe(false);

            const doc = await fs.readFile(htmlPath, 'utf8');
            expect(doc).toContain('src="../assets/img_1.png"');

            const data = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
            expect(data.section).toBe('Group A/Group B/Section C');
            expect(data.sectionPath).toBe('Group A/Group B/Section C');
            expect(data.assets).toEqual(['assets/img_1.png']);
            expect(data.html).toContain('src="../assets/img_1.png"');
        });
    });

    describe('electron export path', () => {
        const exporterSource = fs.readFileSync(
            path.resolve(__dirname, '../src/exporter.js'), 'utf8');

        test('processSectionsElectron uses the same writers, per-section', () => {
            // Both the CLI and the Electron path must hand the writers the same
            // sectionDir/outputBase pair, so the layout is identical.
            const calls = exporterSource.match(/await writePageOutputs\(\{[\s\S]*?\}\);/g) || [];
            expect(calls.length).toBe(2);
            for (const call of calls) {
                expect(call).toContain('sectionDir');
                expect(call).toContain('outputBase');
                expect(call).toContain('options');
            }
            expect(exporterSource).toContain('writeJsonOutputs(pageIdMap, outputBase)');
        });

        test('no notebook-root json/html trees are created anywhere', () => {
            const writersSource = fs.readFileSync(
                path.resolve(__dirname, '../src/outputWriters.js'), 'utf8');
            for (const source of [exporterSource, writersSource]) {
                expect(source).not.toMatch(/outputBase,\s*'json'/);
                expect(source).not.toMatch(/outputBase,\s*'html'/);
            }
            expect(writersSource).toContain("path.join(sectionDir, '_html')");
            expect(writersSource).toContain("path.join(sectionDir, '_json')");
        });
    });
});
