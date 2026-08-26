# Output layout

Every export produces one folder per notebook. Inside it, the notebook's
section-group hierarchy is mirrored as nested folders, and each **section**
folder is self-contained: Markdown, assets, and the optional HTML/JSON
renderings of the same pages all live together.

```
<output dir>/
  <Notebook>/
    <Section Group>/…/<Section>/
      <page title>.md              # always
      assets/<title>_img_N.png     # always (images, videos, attachments)
      _html/<page>.html            # only with --html
      _json/<page>.json            # only with --json
```

There are no `json/` or `html/` trees at the notebook root any more; both
outputs are section-local. Moving or copying a section folder now carries its
Markdown, assets, HTML and JSON along with it.

## Asset references

Asset references inside `_html/*.html` and inside the `html` field of
`_json/*.json` are written relative to the file's own directory, so from
either subfolder an image resolves as `../assets/<file>`.

## JSON page object

`_json/<page>.json` is a single object, 2-space indented:

| field | type | notes |
| --- | --- | --- |
| `id` | string | OneNote page id |
| `title` | string | page title |
| `dateTime` | string | page date/time header as exported |
| `section` | string | POSIX section path relative to the notebook root, e.g. `Group A/Section B` |
| `sectionPath` | string | same value as `section`, explicit name for consumers |
| `markdown` | string | the final `.md` file contents, after internal links are resolved (includes the date header line) |
| `html` | string | body fragment with local assets rewritten to `../assets/…` |
| `assets` | string[] | asset paths **relative to the section folder**, e.g. `assets/img_1.png` |

`assets` is section-relative rather than bare filenames so a consumer can
locate the files from the JSON alone, without reading the Markdown. From the
JSON file's own location prefix them with `../`.

## CLI / Electron

The `--html` and `--json` flags are unchanged, and the CLI and Electron export
paths share the same writers, so both produce exactly this layout.
