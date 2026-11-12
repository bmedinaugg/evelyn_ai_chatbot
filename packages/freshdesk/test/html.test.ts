import { describe, expect, it } from 'vitest';
import { escapeHtml, htmlToText } from '../src/html.ts';

describe('htmlToText', () => {
  it('converts block tags and br to newlines, strips tags', () => {
    expect(htmlToText('<p>Hoi</p><ul><li>a</li><li>b</li></ul>Line<br>2')).toBe(
      'Hoi\n\n- a\n- b\n\nLine\n2',
    );
  });

  it('drops script and style contents', () => {
    expect(htmlToText('<p>x</p><script>alert(1)</script><style>p{}</style>')).toBe('x');
  });

  it('decodes entities', () => {
    expect(htmlToText('&amp; &lt;b&gt; &quot;q&quot; &#39;s&#39; &nbsp;€ &#8364; &#x20AC;')).toBe(
      '& <b> "q" \'s\' € € €',
    );
  });

  it('does not turn decoded entities back into tags', () => {
    expect(htmlToText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>');
  });

  it('collapses whitespace and trims', () => {
    expect(htmlToText('  <p> a \n\n\n b </p>  ')).toBe('a\n\nb');
  });
});

describe('escapeHtml', () => {
  it('escapes & < > " \'', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
