"""Update entry asset URLs so a new release cannot reuse cached old styles/code."""
from hashlib import sha256
from pathlib import Path
import re


def versioned_html(dist):
    html = (dist / 'index.html').read_text()
    for filename in ('style.css', 'app.js', 'icon.svg'):
        digest = sha256((dist / filename).read_bytes()).hexdigest()[:12]
        pattern = r'((?:href|src)=")' + re.escape(filename) + r'(?:\?[^"\s]*)?(")'
        html, count = re.subn(pattern, lambda m: m[1] + filename + '?v=' + digest + m[2], html)
        if count != 1:
            raise ValueError('Expected exactly one entry URL for ' + filename)
    return html


def main():
    dist = Path(__file__).resolve().parents[1] / 'dist'
    html = versioned_html(dist)
    target = dist / 'index.html'
    if target.read_text() == html:
        print('Asset versions are current.')
    else:
        target.write_text(html)
        print('Updated asset versions in dist/index.html; include it in the release commit.')


if __name__ == '__main__':
    main()
