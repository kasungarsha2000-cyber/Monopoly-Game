/**
 * Tiny DOM helpers. All dynamic text goes through textContent (never
 * innerHTML), so player names from the network cannot inject markup.
 */
import { audio } from '../audio';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'style') {
      el.setAttribute('style', String(v));
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export interface ButtonOpts {
  variant?: 'primary' | 'success' | 'warn' | 'danger' | 'ghost' | '';
  small?: boolean;
  block?: boolean;
  disabled?: boolean;
  title?: string;
  id?: string;
  testid?: string;
  icon?: Node;
  kbd?: string;
  short?: string;
  ariaLabel?: string;
}

/** A button with click sound. */
export function button(label: string, onClick: () => void, opts: ButtonOpts = {}): HTMLButtonElement {
  const cls = ['btn', opts.variant ?? '', opts.small ? 'small' : '', opts.block ? 'block' : ''].filter(Boolean).join(' ');
  const b = h('button', {
    type: 'button',
    class: cls,
    disabled: opts.disabled ?? false,
    title: opts.title,
    id: opts.id,
    'data-testid': opts.testid,
    'aria-label': opts.ariaLabel
  });
  if (opts.icon) b.append(opts.icon);
  if (opts.short) {
    b.append(h('span', { class: 'label-long' }, label), h('span', { class: 'label-short' }, opts.short));
  } else {
    b.append(h('span', {}, label));
  }
  if (opts.kbd) b.append(h('span', { class: 'kbd', 'aria-hidden': 'true' }, opts.kbd));
  b.addEventListener('click', () => {
    if (b.disabled) return;
    audio.unlock();
    audio.play('click');
    onClick();
  });
  return b;
}

export function segmented<T extends string>(options: { value: T; label: string }[], current: T, onChange: (v: T) => void, label: string): HTMLElement {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const render = (value: T) => {
    for (const b of Array.from(wrap.children)) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.value === value));
  };
  for (const o of options) {
    const b = h('button', { type: 'button', 'data-value': o.value, 'aria-pressed': String(o.value === current) }, o.label);
    b.addEventListener('click', () => {
      audio.unlock();
      audio.play('click');
      render(o.value);
      onChange(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function select<T extends string>(options: { value: T; label: string }[], current: T, onChange: (v: T) => void, ariaLabel?: string): HTMLSelectElement {
  const s = h('select', { class: 'input', 'aria-label': ariaLabel });
  for (const o of options) {
    const opt = h('option', { value: o.value }, o.label);
    if (o.value === current) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

/* ------------------------------------------------------------------ */
/* Toasts, modals, confirm                                             */
/* ------------------------------------------------------------------ */

let toastHost: HTMLElement | null = null;

export function toast(text: string, kind: '' | 'good' | 'bad' | 'big' = '', lifeMs = 2600): void {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.getElementById('app')?.append(toastHost);
  }
  const t = h('div', { class: `toast ${kind}`, style: `--toast-life:${lifeMs / 1000}s` }, text);
  toastHost.append(t);
  while (toastHost.children.length > 4) toastHost.firstElementChild?.remove();
  window.setTimeout(() => t.remove(), lifeMs + 400);
}

export interface ModalHandle {
  el: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  close: () => void;
}

const openModals: ModalHandle[] = [];

export function modal(title: string, opts: { wide?: boolean; narrow?: boolean; onClose?: () => void; testid?: string } = {}): ModalHandle {
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot' });
  const titleId = `m-${Math.random().toString(36).slice(2, 8)}`;
  const closeBtn = h('button', { type: 'button', class: 'btn ghost icon', 'aria-label': 'Close' }, '✕');
  const box = h(
    'div',
    { class: `modal ${opts.wide ? 'wide' : ''} ${opts.narrow ? 'narrow' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'data-testid': opts.testid },
    h('div', { class: 'modal-head' }, h('h2', { id: titleId }, title), closeBtn),
    body,
    foot
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  const previouslyFocused = document.activeElement as HTMLElement | null;
  let closed = false;
  const handle: ModalHandle = {
    el: backdrop,
    body,
    foot,
    close: () => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      const i = openModals.indexOf(handle);
      if (i >= 0) openModals.splice(i, 1);
      opts.onClose?.();
      previouslyFocused?.focus?.();
    }
  };
  closeBtn.addEventListener('click', handle.close);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) handle.close();
  });
  document.getElementById('app')?.append(backdrop);
  openModals.push(handle);
  window.setTimeout(() => {
    const first = box.querySelector<HTMLElement>('input, select, button:not(.ghost)');
    (first ?? closeBtn).focus();
  }, 30);
  return handle;
}

export function closeTopModal(): boolean {
  const top = openModals[openModals.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function closeAllModals(): void {
  for (const m of [...openModals]) m.close();
}

export function hasOpenModal(): boolean {
  return openModals.length > 0;
}

/** Promise-based confirmation dialog. */
export function confirmDialog(title: string, message: string, confirmLabel = 'Confirm', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal(title, {
      narrow: true,
      onClose: () => {
        if (!answered) resolve(false);
      }
    });
    m.body.append(h('p', { class: 'prose', style: 'margin:0' }, message));
    m.foot.append(
      button('Cancel', () => m.close(), { variant: 'ghost' }),
      button(
        confirmLabel,
        () => {
          answered = true;
          resolve(true);
          m.close();
        },
        { variant: danger ? 'danger' : 'primary', testid: 'confirm-ok' }
      )
    );
  });
}
