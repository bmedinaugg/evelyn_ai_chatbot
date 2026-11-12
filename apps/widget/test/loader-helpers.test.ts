import { describe, expect, it } from 'vitest';
import {
  buildIframeUrl,
  CLOSE_MESSAGE,
  isWidgetMessage,
  parseWidgetUrl,
} from '../src/loader-helpers.ts';

describe('parseWidgetUrl', () => {
  it('accepts https and local http only', () => {
    expect(parseWidgetUrl('https://chat.trainmore.example/')?.origin).toBe(
      'https://chat.trainmore.example',
    );
    expect(parseWidgetUrl('http://localhost:5173/')?.origin).toBe('http://localhost:5173');
    expect(parseWidgetUrl('http://chat.trainmore.example/')).toBeNull();
    expect(parseWidgetUrl('javascript:alert(1)')).toBeNull();
    expect(parseWidgetUrl(undefined)).toBeNull();
  });
});

describe('buildIframeUrl', () => {
  it('adds the language', () => {
    const base = parseWidgetUrl('https://chat.trainmore.example/') as URL;
    expect(buildIframeUrl(base, 'en')).toBe('https://chat.trainmore.example/?lang=en');
  });
});

describe('isWidgetMessage', () => {
  it('accepts the close message only from the widget origin', () => {
    const origin = 'https://chat.trainmore.example';
    expect(isWidgetMessage({ origin, data: { type: CLOSE_MESSAGE } }, origin)).toBe(true);
    expect(
      isWidgetMessage({ origin: 'https://evil.example', data: { type: CLOSE_MESSAGE } }, origin),
    ).toBe(false);
    expect(isWidgetMessage({ origin, data: 'close' }, origin)).toBe(false);
    expect(isWidgetMessage({ origin, data: null }, origin)).toBe(false);
  });
});
