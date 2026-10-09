/**
 * Game screen: header with player cards, "Your empire" panel, the framed 3D
 * board with its action dock, and the title-deed panel. The event player turns
 * authoritative game events into animations before revealing the new state.
 * Works identically for solo (LocalSession) and LAN (RemoteSession).
 */
import {
  auctionMinBid,
  computeRent,
  currentBidder,
  describeTrade,
  findCard,
  getLegalActions,
  getSpace,
  groupSpaces,
  netWorth,
  ownedSpaces,
  ownsWholeGroup,
  pendingActors,
  rankPlayers,
  type Action,
  type GameEvent,
  type GameState,
  type LegalActions
} from '@pe/game-core';
import type { App } from '../app';
import type { GameSession, GameUpdate } from '../session/types';
import type { LanClient } from '../session/LanClient';
import { settings } from '../settings';
import { audio } from '../audio';
import { button, clear, closeTopModal, confirmDialog, h, hasOpenModal, modal, toast, type ModalHandle } from '../ui/dom';
import { money, plural, tokenIcon } from '../ui/format';
import { icon } from '../ui/icons';
import { propertyThumb, tint } from '../ui/art';
import { buildingLabel, deedView, spaceColor } from '../ui/deed';
import { ManageDialog } from '../ui/manageDialog';
import { openTradeDialog } from '../ui/tradeDialog';
import { settingsForm } from './settingsScreen';
import { howToContent } from './howto';
import { menuScreen } from './menu';
import { wait } from '../three/tween';
import { androidApp } from '../platform';

export interface GameScreenOptions {
  lan?: LanClient;
  onPlayAgain: () => void;
}

const PHASE_TEXT: Record<string, string> = {
  AWAIT_ROLL: 'Roll the dice',
  JAIL_DECISION: 'In Jail',
  PROPERTY_DECISION: 'Buy or auction',
  AUCTION: 'Auction in progress',
  DEBT_RESOLUTION: 'Raising funds',
  TRADE: 'Considering a trade',
  TURN_END: 'Finishing turn',
  GAME_OVER: 'Game over'
};

export function gameScreen(app: App, session: GameSession, opts: GameScreenOptions): () => void {
  const view = new GameView(app, session, opts);
  return () => view.dispose();
}

class GameView {
  private display: GameState;
  private queue: GameUpdate[] = [];
  private playing = false;
  private disposed = false;
  private offs: (() => void)[] = [];
  private manage: ManageDialog | null = null;
  private inspector: { handle: ModalHandle; index: number } | null = null;
  private resultsShown = false;
  private lastTurnPlayer = '';
  private readonly ctx;
  private readonly me: string;
  private bidValue = 0;
  /** Space the player picked on the board or in a list. */
  private pinned: number | null = null;
  /** Where the last token landed; shown when nothing is pinned. */
  private focusSpace: number;
  private highlightMine = false;
  private collapsed = new Set<string>();

  // DOM
  private shell = h('div', { class: 'game-shell', 'data-testid': 'game-hud' });
  private turnMeta = h('div', { class: 'turn-meta' });
  private turnWho = h('h1', { class: 'turn-who', 'data-testid': 'turn-banner' });
  private turnSub = h('div', { class: 'turn-sub' });
  private players = h('div', { class: 'pcards', role: 'list', 'aria-label': 'Players' });
  private eventText = h('span', { class: 'event-text' });
  private empireStats = h('div', { class: 'empire-stats' });
  private empireCount = h('span', { class: 'count-badge', 'aria-label': 'Properties owned' });
  private empireGroups = h('div', { class: 'empire-groups' });
  private highlightBtn: HTMLButtonElement;
  private boardCard = h('section', { class: 'board-card', 'aria-label': 'Game board' });
  private dockCard = h('div', { class: 'dock-card', 'data-testid': 'action-panel', 'aria-live': 'polite' });
  private deedPanel = h('aside', { class: 'deed-panel', 'data-testid': 'deed-panel', 'aria-label': 'Title deed' });
  private connBanner: HTMLElement | null = null;
  private btnRoll: HTMLButtonElement;
  private btnEnd: HTMLButtonElement;
  private btnProps: HTMLButtonElement;
  private btnTrade: HTMLButtonElement;
  private btnSave: HTMLButtonElement;

  constructor(
    private readonly app: App,
    private readonly session: GameSession,
    private readonly opts: GameScreenOptions
  ) {
    this.ctx = app.ctx;
    this.me = session.localPlayerId;
    this.display = session.state;
    this.lastTurnPlayer = this.display.turn.playerId;
    this.focusSpace = this.player(this.me)?.position ?? 0;
    const isLan = session.kind === 'lan';

    /* Header: turn title, player cards, latest event. */
    const iconBtn = (name: Parameters<typeof icon>[0], label: string, fn: () => void, testid?: string) => {
      const b = h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, 'data-testid': testid }, icon(name, 18));
      b.addEventListener('click', () => {
        audio.unlock();
        audio.play('click');
        fn();
      });
      return b;
    };
    const eventLine = h('button', { type: 'button', class: 'event-line', 'data-testid': 'btn-log', 'aria-label': 'Open the game log' }, h('span', { class: 'event-icon' }, icon('dice', 18)), this.eventText, h('span', { class: 'event-more' }, 'Game log', icon('chevron', 14)));
    eventLine.addEventListener('click', () => this.openLog());
    const header = h(
      'header',
      { class: 'gs-header' },
      h(
        'div',
        { class: 'gs-head-row' },
        h('div', { class: 'turn-title' }, this.turnMeta, this.turnWho, this.turnSub),
        this.players,
        h('div', { class: 'head-tools' }, iconBtn('sliders', 'Settings', () => this.openSettings()), iconBtn('help', 'How to play', () => this.openHowTo()))
      ),
      eventLine
    );

    /* Left: your empire. */
    this.highlightBtn = h('button', { type: 'button', class: 'toggle-btn', 'aria-pressed': 'false', 'data-testid': 'highlight-mine' }, h('span', { class: 'toggle-box' }, icon('check', 12)), 'Highlight mine on board');
    this.highlightBtn.addEventListener('click', () => {
      audio.play('click');
      this.highlightMine = !this.highlightMine;
      this.applyHighlights();
    });
    const browse = h('button', { type: 'button', class: 'link-btn', 'data-testid': 'browse-deeds' }, 'Browse all title deeds');
    browse.addEventListener('click', () => this.openAllDeeds());
    const empire = h(
      'aside',
      { class: 'empire-card', 'aria-label': 'Your properties' },
      h('div', { class: 'empire-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Your empire'), h('h2', {}, 'Your properties')), this.empireCount),
      this.empireStats,
      this.highlightBtn,
      this.empireGroups,
      h('div', { class: 'empire-foot' }, browse)
    );

    this.btnProps = button('Properties', () => this.openManage(), { testid: 'btn-properties', icon: icon('list'), short: 'Props' });
    this.btnTrade = button('Trade', () => this.openTrade(), { variant: 'primary', testid: 'btn-trade', icon: icon('trade') });
    this.btnSave = button(
      'Save game',
      () => void this.session.save().then((msg) => toast(msg, /Could not|Only/.test(msg) ? 'bad' : 'good')),
      { testid: 'btn-save', icon: icon('save'), short: 'Save', disabled: isLan && !session.isHost }
    );
    const btnMenu = button('Game menu', () => this.openMenu(), { testid: 'open-menu', icon: icon('pause'), short: 'Menu' });
    const actions = h(
      'div',
      { class: 'gs-actions', role: 'toolbar', 'aria-label': 'Game actions' },
      h('div', { class: 'action-grid' }, this.btnProps, this.btnTrade, this.btnSave, btnMenu),
      h('p', { class: 'action-hint' }, 'Trade properties, cash or jail cards.')
    );

    /* Center: the board with its overlays. */
    this.btnRoll = button('Roll dice', () => this.act({ type: 'ROLL' }), { variant: 'primary', testid: 'btn-roll', icon: icon('dice'), title: 'Roll dice (Space)' });
    this.btnEnd = button('End turn', () => this.act({ type: 'END_TURN' }), { testid: 'btn-end-turn', title: 'End turn (E)' });
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const tool = (name: Parameters<typeof icon>[0], label: string, fn: () => void, testid?: string) => iconBtn(name, label, fn, testid);
    this.boardCard.append(
      h('div', { class: 'board-hint' }, coarse ? 'Drag to rotate · Pinch to zoom' : 'Drag to rotate · Scroll or pinch to zoom'),
      h(
        'div',
        { class: 'board-tools', role: 'group', 'aria-label': 'Camera' },
        tool('plus', 'Zoom in', () => app.renderer?.zoomBy(0.85)),
        tool('minus', 'Zoom out', () => app.renderer?.zoomBy(1.18)),
        tool('reset', 'Reset camera', () => void app.renderer?.resetCamera(this.ms(500)), 'camera-reset')
      ),
      h('div', { class: 'board-dock' }, this.dockCard, h('div', { class: 'dock-buttons' }, this.btnRoll, this.btnEnd))
    );

    const footer = h(
      'footer',
      { class: 'gs-footer' },
      h('span', {}, 'Made for game night.'),
      h('span', { class: 'keys' }, 'Space roll · E end turn · P properties · T trade · L log'),
      h('span', {}, isLan ? (session.isHost ? 'Saved on this computer while you host.' : 'Saved by the host.') : androidApp ? 'Saved automatically on this device.' : 'Saved automatically in this browser.')
    );

    this.shell.append(header, empire, actions, this.boardCard, this.deedPanel, footer);
    // Android back button: open the pause menu (a second press closes it).
    app.backHandler = () => this.openMenu();
    const myColor = this.player(this.me)?.color;
    if (myColor && /^#[0-9a-f]{3,8}$/i.test(myColor)) this.shell.style.setProperty('--me', myColor);
    app.root.append(this.shell);
    // The shared 3D canvas moves into the board card for the length of the game.
    app.stage.classList.add('in-board');
    this.boardCard.prepend(app.stage);

    const r = app.ensureRenderer();
    if (r) {
      r.setAttract(false);
      r.setSelected(null);
      r.setHighlights([]);
      r.syncState(this.display);
      r.dice.show(this.display.turn.dice ?? [5, 2]);
      this.applyInsets();
      void r.resetCamera(0);
      r.setTileClickHandler((i) => this.inspect(i));
    } else {
      this.boardCard.append(h('div', { class: 'board-error' }, h('h3', {}, '3D board unavailable'), h('p', {}, app.rendererError ?? 'WebGL is not available in this browser.')));
    }

    this.offs.push(
      session.onUpdate((u) => this.enqueue(u)),
      session.onError((m) => {
        audio.play('error');
        toast(m, 'bad', 3200);
      })
    );
    if (opts.lan) {
      const lan = opts.lan;
      this.offs.push(
        lan.statusChanged.on((s) => this.setConnection(s === 'open' ? null : s === 'reconnecting' ? 'Connection to the host lost. Reconnecting...' : 'Disconnected from the host.')),
        lan.notices.on((m) => toast(m)),
        lan.rejected.on((m) => {
          toast(m, 'bad', 5000);
          this.setConnection(`${m} Return to the menu to continue.`);
        })
      );
    }
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.offs.push(() => window.removeEventListener('keydown', onKey));
    const ro = new ResizeObserver(() => this.applyInsets());
    ro.observe(this.boardCard);
    ro.observe(header);
    this.offs.push(() => ro.disconnect());

    if (app.e2e) {
      (window as unknown as Record<string, unknown>).__pe = {
        state: () => this.session.state,
        display: () => this.display,
        me: this.me,
        busy: () => this.playing || this.queue.length > 0,
        legal: () => getLegalActions(this.display, this.me, this.ctx),
        act: (a: Action) => this.session.dispatch(a),
        tileScreenPos: (i: number) => this.app.renderer?.screenPosition(i)
      };
    }

    this.render();
    toast(this.display.turn.playerId === this.me ? 'Your turn! Roll the dice.' : `${this.nameOf(this.display.turn.playerId)} goes first.`, 'big', 2400);
    if (this.display.phase === 'GAME_OVER') this.showResults();
    session.notifyIdle();
  }

  dispose(): void {
    this.disposed = true;
    for (const o of this.offs) o();
    this.manage?.close();
    this.session.dispose();
    if (this.opts.lan && this.display.phase === 'GAME_OVER') this.opts.lan.leave();
    this.app.renderer?.setHighlights([]);
    this.app.renderer?.setSelected(null);
    this.app.renderer?.setTileClickHandler(undefined);
    this.app.renderer?.setInsets({ left: 0, right: 0, top: 0, bottom: 0 });
    // Give the canvas back to the full-screen menu background.
    this.app.stage.classList.remove('in-board');
    this.app.root.parentElement?.insertBefore(this.app.stage, this.app.root);
    document.documentElement.style.removeProperty('--toast-top');
    if (this.app.e2e) delete (window as unknown as Record<string, unknown>).__pe;
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                              */
  /* ------------------------------------------------------------------ */

  private ms(base: number): number {
    const scale = settings.animationScale();
    const backlog = this.queue.length > 2 ? 0.35 : 1;
    return this.app.e2e ? 0 : base * scale * backlog;
  }

  private nameOf(id: string | null | undefined): string {
    if (!id) return 'the Bank';
    if (id === this.me) return 'You';
    return this.display.players.find((p) => p.id === id)?.name ?? 'Someone';
  }

  private player(id: string) {
    return this.display.players.find((p) => p.id === id);
  }

  private act(action: Action): void {
    if (this.playing) return;
    audio.unlock();
    this.session.dispatch(action);
  }

  private isPhoneLayout(): boolean {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    return w <= 720 || (hgt <= 560 && w <= 1000);
  }

  /** Keep the board centred in the visible part of the board card (above the dock). */
  private applyInsets(): void {
    const r = this.app.renderer;
    const rect = this.boardCard.getBoundingClientRect();
    document.documentElement.style.setProperty('--toast-top', `${Math.round(rect.top + 56)}px`);
    if (!r) return;
    const phone = this.isPhoneLayout();
    const portrait = rect.height > rect.width * 1.15;
    const dock = this.boardCard.querySelector<HTMLElement>('.dock-buttons')?.offsetHeight ?? 52;
    // Tall phone screens: look more from above, square-on, so the board fills the width.
    if (phone && portrait) r.setInsets({ left: 0, right: 0, top: 4, bottom: dock + 12 }, 0.42, 0);
    else if (phone) r.setInsets({ left: 0, right: 0, top: 0, bottom: dock + 6 }, 0.8);
    else r.setInsets({ left: 0, right: 0, top: 24, bottom: dock + 20 }, 0.8);
  }

  private setConnection(text: string | null): void {
    this.connBanner?.remove();
    this.connBanner = null;
    if (!text) return;
    this.connBanner = h('div', { class: 'connection-banner', role: 'status', 'data-testid': 'connection-banner' }, h('div', { class: 'spinner small' }), text);
    this.boardCard.append(this.connBanner);
  }

  /* ------------------------------------------------------------------ */
  /* Event playback                                                       */
  /* ------------------------------------------------------------------ */

  private enqueue(u: GameUpdate): void {
    this.queue.push(u);
    if (!this.playing) void this.drain();
  }

  private async drain(): Promise<void> {
    this.playing = true;
    this.render();
    while (this.queue.length && !this.disposed) {
      const u = this.queue.shift() as GameUpdate;
      try {
        if (!u.snapshot) {
          for (const e of u.events) {
            if (this.disposed) return;
            await this.animate(e, u.state);
          }
        }
      } catch (err) {
        console.error('Animation error', err);
      }
      this.display = u.state;
      this.app.renderer?.syncState(this.display);
      if (this.queue.length) this.render();
    }
    this.playing = false;
    if (this.disposed) return;
    this.render();
    this.manage?.update(this.display);
    this.refreshInspector();
    if (this.display.phase === 'GAME_OVER') this.showResults();
    else this.session.notifyIdle();
  }

  private async animate(e: GameEvent, next: GameState): Promise<void> {
    const r = this.app.renderer;
    const color = (id: string) => next.players.find((p) => p.id === id)?.color ?? '#888';
    switch (e.type) {
      case 'TURN_STARTED':
        if (e.playerId !== this.lastTurnPlayer || e.playerId === this.me) {
          this.turnWho.classList.remove('flash');
          void this.turnWho.offsetWidth;
          this.turnWho.classList.add('flash');
        }
        this.lastTurnPlayer = e.playerId;
        if (e.playerId === this.me) {
          audio.play('turn');
          toast('Your turn!', 'good', 1800);
        }
        break;
      case 'DICE_ROLLED':
        audio.play('dice');
        this.eventText.textContent = `${this.nameOf(e.playerId)} ${e.playerId === this.me ? 'roll' : 'rolls'} ${e.dice[0]} + ${e.dice[1]}${e.doubles ? ' (doubles)' : ''}.`;
        await r?.rollDice(e.dice, this.ms(1200));
        if (e.doubles && !e.inJail) toast(`${this.nameOf(e.playerId)} rolled doubles!`, '', 1600);
        break;
      case 'MOVED': {
        const jail = this.ctx.board.spaces.findIndex((s) => s.type === 'jail');
        await r?.animateMove(e.playerId, e.from, e.to, e.steps, e.direct, this.ms(170), e.direct && e.to === jail, () => audio.play('step'));
        this.focusSpace = e.to;
        break;
      }
      case 'MONEY':
        this.floatMoney(e.from, -e.amount);
        this.floatMoney(e.to, e.amount);
        if (e.to === this.me) audio.play('coin');
        else if (e.from === this.me) audio.play('pay');
        if (e.reason === 'Passed GO') toast(`${this.nameOf(e.to)} passed GO: +${money(e.amount)}`, e.to === this.me ? 'good' : '', 1800);
        break;
      case 'RENT_PAID':
        toast(`${this.nameOf(e.from)} ${e.from === this.me ? 'pay' : 'pays'} ${money(e.amount)} rent to ${this.nameOf(e.to)}`, e.to === this.me ? 'good' : e.from === this.me ? 'bad' : '', 2400);
        await wait(this.ms(250));
        break;
      case 'TAX_PAID':
        toast(`${this.nameOf(e.playerId)} ${e.playerId === this.me ? 'pay' : 'pays'} ${money(e.amount)} ${getSpace(this.ctx, e.space).name}`, e.playerId === this.me ? 'bad' : '');
        break;
      case 'CARD_DRAWN':
        audio.play('card');
        await this.showCard(e.deck, e.cardId, e.playerId);
        break;
      case 'PROPERTY_BOUGHT':
      case 'AUCTION_WON':
        audio.play('buy');
        r?.syncOwnership(next);
        if (this.ms(1) > 0) r?.burst(e.space, color(e.playerId));
        toast(`${this.nameOf(e.playerId)} ${e.type === 'AUCTION_WON' ? 'won' : 'bought'} ${getSpace(this.ctx, e.space).name} for ${money(e.type === 'AUCTION_WON' ? e.amount : e.price)}`, e.playerId === this.me ? 'good' : '');
        await wait(this.ms(350));
        break;
      case 'AUCTION_STARTED':
        audio.play('auction');
        toast(`Auction: ${getSpace(this.ctx, e.space).name}`, 'big', 2000);
        break;
      case 'AUCTION_UNSOLD':
        toast(`No bids: ${getSpace(this.ctx, e.space).name} stays with the Bank`);
        break;
      case 'BID_PLACED':
        if (e.playerId !== this.me) toast(`${this.nameOf(e.playerId)} bids ${money(e.amount)}`, '', 1400);
        await wait(this.ms(150));
        break;
      case 'BUILT':
        audio.play('build');
        await r?.setBuildings(e.space, e.houses, this.ms(1) > 0, this.ms(320));
        break;
      case 'BUILDING_SOLD':
        await r?.setBuildings(e.space, e.houses, false);
        break;
      case 'MORTGAGED':
      case 'UNMORTGAGED':
        r?.syncOwnership(next);
        toast(`${this.nameOf(e.playerId)} ${e.type === 'MORTGAGED' ? 'mortgaged' : 'lifted the mortgage on'} ${getSpace(this.ctx, e.space).name}`);
        break;
      case 'PROPERTY_TRANSFERRED':
        r?.syncOwnership(next);
        break;
      case 'SENT_TO_JAIL':
        audio.play('jail');
        toast(`${this.nameOf(e.playerId)} ${e.playerId === this.me ? 'go' : 'goes'} to Jail!`, e.playerId === this.me ? 'bad' : 'big', 2200);
        break;
      case 'LEFT_JAIL':
        toast(`${this.nameOf(e.playerId)} ${e.playerId === this.me ? 'are' : 'is'} out of Jail`);
        break;
      case 'JAIL_ROLL_FAILED':
        toast(`No doubles: ${this.nameOf(e.playerId)} ${e.playerId === this.me ? 'stay' : 'stays'} in Jail (attempt ${e.attempt})`);
        break;
      case 'JACKPOT':
        toast(`${this.nameOf(e.playerId)} won the ${money(e.amount)} jackpot!`, 'good', 2600);
        break;
      case 'DEBT_CREATED':
        if (e.debtorId === this.me) {
          audio.play('error');
          toast(`You owe ${money(e.amount)}. Sell, mortgage or trade to raise funds.`, 'bad', 3600);
        }
        break;
      case 'TRADE_PROPOSED':
        if (e.toId === this.me) {
          audio.play('card');
          toast(`${this.nameOf(e.fromId)} sent you a ${e.counter ? 'counter' : 'trade '}offer`, 'big', 2600);
        } else if (e.fromId !== this.me) toast(`${this.nameOf(e.fromId)} offers a trade to ${this.nameOf(e.toId)}`);
        break;
      case 'TRADE_ACCEPTED':
        audio.play('buy');
        toast(`Trade completed between ${this.nameOf(e.fromId)} and ${this.nameOf(e.toId)}`, 'good');
        break;
      case 'TRADE_REJECTED':
        toast(`${this.nameOf(e.toId)} ${e.toId === this.me ? 'reject' : 'rejected'} the trade`, e.fromId === this.me ? 'bad' : '');
        break;
      case 'TRADE_CANCELLED':
        toast('Trade offer withdrawn');
        break;
      case 'BANKRUPT': {
        audio.play('bankrupt');
        const banner = h('div', { class: 'overlay-banner', role: 'status' }, `${this.nameOf(e.playerId)} ${e.playerId === this.me ? 'are' : 'is'} bankrupt!`);
        this.boardCard.append(banner);
        window.setTimeout(() => banner.remove(), 2800);
        await wait(this.ms(600));
        break;
      }
      case 'GAME_OVER':
        if (e.winnerId === this.me) audio.play('win');
        break;
      default:
        break;
    }
  }

  private floatMoney(party: string, amount: number): void {
    if (party === 'bank') return;
    const card = this.players.querySelector<HTMLElement>(`[data-player="${CSS.escape(party)}"]`);
    if (!card) return;
    const f = h('span', { class: `money-float ${amount >= 0 ? 'plus' : 'minus'}` }, `${amount >= 0 ? '+' : '−'}${money(Math.abs(amount))}`);
    card.append(f);
    window.setTimeout(() => f.remove(), 1500);
  }

  private showCard(deck: 'chance' | 'community', cardId: string, playerId: string): Promise<void> {
    const found = findCard(this.ctx, cardId);
    if (!found) return Promise.resolve();
    const popup = h(
      'div',
      { class: `card-popup ${deck}`, role: 'dialog', 'aria-label': 'Card drawn', 'data-testid': 'card-popup' },
      h('div', { class: 'card-mark', 'aria-hidden': 'true' }, deck === 'chance' ? '?' : '♥'),
      h('div', { class: 'deck' }, `${deck === 'chance' ? 'Fortune' : 'Community Fund'} · ${this.nameOf(playerId)}`),
      h('h3', {}, found.card.title),
      h('p', {}, found.card.text)
    );
    this.boardCard.append(popup);
    const hold = this.ms(2000);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      popup.addEventListener('click', () => {
        popup.remove();
        finish();
      });
      if (hold <= 0) {
        // Reduced motion: keep the card visible briefly but never block play or board taps.
        popup.style.pointerEvents = 'none';
        window.setTimeout(() => popup.remove(), 2600);
        finish();
      } else {
        window.setTimeout(() => {
          popup.remove();
          finish();
        }, hold + 300);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                            */
  /* ------------------------------------------------------------------ */

  private render(): void {
    const st = this.display;
    const legal = this.playing ? null : getLegalActions(st, this.me, this.ctx);
    this.renderHeader(st);
    this.renderPlayers(st);
    this.renderEmpire(st);
    // While events play out, keep the current dock content instead of flashing it away.
    if (!this.playing || this.dockCard.hidden) this.renderDock(st, legal);
    this.renderDeed(st, legal);
    this.btnRoll.disabled = !legal?.canRoll;
    this.btnEnd.disabled = !legal?.canEndTurn;
    this.btnTrade.disabled = !legal?.canProposeTrade;
    this.btnProps.disabled = false;
    if (!this.manage) this.applyHighlights();
  }

  /** Rounds played, capped at the limit (the counter passes it when a round-limited game ends). */
  private roundOf(st: GameState): number {
    return st.config.maxRounds ? Math.min(st.round, st.config.maxRounds) : st.round;
  }

  private renderHeader(st: GameState): void {
    const cur = this.player(st.turn.playerId);
    this.turnMeta.textContent = `Turn ${Math.max(1, st.turn.number)} · Round ${this.roundOf(st)}${st.config.maxRounds ? ` of ${st.config.maxRounds}` : ''}`;
    this.turnWho.textContent = st.phase === 'GAME_OVER' ? 'Game over' : cur?.id === this.me ? 'Your turn' : `${cur?.name ?? ''}’s turn`;
    let what = PHASE_TEXT[st.phase] ?? '';
    if (st.phase === 'AWAIT_ROLL' && st.turn.extraRoll) what = 'Doubles! Roll again';
    if (st.phase === 'AUCTION' && st.auction) what = `Auction: ${getSpace(this.ctx, st.auction.space).shortName}`;
    if (st.phase === 'DEBT_RESOLUTION' && st.debts[0]) what = `${this.nameOf(st.debts[0].debtorId)} must raise ${money(st.debts[0].amount)}`;
    if (st.phase === 'GAME_OVER') what = st.winnerId ? `${this.nameOf(st.winnerId)} ${st.winnerId === this.me ? 'win' : 'wins'}!` : 'Game over';
    const mode = this.session.kind === 'lan' ? 'LAN game' : 'Solo with bots';
    this.turnSub.textContent = `${mode} · ${what}`;
    // Latest real happening; "Turn 12: Ada's turn." headers are already shown above.
    let last = st.log[st.log.length - 1];
    for (let i = st.log.length - 1; i >= Math.max(0, st.log.length - 4); i--) {
      const entry = st.log[i];
      if (entry && !/^Turn \d+:/.test(entry.text)) {
        last = entry;
        break;
      }
    }
    if (!this.playing || !this.eventText.textContent) this.eventText.textContent = last?.text ?? 'The game begins. Good luck!';
  }

  private renderPlayers(st: GameState): void {
    clear(this.players);
    const actors = new Set(pendingActors(st));
    for (const p of st.players) {
      const deeds = ownedSpaces(st, p.id).length;
      const role = p.kind === 'bot' ? `${p.difficulty ?? ''} bot`.trim() : p.id === this.me ? 'You' : 'Player';
      const notes = [p.bankrupt ? 'Bankrupt' : null, p.inJail ? 'In Jail' : null, !p.connected && p.kind === 'human' ? 'Offline' : null, p.jailCards.length ? `${p.jailCards.length} jail card` : null].filter(Boolean);
      const active = st.turn.playerId === p.id && st.phase !== 'GAME_OVER';
      const card = h(
        'button',
        {
          type: 'button',
          role: 'listitem',
          class: `pcard ${active ? 'active' : ''} ${p.bankrupt ? 'bankrupt' : ''} ${actors.has(p.id) ? 'acting' : ''}`,
          style: `--pc:${p.color};--pc-soft:${tint(p.color, 0.82)}`,
          'data-player': p.id,
          'aria-label': `${p.name}, ${money(p.cash)}, ${plural(deeds, 'deed')}${actors.has(p.id) ? ', acting now' : ''}`
        },
        h('span', { class: 'pcard-icon' }, tokenIcon(p.token, '#ffffff', 20)),
        h('span', { class: 'pcard-main' }, h('span', { class: 'pname' }, p.name), h('span', { class: 'psub' }, [role, ...notes].join(' · '))),
        h('span', { class: 'pcard-side' }, h('span', { class: 'cash' }, money(p.cash)), h('span', { class: 'deeds' }, plural(deeds, 'deed')))
      );
      card.addEventListener('click', () => this.openManage(p.id));
      this.players.append(card);
    }
  }

  private renderEmpire(st: GameState): void {
    const meP = this.player(this.me);
    const mine = ownedSpaces(st, this.me);
    this.empireCount.textContent = String(mine.length);
    clear(this.empireStats);
    this.empireStats.append(
      h('div', {}, h('span', { class: 'label' }, 'Your cash'), h('span', { class: 'value' }, money(meP?.cash ?? 0))),
      h('div', {}, h('span', { class: 'label' }, 'Total net worth'), h('span', { class: 'value' }, money(meP ? netWorth(st, this.ctx, this.me) : 0)))
    );
    const scroll = this.empireGroups.scrollTop;
    clear(this.empireGroups);
    if (!mine.length) {
      this.empireGroups.append(h('div', { class: 'empire-empty' }, h('div', { class: 'empty-art', 'aria-hidden': 'true' }, icon('house', 26)), h('p', {}, 'No properties yet.'), h('p', { class: 'muted' }, 'Land on a free space and buy it to start your empire.')));
      return;
    }
    const dice = st.turn.dice ? st.turn.dice[0] + st.turn.dice[1] : 7;
    for (const g of this.ctx.board.groups) {
      const members = groupSpaces(this.ctx, g.id);
      const owned = members.filter((i) => st.properties[i]?.owner === this.me);
      if (!owned.length) continue;
      const open = !this.collapsed.has(g.id);
      const full = owned.length === members.length;
      const head = h(
        'button',
        { type: 'button', class: 'egroup-head', 'aria-expanded': String(open) },
        h('i', { class: 'gbar', style: `background:${g.color}` }),
        h('span', { class: 'gname' }, g.name),
        full ? h('span', { class: 'gfull', title: 'Complete set' }, icon('check', 12)) : null,
        h('span', { class: 'gcount' }, `${owned.length}/${members.length}`),
        icon('chevron', 14)
      );
      head.addEventListener('click', () => {
        if (this.collapsed.has(g.id)) this.collapsed.delete(g.id);
        else this.collapsed.add(g.id);
        this.renderEmpire(this.display);
      });
      const rows = h('div', { class: 'egroup-rows' });
      if (open) {
        for (const i of owned) {
          const s = getSpace(this.ctx, i);
          const prop = st.properties[i];
          const houses = prop?.houses ?? 0;
          let status = s.type === 'transport' ? 'Transit' : s.type === 'utility' ? 'Utility' : houses > 0 ? buildingLabel(houses) : s.group && ownsWholeGroup(st, this.ctx, this.me, s.group) ? 'Full set · rent doubled' : 'No buildings';
          if (prop?.mortgaged) status = 'Mortgaged';
          const rent = prop?.mortgaged ? '—' : s.type === 'utility' ? `${s.rent?.[full ? 1 : 0] ?? 0}× dice` : money(computeRent(st, this.ctx, i, dice));
          const row = h(
            'button',
            { type: 'button', class: `erow ${prop?.mortgaged ? 'mortgaged' : ''} ${this.deedIndex(st) === i ? 'selected' : ''}`, 'data-space': i, 'aria-label': `${s.name}, ${status}` },
            propertyThumb(s, g.color, houses),
            h('span', { class: 'erow-main' }, h('span', { class: 'erow-name' }, s.name), h('span', { class: `erow-status ${prop?.mortgaged ? 'warn' : ''}` }, status)),
            h('span', { class: 'erow-rent', title: 'Rent now' }, rent)
          );
          row.addEventListener('click', () => this.inspect(i));
          rows.append(row);
        }
      }
      this.empireGroups.append(h('div', { class: `egroup ${open ? 'open' : ''}`, 'data-group': g.id }, head, rows));
    }
    this.empireGroups.scrollTop = scroll;
  }

  private waiting(text: string): HTMLElement {
    return h('div', { class: 'waiting' }, h('div', { class: 'spinner small' }), text);
  }

  private dock(title: string | null, text: string | null, ...rest: (HTMLElement | null)[]): void {
    if (title) this.dockCard.append(h('h3', {}, title));
    if (text) this.dockCard.append(h('p', {}, text));
    for (const r of rest) if (r) this.dockCard.append(r);
  }

  private renderDock(st: GameState, legal: LegalActions | null): void {
    clear(this.dockCard);
    this.fillDock(st, legal);
    this.dockCard.hidden = this.dockCard.childElementCount === 0;
    this.dockCard.classList.toggle('compact', this.dockCard.childElementCount === 1 && !!this.dockCard.firstElementChild?.classList.contains('waiting'));
  }

  private fillDock(st: GameState, legal: LegalActions | null): void {
    if (st.phase === 'GAME_OVER') {
      this.dock('Game over', st.endReason ?? '', h('div', { class: 'actions' }, button('Show results', () => this.showResults(true), { variant: 'primary' })));
      return;
    }
    const meP = this.player(this.me);
    if (meP?.bankrupt) {
      this.dock('You are bankrupt', 'You can keep watching until the game ends.');
      return;
    }
    const actors = pendingActors(st);
    const actorName = this.nameOf(actors[0]);
    const actorIsBot = actors[0] ? this.player(actors[0])?.kind === 'bot' : false;
    if (!legal) {
      if (st.turn.playerId !== this.me) this.dock(null, null, this.waiting(actorIsBot ? `${actorName} is playing...` : `${actorName}’s move...`));
      return;
    }

    switch (st.phase) {
      case 'PROPERTY_DECISION': {
        const space = st.pendingPurchase as number;
        const s = getSpace(this.ctx, space);
        if (st.turn.playerId !== this.me) {
          this.dock(null, null, this.waiting(`${actorName} is deciding whether to buy ${s.name}`));
          return;
        }
        const acts = h('div', { class: 'actions' });
        acts.append(button(`Buy for ${money(s.price ?? 0)}`, () => this.act({ type: 'BUY' }), { variant: 'primary', disabled: !legal.canBuy, kbd: 'B', testid: 'btn-buy' }));
        acts.append(button(st.config.auctions ? 'Auction' : 'Decline', () => this.act({ type: 'DECLINE' }), { kbd: 'A', testid: 'btn-auction' }));
        if (!legal.canBuy) acts.append(button('Raise funds', () => this.openManage(), { small: true }));
        const swatch = h('i', { class: 'dock-swatch', style: `background:${spaceColor(this.ctx, s)}` });
        this.dockCard.append(h('h3', {}, swatch, `Buy ${s.name}?`));
        this.dock(
          null,
          legal.canBuy
            ? `Price ${money(s.price ?? 0)} · you have ${money(meP?.cash ?? 0)}.${st.config.auctions ? ' Pass and it goes to auction.' : ''}`
            : `You need ${money((s.price ?? 0) - (meP?.cash ?? 0))} more. Mortgage or sell to raise funds, or let it go to auction.`,
          acts
        );
        return;
      }
      case 'AUCTION': {
        const a = st.auction;
        if (!a) return;
        const s = getSpace(this.ctx, a.space);
        const bidder = currentBidder(st);
        this.dock(
          `Auction: ${s.name}`,
          a.highestBidderId ? `Highest bid ${money(a.highestBid)} by ${this.nameOf(a.highestBidderId)}` : 'No bids yet. Minimum bid $1.',
          h('div', { class: 'row bidders' }, ...a.bidders.map((id) => h('span', { class: `badge ${id === bidder ? 'blue' : ''}` }, this.nameOf(id))))
        );
        if (legal.canPassBid) {
          const min = auctionMinBid(st);
          const max = meP?.cash ?? 0;
          if (this.bidValue < min || this.bidValue > max) this.bidValue = Math.min(max, Math.max(min, Math.round(((s.price ?? 0) * 0.5) / 10) * 10));
          const input = h('input', { class: 'input', type: 'number', min, max, value: this.bidValue, inputmode: 'numeric', 'aria-label': 'Your bid', 'data-testid': 'bid-input' });
          input.addEventListener('input', () => (this.bidValue = Math.floor(Number(input.value) || 0)));
          input.title = `You can bid ${money(min)} to ${money(max)}`;
          const quick = h(
            'div',
            { class: 'row bid-quick' },
            ...[1, 10, 50, 100].map((inc) =>
              button(
                `+${inc}`,
                () => {
                  this.bidValue = Math.min(max, Math.max(min, (a.highestBidderId ? a.highestBid : 0) + inc));
                  input.value = String(this.bidValue);
                },
                { small: true, disabled: (a.highestBidderId ? a.highestBid : 0) + inc > max }
              )
            )
          );
          this.dock(
            null,
            null,
            quick,
            h(
              'div',
              { class: 'bid-row' },
              input,
              button('Place bid', () => this.act({ type: 'BID', amount: this.bidValue }), { variant: 'primary', disabled: !legal.bid, testid: 'btn-bid' }),
              button('Pass', () => this.act({ type: 'PASS_BID' }), { testid: 'btn-pass' })
            ),
            h('p', { class: 'bid-hint' }, `You can bid ${money(min)} to ${money(max)}.`)
          );
        } else this.dock(null, null, this.waiting(`${this.nameOf(bidder)} ${actorIsBot ? 'is thinking...' : 'is bidding...'}`));
        return;
      }
      case 'DEBT_RESOLUTION': {
        const d = st.debts[0];
        if (!d) return;
        if (d.debtorId !== this.me) {
          this.dock(null, null, this.waiting(`${this.nameOf(d.debtorId)} is raising ${money(d.amount)}`));
          return;
        }
        const short = Math.max(0, d.amount - (meP?.cash ?? 0));
        this.dock(
          `You owe ${money(d.amount)}`,
          `To ${this.nameOf(d.creditorId)} (${d.reason}). ${short ? `You need ${money(short)} more: sell buildings, mortgage property or trade.` : 'You can pay now.'}`,
          h(
            'div',
            { class: 'actions' },
            button(`Pay ${money(d.amount)}`, () => this.act({ type: 'PAY_DEBT' }), { variant: 'primary', disabled: !legal.canPayDebt, testid: 'btn-pay-debt' }),
            button('Manage', () => this.openManage(), {}),
            button('Trade', () => this.openTrade(), { disabled: !legal.canProposeTrade }),
            button(
              'Declare bankruptcy',
              () => {
                const go = () => this.act({ type: 'DECLARE_BANKRUPTCY' });
                if (settings.get().confirmDestructive) void confirmDialog('Declare bankruptcy?', `You will leave the game and your assets go to ${this.nameOf(d.creditorId)}.`, 'Declare bankruptcy', true).then((y) => y && go());
                else go();
              },
              { variant: 'danger', disabled: !legal.canDeclareBankruptcy, testid: 'btn-bankrupt' }
            )
          )
        );
        return;
      }
      case 'TRADE': {
        const t = st.trade;
        if (!t) return;
        const desc = describeTrade(st, this.ctx, t);
        const summary = (gives: string[], gets: string[], fromName: string, toName: string) =>
          h('div', { class: 'trade-summary' }, h('div', {}, h('b', {}, `${fromName} give${fromName === 'You' ? '' : 's'}`), gives.join(', ') || 'Nothing'), h('div', {}, h('b', {}, `${toName} give${toName === 'You' ? '' : 's'}`), gets.join(', ') || 'Nothing'));
        if (t.toId === this.me) {
          this.dock(
            `Trade offer from ${this.nameOf(t.fromId)}`,
            null,
            summary(desc.gives, desc.gets, this.nameOf(t.fromId), 'You'),
            h(
              'div',
              { class: 'actions' },
              button('Accept', () => this.act({ type: 'ACCEPT_TRADE' }), { variant: 'primary', testid: 'btn-accept-trade' }),
              button('Counteroffer', () => openTradeDialog({ ctx: this.ctx, me: this.me, getState: () => this.display, dispatch: (a) => this.act(a) }, { counter: t }), { disabled: t.counterCount >= 3 }),
              button('Reject', () => this.act({ type: 'REJECT_TRADE' }), { variant: 'danger', testid: 'btn-reject-trade' })
            )
          );
        } else if (t.fromId === this.me) {
          this.dock('Your trade offer', null, summary(desc.gives, desc.gets, 'You', this.nameOf(t.toId)), this.waiting(`Waiting for ${this.nameOf(t.toId)}...`), h('div', { class: 'actions' }, button('Withdraw offer', () => this.act({ type: 'CANCEL_TRADE' }), { testid: 'btn-cancel-trade' })));
        } else this.dock(null, null, this.waiting(`${this.nameOf(t.toId)} is considering a trade from ${this.nameOf(t.fromId)}`));
        return;
      }
      case 'JAIL_DECISION': {
        if (st.turn.playerId !== this.me) {
          this.dock(null, null, this.waiting(`${actorName} is in Jail and deciding what to do`));
          return;
        }
        this.dock(
          'You are in Jail',
          `Attempt ${(meP?.jailTurns ?? 0) + 1} of ${st.config.maxJailTurns}. Roll doubles to get out free, pay ${money(st.config.jailFine)}, or use a card.`,
          h(
            'div',
            { class: 'actions' },
            button('Roll for doubles', () => this.act({ type: 'ROLL' }), { variant: 'primary', disabled: !legal.canRoll, testid: 'btn-jail-roll' }),
            button(`Pay ${money(st.config.jailFine)}`, () => this.act({ type: 'PAY_JAIL_FINE' }), { disabled: !legal.canPayJailFine, testid: 'btn-pay-fine' }),
            legal.canUseJailCard ? button('Use jail card', () => this.act({ type: 'USE_JAIL_CARD' }), { testid: 'btn-use-card' }) : null
          )
        );
        return;
      }
      case 'AWAIT_ROLL':
      case 'TURN_END': {
        if (st.turn.playerId !== this.me) {
          this.dock(null, null, this.waiting(actorIsBot ? `${actorName} is playing...` : `Waiting for ${actorName}...`));
          return;
        }
        const extras = h('div', { class: 'actions' });
        if (legal.buildable.length) extras.append(button(`Build (${legal.buildable.length})`, () => this.openManage(), { small: true, icon: icon('house', 16) }));
        if (legal.unmortgageable.length) extras.append(button('Lift mortgages', () => this.openManage(), { small: true }));
        const hasExtras = extras.childElementCount > 0;
        if (st.phase === 'AWAIT_ROLL') {
          if (st.turn.extraRoll) this.dock('Doubles! Roll again', hasExtras ? 'You can build before rolling.' : null, hasExtras ? extras : null);
          else if (hasExtras) this.dock(null, 'You can build before rolling.', extras);
        } else this.dock(null, 'Build, trade or manage your properties, then end your turn.', hasExtras ? extras : null);
        return;
      }
      default:
        return;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Title deed                                                           */
  /* ------------------------------------------------------------------ */

  /** The space a decision is pending on, if any. */
  private decisionSpace(st: GameState): number | null {
    if (st.phase === 'PROPERTY_DECISION' && st.pendingPurchase !== null) return st.pendingPurchase;
    if (st.phase === 'AUCTION' && st.auction) return st.auction.space;
    return null;
  }

  private deedIndex(st: GameState): number {
    return this.decisionSpace(st) ?? this.pinned ?? this.focusSpace;
  }

  private deedPanelVisible(): boolean {
    return this.deedPanel.offsetParent !== null;
  }

  private renderDeed(st: GameState, legal: LegalActions | null): void {
    if (this.decisionSpace(st) !== null && this.pinned !== null) {
      this.pinned = null;
      this.app.renderer?.setSelected(null);
    }
    const index = this.deedIndex(st);
    const scroll = this.deedPanel.scrollTop;
    const same = this.deedPanel.firstElementChild?.getAttribute('data-space') === String(index);
    clear(this.deedPanel);
    this.deedPanel.append(deedView({ ctx: this.ctx, state: st, index, me: this.me, legal, act: (a) => this.act(a), nameOf: (id) => this.nameOf(id) }));
    if (same) this.deedPanel.scrollTop = scroll;
  }

  /** Show a space's title deed: in the side panel on wide screens, in a dialog on phones. */
  private inspect(index: number): void {
    const r = this.app.renderer;
    this.pinned = index;
    r?.setSelected(index);
    audio.play('click');
    if (this.deedPanelVisible()) {
      this.render();
      return;
    }
    this.inspector?.handle.close();
    const handle = modal('Title deed', {
      narrow: true,
      testid: 'inspector',
      onClose: () => {
        if (this.inspector?.handle === handle) this.inspector = null;
        if (this.pinned === index) this.pinned = null;
        r?.setSelected(null);
      }
    });
    this.inspector = { handle, index };
    this.fillInspector();
  }

  private fillInspector(): void {
    if (!this.inspector) return;
    const { handle, index } = this.inspector;
    clear(handle.body);
    clear(handle.foot);
    const legal = this.playing ? null : getLegalActions(this.display, this.me, this.ctx);
    handle.body.append(deedView({ ctx: this.ctx, state: this.display, index, me: this.me, legal, act: (a) => this.act(a), nameOf: (id) => this.nameOf(id) }));
    handle.foot.append(button('Close', () => handle.close(), { variant: 'ghost', small: true }));
  }

  private refreshInspector(): void {
    if (this.inspector) this.fillInspector();
  }

  private applyHighlights(): void {
    this.highlightBtn.setAttribute('aria-pressed', String(this.highlightMine));
    this.app.renderer?.setHighlights(this.highlightMine ? ownedSpaces(this.display, this.me) : [], '#E8B23A');
  }

  /* ------------------------------------------------------------------ */
  /* Dialogs                                                              */
  /* ------------------------------------------------------------------ */

  private openAllDeeds(): void {
    const m = modal('All title deeds', { wide: true, testid: 'all-deeds' });
    const st = this.display;
    const grid = h('div', { class: 'deed-index' });
    for (const g of this.ctx.board.groups) {
      const list = h('div', { class: 'deed-index-group' }, h('div', { class: 'dig-head' }, h('i', { class: 'gbar', style: `background:${g.color}` }), g.name));
      for (const i of groupSpaces(this.ctx, g.id)) {
        const s = getSpace(this.ctx, i);
        const prop = st.properties[i];
        const owner = prop?.owner ? this.player(prop.owner) : undefined;
        const row = h(
          'button',
          { type: 'button', class: 'dig-row' },
          propertyThumb(s, g.color, prop?.houses ?? 0),
          h('span', { class: 'erow-main' }, h('span', { class: 'erow-name' }, s.name), h('span', { class: 'erow-status' }, owner ? `${owner.id === this.me ? 'Yours' : owner.name}${prop?.mortgaged ? ' · mortgaged' : ''}` : 'For sale')),
          h('span', { class: 'erow-rent' }, money(s.price ?? 0)),
          owner ? h('i', { class: 'owner-dot', style: `background:${owner.color}` }) : null
        );
        row.addEventListener('click', () => {
          m.close();
          this.inspect(i);
        });
        list.append(row);
      }
      grid.append(list);
    }
    m.body.append(grid);
  }

  private openManage(viewing?: string): void {
    this.manage?.close();
    this.manage = new ManageDialog(
      {
        ctx: this.ctx,
        me: this.me,
        viewing: viewing ?? this.me,
        dispatch: (a) => this.act(a),
        focusTile: (i) => {
          this.app.renderer?.setSelected(i);
          void this.app.renderer?.focusTile(i, this.ms(450));
        },
        highlight: (spaces) => this.app.renderer?.setHighlights(spaces),
        isBusy: () => this.playing
      },
      this.display,
      () => {
        this.manage = null;
        this.app.renderer?.setSelected(this.pinned);
        this.applyHighlights();
      }
    );
  }

  private openTrade(partnerId?: string): void {
    const legal = getLegalActions(this.display, this.me, this.ctx);
    if (!legal.canProposeTrade) {
      toast(this.display.trade ? 'Another trade is already pending.' : 'You cannot propose a trade right now.', 'bad');
      return;
    }
    openTradeDialog({ ctx: this.ctx, me: this.me, getState: () => this.display, dispatch: (a) => this.act(a) }, partnerId ? { partnerId } : {});
  }

  private openLog(): void {
    const m = modal('Game log', { testid: 'log-dialog' });
    const list = h('div', { class: 'log-list' });
    for (const entry of [...this.display.log].reverse()) list.append(h('div', { class: 'entry' }, h('span', { class: 'turn' }, `T${entry.turn}`), entry.text));
    m.body.append(list);
  }

  private openSettings(): void {
    const s = modal('Settings', { wide: true });
    s.body.append(settingsForm());
  }

  private openHowTo(): void {
    const s = modal('How to play', { wide: true });
    s.body.append(howToContent());
  }

  private openMenu(): void {
    const isLan = this.session.kind === 'lan';
    this.session.setPaused(true);
    const m = modal(isLan ? 'Menu' : 'Paused', {
      narrow: true,
      testid: 'game-menu',
      onClose: () => {
        this.session.setPaused(false);
        if (!this.playing) this.session.notifyIdle();
      }
    });
    if (!isLan) m.body.append(h('p', { class: 'muted small-text', style: 'margin-top:0' }, 'The game is paused while this menu is open.'));
    m.body.append(
      h(
        'div',
        { class: 'menu-buttons' },
        button('Resume', () => m.close(), { variant: 'primary', block: true }),
        button(
          isLan ? 'Save game on host' : 'Save game',
          () => {
            void this.session.save().then((msg) => toast(msg, /Could not|Only/.test(msg) ? 'bad' : 'good'));
            m.close();
          },
          { block: true, disabled: isLan && !this.session.isHost, testid: 'menu-save' }
        ),
        button(
          'Settings',
          () => {
            m.close();
            this.openSettings();
          },
          { block: true }
        ),
        button(
          'How to play',
          () => {
            m.close();
            this.openHowTo();
          },
          { block: true }
        ),
        button(
          isLan ? 'Leave game' : 'Quit to main menu',
          () => {
            const quit = () => {
              m.close();
              if (isLan) this.opts.lan?.leave();
              this.app.show(menuScreen);
            };
            const msg = isLan ? 'You can rejoin later from Continue while the host keeps the room open. A bot may play for you meanwhile.' : 'Your game is autosaved. You can continue it later from the main menu.';
            if (settings.get().confirmDestructive) void confirmDialog(isLan ? 'Leave this game?' : 'Quit to menu?', msg, isLan ? 'Leave' : 'Quit', true).then((y) => y && quit());
            else quit();
          },
          { variant: 'danger', block: true, testid: 'menu-quit' }
        )
      )
    );
  }

  private showResults(force = false): void {
    if (this.resultsShown && !force) return;
    this.resultsShown = true;
    // Clear transient overlays so nothing covers the results.
    for (const el of Array.from(document.querySelectorAll('.card-popup, .toast, .overlay-banner'))) el.remove();
    const st = this.display;
    const ranking = rankPlayers(st, this.ctx);
    const m = modal('Results', { wide: true, testid: 'results' });
    const winner = st.players.find((p) => p.id === st.winnerId);
    m.body.append(
      h(
        'div',
        { class: 'winner' },
        h('div', { class: 'crown', 'aria-hidden': 'true' }, '🏆'),
        winner ? tokenIcon(winner.token, winner.color, 48) : null,
        h('h2', { style: 'margin:0' }, winner ? (winner.id === this.me ? 'You win!' : `${winner.name} wins!`) : 'Game over'),
        h('div', { class: 'muted' }, st.endReason ?? '')
      )
    );
    const table = h(
      'table',
      { class: 'results-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th', { class: 'num' }, 'Net worth'), h('th', { class: 'num' }, 'Properties'), h('th', { class: 'num' }, 'Rent collected'), h('th', { class: 'num' }, 'Turns')))
    );
    const tbody = h('tbody');
    ranking.forEach((id, i) => {
      const p = st.players.find((x) => x.id === id);
      if (!p) return;
      const stats = st.stats[id];
      tbody.append(
        h(
          'tr',
          {},
          h('td', {}, i + 1),
          h('td', {}, h('span', { class: 'row nowrap' }, tokenIcon(p.token, p.color, 18), p.name, p.bankrupt ? h('span', { class: 'badge red' }, 'bankrupt') : null)),
          h('td', { class: 'num' }, money(netWorth(st, this.ctx, id))),
          h('td', { class: 'num' }, ownedSpaces(st, id).length),
          h('td', { class: 'num' }, money(stats?.rentCollected ?? 0)),
          h('td', { class: 'num' }, stats?.turnsPlayed ?? 0)
        )
      );
    });
    table.append(tbody);
    m.body.append(h('div', { class: 'table-scroll' }, table), h('p', { class: 'muted small-text' }, `${st.turn.number} turns played over ${this.roundOf(st)} rounds.`));
    m.foot.append(
      button('View board', () => m.close(), { variant: 'ghost' }),
      button(
        'Main menu',
        () => {
          m.close();
          this.app.show(menuScreen);
        },
        { testid: 'results-menu' }
      ),
      button(
        'Play again',
        () => {
          m.close();
          this.opts.onPlayAgain();
        },
        { variant: 'primary', testid: 'results-again' }
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                             */
  /* ------------------------------------------------------------------ */

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') {
      if (!closeTopModal()) this.openMenu();
      e.preventDefault();
      return;
    }
    if (hasOpenModal()) return;
    const r = this.app.renderer;
    const legal = this.playing ? null : getLegalActions(this.display, this.me, this.ctx);
    switch (e.key) {
      case ' ':
      case 'r':
      case 'R':
        if (legal?.canRoll) {
          e.preventDefault();
          this.act({ type: 'ROLL' });
        }
        break;
      case 'e':
      case 'E':
        if (legal?.canEndTurn) this.act({ type: 'END_TURN' });
        break;
      case 'b':
      case 'B':
        if (legal?.canBuy) this.act({ type: 'BUY' });
        break;
      case 'a':
      case 'A':
        if (legal?.canDecline) this.act({ type: 'DECLINE' });
        break;
      case 'p':
      case 'P':
        this.openManage();
        break;
      case 't':
      case 'T':
        if (legal?.canProposeTrade) this.openTrade();
        break;
      case 'l':
      case 'L':
        this.openLog();
        break;
      case '+':
      case '=':
        r?.zoomBy(0.85);
        break;
      case '-':
      case '_':
        r?.zoomBy(1.18);
        break;
      case '0':
        void r?.resetCamera(this.ms(500));
        break;
      case 'ArrowLeft':
        r?.rotateBy(-40, 0);
        break;
      case 'ArrowRight':
        r?.rotateBy(40, 0);
        break;
      case 'ArrowUp':
        r?.rotateBy(0, -30);
        break;
      case 'ArrowDown':
        r?.rotateBy(0, 30);
        break;
      default:
        break;
    }
  }
}
