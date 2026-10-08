import type { App } from '../app';
import { settings, type AnimationSpeed, type GraphicsQuality, type PixelDensity, isMobileDevice } from '../settings';
import { audio } from '../audio';
import { h, segmented } from '../ui/dom';
import { backHeader } from './common';
import { menuScreen } from './menu';

/** Settings controls; reused by the in-game settings dialog. */
export function settingsForm(): HTMLElement {
  const s = settings.get();
  const row = (label: string, control: HTMLElement, hint?: string) =>
    h('div', { class: 'setting-row' }, h('div', {}, h('div', { class: 'field-label' }, label), hint ? h('div', { class: 'hint muted small-text' }, hint) : null), control);
  const slider = (key: 'masterVolume' | 'musicVolume' | 'effectsVolume', label: string) => {
    const input = h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(s[key] * 100), 'aria-label': label });
    input.addEventListener('input', () => {
      audio.unlock();
      settings.update({ [key]: Number(input.value) / 100 } as Partial<typeof s>);
    });
    input.addEventListener('change', () => audio.play('coin'));
    return row(label, input);
  };
  const check = (key: 'cameraRotate' | 'invertCamera' | 'reducedMotion' | 'confirmDestructive' | 'mobilePreset', label: string, hint?: string) => {
    const input = h('input', { type: 'checkbox', 'aria-label': label });
    input.checked = s[key];
    input.addEventListener('change', () => settings.update({ [key]: input.checked } as Partial<typeof s>));
    return row(label, h('div', {}, input), hint);
  };
  const fs = h('input', { type: 'checkbox', 'aria-label': 'Full screen' });
  fs.checked = !!document.fullscreenElement;
  fs.disabled = !document.fullscreenEnabled;
  fs.addEventListener('change', () => {
    if (fs.checked) void document.documentElement.requestFullscreen().catch(() => (fs.checked = false));
    else if (document.fullscreenElement) void document.exitFullscreen();
  });
  return h(
    'div',
    { class: 'settings-grid' },
    slider('masterVolume', 'Master volume'),
    slider('musicVolume', 'Music volume'),
    slider('effectsVolume', 'Effects volume'),
    row(
      'Animation speed',
      segmented<AnimationSpeed>(
        [
          { value: 'normal', label: 'Normal' },
          { value: 'fast', label: 'Fast' },
          { value: 'reduced', label: 'Reduced motion' }
        ],
        s.animationSpeed,
        (v) => settings.update({ animationSpeed: v }),
        'Animation speed'
      )
    ),
    row(
      'Graphics quality',
      segmented<GraphicsQuality>(
        [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' }
        ],
        s.graphicsQuality,
        (v) => settings.update({ graphicsQuality: v }),
        'Graphics quality'
      ),
      'Low turns off shadows and anti-aliasing (anti-aliasing changes apply after reload).'
    ),
    row(
      'Render pixel density',
      segmented<PixelDensity>(
        [
          { value: 'auto', label: 'Auto' },
          { value: '1', label: '1x' },
          { value: '1.5', label: '1.5x' },
          { value: '2', label: '2x' }
        ],
        s.pixelDensity,
        (v) => settings.update({ pixelDensity: v }),
        'Render pixel density'
      ),
      'Lower is faster and cooler on phones.'
    ),
    check('cameraRotate', 'Camera rotation', 'When off, dragging pans the board instead of rotating it.'),
    check('invertCamera', 'Invert camera drag'),
    check('reducedMotion', 'Reduced motion', 'Skips token, dice and camera animations.'),
    check('confirmDestructive', 'Confirm risky actions', 'Ask before bankruptcy, quitting or selling buildings.'),
    check('mobilePreset', 'Mobile graphics preset', isMobileDevice() ? 'This device looks like a phone: low graphics are used by default.' : 'Use low graphics automatically on phones.'),
    row('Full screen', h('div', {}, fs))
  );
}

export function settingsScreen(app: App): void {
  app.root.append(h('div', { class: 'screen top' }, h('div', { class: 'card wide', 'data-testid': 'settings-screen' }, backHeader('Settings', () => app.show(menuScreen)), settingsForm())));
}
