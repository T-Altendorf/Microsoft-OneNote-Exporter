const { simplifyHtml } = require('../src/htmlSimplifier');

describe('htmlSimplifier - simplifyHtml', () => {
    describe('inline formatting from styles', () => {
        test('font-weight: bold becomes <b>', () => {
            expect(simplifyHtml('<span style="font-weight:bold">hi</span>')).toBe('<b>hi</b>');
        });

        test('numeric font-weight 700 becomes <b>', () => {
            expect(simplifyHtml('<span style="font-weight: 700">hi</span>')).toBe('<b>hi</b>');
        });

        test('font-weight 500 is not bold', () => {
            expect(simplifyHtml('<span style="font-weight: 500">hi</span>')).toBe('hi');
        });

        test('font-style italic becomes <i>', () => {
            expect(simplifyHtml('<span style="font-style:italic">hi</span>')).toBe('<i>hi</i>');
        });

        test('font-style oblique becomes <i>', () => {
            expect(simplifyHtml('<span style="font-style:oblique">hi</span>')).toBe('<i>hi</i>');
        });

        test('underline becomes <u>', () => {
            expect(simplifyHtml('<span style="text-decoration: underline">hi</span>')).toBe('<u>hi</u>');
        });

        test('line-through becomes <s>', () => {
            expect(simplifyHtml('<span style="text-decoration: line-through">hi</span>')).toBe('<s>hi</s>');
        });

        test('background-color becomes <mark>', () => {
            expect(simplifyHtml('<span style="background-color:#ffff00">hi</span>')).toBe('<mark>hi</mark>');
        });

        test('neutral backgrounds are not highlights', () => {
            expect(simplifyHtml('<span style="background-color: transparent">hi</span>')).toBe('hi');
            expect(simplifyHtml('<span style="background-color: #ffffff">hi</span>')).toBe('hi');
            expect(simplifyHtml('<span style="background: none">hi</span>')).toBe('hi');
        });

        test('multiple properties nest bold outside italic', () => {
            expect(simplifyHtml('<span style="font-weight:bold;font-style:italic">hi</span>'))
                .toBe('<b><i>hi</i></b>');
        });

        test('bold + underline + strikethrough + highlight nest in order', () => {
            const html = '<span style="font-weight:900;text-decoration:underline line-through;background-color:lime">x</span>';
            expect(simplifyHtml(html)).toBe('<b><u><s><mark>x</mark></s></u></b>');
        });
    });

    describe('class-based formatting', () => {
        test('Strikethrough class becomes <s>', () => {
            expect(simplifyHtml('<span class="Strikethrough">x</span>')).toBe('<s>x</s>');
        });

        test('OneNote Bold/Italic/Underline class tokens are honoured', () => {
            expect(simplifyHtml('<span class="TextRunBold">x</span>')).toBe('<b>x</b>');
            expect(simplifyHtml('<span class="TextRunItalic">x</span>')).toBe('<i>x</i>');
            expect(simplifyHtml('<span class="TextRunUnderline">x</span>')).toBe('<u>x</u>');
        });

        test('class matching is case sensitive', () => {
            expect(simplifyHtml('<span class="notbolded">x</span>')).toBe('x');
        });
    });

    describe('attribute handling', () => {
        test('strips presentational and accessibility attributes', () => {
            const html = '<p id="a" class="b" lang="en" dir="ltr" tabindex="0" role="presentation" ' +
                'aria-label="x" data-foo="y" contenteditable="true" style="color:red">text</p>';
            expect(simplifyHtml(html)).toBe('<p>text</p>');
        });

        test('keeps asset and link attributes', () => {
            const html = '<img src="http://x/y.png" data-local-src="img_1" alt="pic" data-junk="z" class="c">';
            expect(simplifyHtml(html)).toBe('<img src="http://x/y.png" data-local-src="img_1" alt="pic">');
        });

        test('keeps data-local-file, data-filename, data-internal-link and data-embed-id', () => {
            const html = '<a href="http://x" data-local-file="f.pdf" data-filename="f.pdf" data-track="no">F</a>' +
                '<a href="onenote:x" data-internal-link="link_0">P</a>' +
                '<iframe src="https://y" data-embed-id="e0"></iframe>';
            const out = simplifyHtml(html);
            expect(out).toContain('data-local-file="f.pdf"');
            expect(out).toContain('data-filename="f.pdf"');
            expect(out).toContain('data-internal-link="link_0"');
            expect(out).toContain('data-embed-id="e0"');
            expect(out).not.toContain('data-track');
        });

        test('keeps data-local-video and list attributes', () => {
            expect(simplifyHtml('<video data-local-video="v_1.webm" class="c"></video>'))
                .toBe('<video data-local-video="v_1.webm"></video>');
            expect(simplifyHtml('<ol type="a" start="3" class="c"><li>x</li></ol>'))
                .toBe('<ol type="a" start="3"><li>x</li></ol>');
        });

        test('keeps table span attributes', () => {
            expect(simplifyHtml('<table><tr><td colspan="2" rowspan="3" class="c">x</td></tr></table>'))
                .toContain('colspan="2" rowspan="3"');
        });
    });

    describe('junk removal', () => {
        test('removes OneNote UI helper elements', () => {
            const html = '<div class="TableHover"></div><div class="TableInsertRowGap"></div>' +
                '<div class="TableColumnHandle"></div><div class="TableColumnWidthSpacer"></div>' +
                '<div class="TableColumnResizeHandle"></div><p>keep</p>';
            expect(simplifyHtml(html)).toBe('<p>keep</p>');
        });

        test('removes script, style and comments', () => {
            const html = '<script>alert(1)</script><style>p{color:red}</style><!-- note --><p>keep</p>';
            expect(simplifyHtml(html)).toBe('<p>keep</p>');
        });
    });

    describe('structural cleanup', () => {
        test('unwraps attribute-less spans and fonts', () => {
            expect(simplifyHtml('<span><font>plain</font></span>')).toBe('plain');
        });

        test('collapses nested wrapper divs', () => {
            expect(simplifyHtml('<div class="a"><div class="b"><p>deep</p></div></div>')).toBe('<p>deep</p>');
        });

        test('does not collapse a div holding text alongside a block', () => {
            const out = simplifyHtml('<div>loose text<p>block</p></div>');
            expect(out).toBe('<div>loose text<p>block</p></div>');
        });

        test('does not collapse a div with several block children', () => {
            expect(simplifyHtml('<div><p>a</p><p>b</p></div>')).toBe('<div><p>a</p><p>b</p></div>');
        });

        test('merges adjacent identical inline siblings', () => {
            expect(simplifyHtml('<b>a</b><b>b</b>')).toBe('<b>ab</b>');
            expect(simplifyHtml('<span style="font-weight:bold">a</span><span style="font-weight:bold">b</span>'))
                .toBe('<b>ab</b>');
        });

        test('does not merge across differing formatting', () => {
            expect(simplifyHtml('<b>a</b><i>b</i>')).toBe('<b>a</b><i>b</i>');
        });
    });

    describe('heading mapping', () => {
        test('font-size >= 20px becomes h1', () => {
            expect(simplifyHtml('<p style="font-size:24px">Title</p>')).toBe('<h1>Title</h1>');
        });

        test('18-19px becomes h2', () => {
            expect(simplifyHtml('<p style="font-size:18px">Sub</p>')).toBe('<h2>Sub</h2>');
        });

        test('16px is h3 only when bold', () => {
            expect(simplifyHtml('<p style="font-size:16px;font-weight:bold">Small</p>')).toBe('<h3>Small</h3>');
            expect(simplifyHtml('<p style="font-size:16px">Body 12pt</p>')).toBe('<p>Body 12pt</p>');
        });

        test('OneNote default body size (11pt / 14.67px) is never a heading', () => {
            expect(simplifyHtml('<p style="font-size:11pt">Body</p>')).toBe('<p>Body</p>');
            expect(simplifyHtml('<p style="font-size:14.67px">Body</p>')).toBe('<p>Body</p>');
        });

        test('pt units are converted (16pt heading 1, 14pt heading 2)', () => {
            expect(simplifyHtml('<p style="font-size:16pt">H1</p>')).toBe('<h1>H1</h1>');
            expect(simplifyHtml('<p style="font-size:14pt">H2</p>')).toBe('<h2>H2</h2>');
        });

        test('body-size text stays a paragraph', () => {
            expect(simplifyHtml('<p style="font-size:11px">Body</p>')).toBe('<p>Body</p>');
        });

        test('mixed font sizes inside a block are not promoted', () => {
            const html = '<p style="font-size:24px">Big <span style="font-size:11px">small</span></p>';
            expect(simplifyHtml(html)).toBe('<p>Big small</p>');
        });

        test('existing headings disable font-size promotion', () => {
            const html = '<h2>Real heading</h2><p style="font-size:24px">Big</p>';
            expect(simplifyHtml(html)).toBe('<h2>Real heading</h2><p>Big</p>');
        });

        test('a bold heading does not keep a redundant <b>', () => {
            expect(simplifyHtml('<p style="font-size:22px;font-weight:bold">Title</p>')).toBe('<h1>Title</h1>');
        });
    });

    describe('realistic OneNote snippet', () => {
        const snippet = `
<div class="OutlineContainer" data-id="outline-1" role="presentation">
  <div class="OutlineElement" style="margin:0px">
    <p style="margin:0px;font-size:22px;font-family:Calibri">Weekly Review</p>
  </div>
  <div class="TableColumnResizeHandle"></div>
  <div class="OutlineElement">
    <p style="margin:0px">
      <span style="font-weight:bold;font-family:Calibri">Wins</span><span style="font-family:Calibri">: shipped </span><span style="font-style:italic">the</span><span> exporter, </span><span style="text-decoration:line-through">missed</span><span> nothing.</span>
    </p>
  </div>
  <div class="OutlineElement">
    <p><span style="background-color:#FFFF00">Follow up with Sam</span></p>
  </div>
  <div class="OutlineElement">
    <p><img src="https://onenote.example/img" data-local-src="Weekly_Review_image_1" class="ImageNode"></p>
  </div>
</div>`;

        test('produces clean semantic markup', () => {
            const out = simplifyHtml(snippet);
            expect(out).toContain('<h1>Weekly Review</h1>');
            expect(out).toContain('<b>Wins</b>');
            expect(out).toContain('<i>the</i>');
            expect(out).toContain('<s>missed</s>');
            expect(out).toContain('<mark>Follow up with Sam</mark>');
            expect(out).toContain('data-local-src="Weekly_Review_image_1"');
            expect(out).not.toContain('style=');
            expect(out).not.toContain('class=');
            expect(out).not.toContain('TableColumnResizeHandle');
        });

        test('is idempotent', () => {
            const once = simplifyHtml(snippet);
            expect(simplifyHtml(once)).toBe(once);
        });
    });

    describe('idempotency', () => {
        const cases = [
            '<span style="font-weight:bold">a</span><span style="font-weight:bold">b</span>',
            '<div class="a"><div><p style="font-size:24px">T</p></div></div>',
            '<p style="text-decoration:underline;background:red">x</p>',
            '<table><tr><td colspan="2">c</td></tr></table>',
            '<ul><li>one</li><li><b>two</b></li></ul>'
        ];
        test.each(cases)('simplify(simplify(x)) === simplify(x): %s', (html) => {
            const once = simplifyHtml(html);
            expect(simplifyHtml(once)).toBe(once);
        });
    });

    describe('edge cases', () => {
        test('empty input returns empty string', () => {
            expect(simplifyHtml('')).toBe('');
            expect(simplifyHtml(null)).toBe('');
            expect(simplifyHtml(undefined)).toBe('');
        });

        test('plain text passes through', () => {
            expect(simplifyHtml('just text')).toBe('just text');
        });
    });
});
