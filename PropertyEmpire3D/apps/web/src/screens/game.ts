/**
 * Game screen: HUD, context-sensitive controls and the event player that
 * turns authoritative game events into animations before revealing the new
 * state. Works identically for solo (LocalSession) and LAN (RemoteSession).
 */
import {
  auctionMinBid,
  currentBidder,
  describeTrade,
  findCard,
  getLegalActions,
  getSpace,
  netWorth,
  ownedSpaces,
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
import { money, tokenIcon } from '../ui/format';
import { propertyCard } from '../ui/propertyCard';
import { ManageDialog } from '../ui/manageDialog';
import { openTradeDialog } from '../ui/tradeDialog';
import { settingsForm } from './settingsScreen';
import { howToContent } from './howto';
import { menuScreen } from './menu';
import { wait } from '../three/tween';

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

  // DOM
  private hud = h('div', { class: 'hud', 'data-testid': 'game-hud' });
  private banner = h('div', { class: 'turn-banner', 'data-testid': 'turn-banner' });
  private roundPill = h('span', { class: 'round-pill' });
  private players = h('div', { class: 'players-panel', 'aria-label': 'Players' });
  private panel = h('div', { class: 'action-panel', 'data-testid': 'action-panel', 'aria-live': 'polite' });
  private connBanner: HTMLElement | null = null;
  private btnRoll: HTMLButtonElement;
  private btnEnd: HTMLButtonElement;
  private btnProps: HTMLButtonElement;
  private btnTrade: HTMLButtonElement;

  constructor(
    private readonly app: App,
    private readonly session: GameSession,
    private readonly opts: GameScreenOptions
  ) {
    this.ctx = app.ctx;
    this.me = session.localPlayerId;
    this.display = session.state;
    this.lastTurnPlayer = this.display.turn.playerId;

    const menuBtn = button('Menu', () => this.openMenu(), { variant: 'ghost', small: true, testid: 'open-menu', ariaLabel: 'Game menu' });
    const topbar = h('div', { class: 'topbar' }, this.banner, this.roundPill, menuBtn);
    this.btnRoll = button('Roll Dice', () => this.act({ type: 'ROLL' }), { variant: 'primary', kbd: 'Space', short: 'Roll', testid: 'btn-roll' });
    this.btnEnd = button('End Turn', () => this.act({ type: 'END_TURN' }), { kbd: 'E', short: 'End', testid: 'btn-end-turn' });
    this.btnProps = button('Properties', () => this.openManage(), { kbd: 'P', short: 'Props', testid: 'btn-properties' });
    this.btnTrade = button('Trade', () => this.openTrade(), { kbd: 'T', short: 'Trade', testid: 'btn-trade' });
    const btnLog = button('Log', () => this.openLog(), { variant: 'ghost', short: 'Log', testid: 'btn-log' });
    const bottom = h('div', { class: 'bottombar', role: 'toolbar', 'aria-label': 'Game actions' }, this.btnRoll, this.btnEnd, this.btnProps, this.btnTrade, btnLog);
    const cam = h(
      'div',
      { class: 'camera-controls', role: 'group', 'aria-label': 'Camera' },
      button('+', () => app.renderer?.zoomBy(0.85), { ariaLabel: 'Zoom in' }),
      button('−', () => app.renderer?.zoomBy(1.18), { ariaLabel: 'Zoom out' }),
      button('⟲', () => void app.renderer?.resetCamera(this.ms(500)), { ariaLabel: 'Reset camera', testid: 'camera-reset' })
    );
    this.hud.append(topbar, this.players, this.panel, cam, bottom);
    app.root.append(this.hud);

    const r = app.ensureRenderer();
    if (r) {
      r.setAttract(false);
      r.setSelected(null);
      r.setHighlights([]);
      r.syncState(this.display);
      r.dice.show(this.display.turn.dice ?? [5, 2]);
      void r.resetCamera(0);
      this.applyInsets();
      r.setTileClickHandler((i) => this.inspect(i));
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
    const onResize = () => this.applyInsets();
    window.addEventListener('resize', onResize);
    this.offs.push(() => window.removeEventListener('resize', onResize));

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

  private applyInsets(): void {
    const r = this.app.renderer;
    if (!r) return;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const mobile = w <= 720 || (hgt <= 520 && w <= 1000);
    if (mobile) {
      const landscape = hgt <= 520;
      // Portrait: players strip on top, bottom bar plus a bottom sheet capped at 32% height.
      r.setInsets(landscape ? { left: 0, right: 290, top: 50, bottom: 70 } : { left: 0, right: 0, top: 112, bottom: Math.round(hgt * 0.32) + 84 });
    } else {
      r.setInsets({ left: w > 900 ? 255 : 215, right: w > 900 ? 320 : 290, top: 60, bottom: 80 });
    }
  }

  private setConnection(text: string | null): void {
    this.connBanner?.remove();
    this.connBanner = null;
    if (!text) return;
    this.connBanner = h('div', { class: 'connection-banner', role: 'status', 'data-testid': 'connection-banner' }, h('div', { class: 'spinner small' }), text);
    this.hud.append(this.connBanner);
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
          this.banner.classList.remove('flash');
          void this.banner.offsetWidth;
          this.banner.classList.add('flash');
        }
        this.lastTurnPlayer = e.playerId;
        if (e.playerId === this.me) {
          audio.play('turn');
          toast('Your turn!', 'good', 1800);
        }
        break;
      case 'DICE_ROLLED':
        audio.play('dice');
        this.setBannerDice(e.dice);
        await r?.rollDice(e.dice, this.ms(1200));
        if (e.doubles && !e.inJail) toast(`${this.nameOf(e.playerId)} rolled doubles!`, '', 1600);
        break;
      case 'MOVED': {
        const jail = this.ctx.board.spaces.findIndex((s) => s.type === 'jail');
        await r?.animateMove(e.playerId, e.from, e.to, e.steps, e.direct, this.ms(170), e.direct && e.to === jail, () => audio.play('step'));
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
        toast(`${this.nameOf(e.playerId)} ${e.type === 'AUCTION_WON' ? 'won' : e.playerId === this.me ? 'bought' : 'bought'} ${getSpace(this.ctx, e.space).name} for ${money(e.type === 'AUCTION_WON' ? e.amount : e.price)}`, e.playerId === this.me ? 'good' : '');
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
      case 'BANKRUPT':
        audio.play('bankrupt');
        this.hud.append(h('div', { class: 'overlay-banner', role: 'status' }, `${this.nameOf(e.playerId)} ${e.playerId === this.me ? 'are' : 'is'} bankrupt!`));
        window.setTimeout(() => this.hud.querySelector('.overlay-banner')?.remove(), 2800);
        await wait(this.ms(600));
        break;
      case 'GAME_OVER':
        if (e.winnerId === this.me) audio.play('win');
        break;
      default:
        break;
    }
  }

  private setBannerDice(dice: [number, number]): void {
    const existing = this.banner.querySelector('.dice-readout');
    existing?.remove();
    this.banner.append(h('span', { class: 'dice-readout', 'aria-label': `Rolled ${dice[0]} and ${dice[1]}` }, h('span', { class: 'die-face' }, dice[0]), h('span', { class: 'die-face' }, dice[1])));
  }

  private floatMoney(party: string, amount: number): void {
    if (party === 'bank') return;
    const row = this.players.querySelector<HTMLElement>(`[data-player="${CSS.escape(party)}"]`);
    if (!row) return;
    const f = h('span', { class: `money-float ${amount >= 0 ? 'plus' : 'minus'}` }, `${amount >= 0 ? '+' : '−'}${money(Math.abs(amount))}`);
    row.append(f);
    window.setTimeout(() => f.remove(), 1500);
  }

  private showCard(deck: 'chance' | 'community', cardId: string, playerId: string): Promise<void> {
    const found = findCard(this.ctx, cardId);
    if (!found) return Promise.resolve();
    const popup = h(
      'div',
      { class: `card-popup ${deck}`, role: 'dialog', 'aria-label': 'Card drawn', 'data-testid': 'card-popup' },
      h('div', { class: 'deck' }, `${deck === 'chance' ? 'Fortune' : 'Community Fund'} · ${this.nameOf(playerId)}`),
      h('h3', {}, found.card.title),
      h('p', {}, found.card.text)
    );
    this.hud.append(popup);
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
  /* HUD rendering                                                        */
  /* ------------------------------------------------------------------ */

  private render(): void {
    const st = this.display;
    const legal = this.playing ? null : getLegalActions(st, this.me, this.ctx);
    this.renderBanner(st);
    this.renderPlayers(st);
    this.renderPanel(st, legal);
    this.btnRoll.disabled = !legal?.canRoll;
    this.btnEnd.disabled = !legal?.canEndTurn;
    this.btnTrade.disabled = !legal?.canProposeTrade;
    this.btnProps.disabled = false;
  }

  private renderBanner(st: GameState): void {
    const dice = this.banner.querySelector('.dice-readout');
    clear(this.banner);
    const cur = this.player(st.turn.playerId);
    if (cur) this.banner.append(tokenIcon(cur.token, cur.color, 22));
    let what = PHASE_TEXT[st.phase] ?? '';
    if (st.phase === 'AWAIT_ROLL' && st.turn.extraRoll) what = 'Doubles! Roll again';
    if (st.phase === 'AUCTION' && st.auction) what = `Auction: ${getSpace(this.ctx, st.auction.space).shortName}`;
    if (st.phase === 'DEBT_RESOLUTION' && st.debts[0]) what = `${this.nameOf(st.debts[0].debtorId)} must raise ${money(st.debts[0].amount)}`;
    if (st.phase === 'GAME_OVER') what = st.winnerId ? `${this.nameOf(st.winnerId)} ${st.winnerId === this.me ? 'win' : 'wins'}!` : 'Game over';
    const who = st.phase === 'GAME_OVER' ? 'Game over' : cur?.id === this.me ? 'Your turn' : `${cur?.name ?? ''}’s turn`;
    this.banner.append(h('span', { class: 'who' }, who), h('span', { class: 'what' }, `· ${what}`));
    if (dice) this.banner.append(dice);
    else if (st.turn.dice) this.setBannerDice(st.turn.dice);
    this.roundPill.textContent = `Round ${this.roundOf(st)}${st.config.maxRounds ? ` / ${st.config.maxRounds}` : ''}`;
  }

  /** Rounds played, capped at the limit (the counter passes it when a round-limited game ends). */
  private roundOf(st: GameState): number {
    return st.config.maxRounds ? Math.min(st.round, st.config.maxRounds) : st.round;
  }

  private renderPlayers(st: GameState): void {
    clear(this.players);
    this.players.append(h('div', { class: 'panel-title' }, 'Players', st.config.freeParkingJackpot ? h('span', {}, `Pot ${money(st.freeParkingPot)}`) : null));
    const actors = new Set(pendingActors(st));
    for (const p of st.players) {
      const props = ownedSpaces(st, p.id).length;
      const badges = [
        p.kind === 'bot' ? h('span', { class: 'badge' }, `Bot · ${p.difficulty}`) : p.id === this.me ? h('span', { class: 'badge blue' }, 'You') : null,
        p.inJail ? h('span', { class: 'badge orange' }, 'In Jail') : null,
        p.jailCards.length ? h('span', { class: 'badge' }, `${p.jailCards.length} jail card`) : null,
        !p.connected && p.kind === 'human' ? h('span', { class: 'badge red' }, 'Offline') : null,
        p.bankrupt ? h('span', { class: 'badge red' }, 'Bankrupt') : h('span', { class: 'badge' }, `${props} prop${props === 1 ? '' : 's'}`)
      ];
      const row = h(
        'button',
        {
          type: 'button',
          class: `player-row ${st.turn.playerId === p.id && st.phase !== 'GAME_OVER' ? 'active' : ''} ${p.bankrupt ? 'bankrupt' : ''}`,
          'data-player': p.id,
          'aria-label': `${p.name}, ${money(p.cash)}${actors.has(p.id) ? ', acting now' : ''}`
        },
        tokenIcon(p.token, p.color, 26),
        h('div', { class: 'info' }, h('div', { class: 'row between nowrap' }, h('span', { class: 'pname' }, p.name), h('span', { class: 'cash' }, money(p.cash))), h('div', { class: 'details' }, ...badges))
      );
      row.addEventListener('click', () => this.openManage(p.id));
      this.players.append(row);
    }
  }

  private waiting(text: string): HTMLElement {
    return h('div', { class: 'waiting' }, h('div', { class: 'spinner small' }), text);
  }

  private renderPanel(st: GameState, legal: LegalActions | null): void {
    clear(this.panel);
    if (st.phase === 'GAME_OVER') {
      this.panel.append(h('h3', {}, 'Game over'), h('p', {}, st.endReason ?? ''), button('Show results', () => this.showResults(true), { variant: 'primary', block: true }));
      return;
    }
    const meP = this.player(this.me);
    if (meP?.bankrupt) {
      this.panel.append(h('h3', {}, 'You are bankrupt'), h('p', {}, 'You can keep watching until the game ends.'));
      return;
    }
    if (!legal) {
      this.panel.append(this.waiting('...'));
      return;
    }
    const actors = pendingActors(st);
    const actorName = this.nameOf(actors[0]);
    const actorIsBot = actors[0] ? this.player(actors[0])?.kind === 'bot' : false;

    switch (st.phase) {
      case 'PROPERTY_DECISION': {
        const space = st.pendingPurchase as number;
        const s = getSpace(this.ctx, space);
        if (st.turn.playerId === this.me) {
          this.panel.append(h('h3', {}, `Buy ${s.name}?`), propertyCard(this.ctx, st, space));
          const acts = h('div', { class: 'actions' });
          acts.append(button(`Buy for ${money(s.price ?? 0)}`, () => this.act({ type: 'BUY' }), { variant: 'success', disabled: !legal.canBuy, kbd: 'B', testid: 'btn-buy' }));
          if (!legal.canBuy) acts.append(h('p', {}, `You need ${money((s.price ?? 0) - (meP?.cash ?? 0))} more. Mortgage or sell to raise funds, or let it go to auction.`), button('Raise funds', () => this.openManage(), { small: true }));
          acts.append(button(st.config.auctions ? 'Send to auction' : 'Decline', () => this.act({ type: 'DECLINE' }), { kbd: 'A', testid: 'btn-auction' }));
          this.panel.append(acts);
        } else {
          this.panel.append(this.waiting(`${actorName} is deciding whether to buy ${s.name}`));
        }
        return;
      }
      case 'AUCTION': {
        const a = st.auction;
        if (!a) return;
        const s = getSpace(this.ctx, a.space);
        const bidder = currentBidder(st);
        this.panel.append(
          h('h3', {}, `Auction: ${s.name}`),
          h('p', {}, a.highestBidderId ? `Highest bid ${money(a.highestBid)} by ${this.nameOf(a.highestBidderId)}` : 'No bids yet. Minimum bid $1.'),
          h('div', { class: 'row', style: 'margin-bottom:10px' }, ...a.bidders.map((id) => h('span', { class: `badge ${id === bidder ? 'blue' : ''}` }, this.nameOf(id))))
        );
        if (legal.canPassBid) {
          const min = auctionMinBid(st);
          const max = meP?.cash ?? 0;
          if (this.bidValue < min || this.bidValue > max) this.bidValue = Math.min(max, Math.max(min, Math.round(((s.price ?? 0) * 0.5) / 10) * 10));
          const input = h('input', { class: 'input', type: 'number', min, max, value: this.bidValue, inputmode: 'numeric', 'aria-label': 'Your bid', 'data-testid': 'bid-input' });
          input.addEventListener('input', () => (this.bidValue = Math.floor(Number(input.value) || 0)));
          const quick = h(
            'div',
            { class: 'row' },
            ...[1, 10, 50, 100].map((inc) =>
              button(`+${inc}`, () => {
                this.bidValue = Math.min(max, Math.max(min, (a.highestBidderId ? a.highestBid : 0) + inc));
                input.value = String(this.bidValue);
              }, { small: true, disabled: (a.highestBidderId ? a.highestBid : 0) + inc > max })
            )
          );
          this.panel.append(
            h('div', { class: 'actions' }, quick, input, button('Place bid', () => this.act({ type: 'BID', amount: this.bidValue }), { variant: 'primary', disabled: !legal.bid, testid: 'btn-bid' }), button('Pass', () => this.act({ type: 'PASS_BID' }), { testid: 'btn-pass' })),
            h('p', { class: 'small-text muted' }, `You can bid ${money(min)} to ${money(max)}.`)
          );
        } else {
          this.panel.append(this.waiting(`${this.nameOf(bidder)} ${actorIsBot ? 'is thinking...' : 'is bidding...'}`));
        }
        return;
      }
      case 'DEBT_RESOLUTION': {
        const d = st.debts[0];
        if (!d) return;
        if (d.debtorId === this.me) {
          const short = Math.max(0, d.amount - (meP?.cash ?? 0));
          this.panel.append(
            h('h3', {}, `You owe ${money(d.amount)}`),
            h('p', {}, `To ${this.nameOf(d.creditorId)} (${d.reason}). ${short ? `You need ${money(short)} more: sell buildings, mortgage property or trade.` : 'You can pay now.'}`),
            h(
              'div',
              { class: 'actions' },
              button(`Pay ${money(d.amount)}`, () => this.act({ type: 'PAY_DEBT' }), { variant: 'success', disabled: !legal.canPayDebt, testid: 'btn-pay-debt' }),
              button('Manage properties', () => this.openManage(), {}),
              button('Propose a trade', () => this.openTrade(), { disabled: !legal.canProposeTrade }),
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
        } else this.panel.append(this.waiting(`${this.nameOf(d.debtorId)} is raising ${money(d.amount)}`));
        return;
      }
      case 'TRADE': {
        const t = st.trade;
        if (!t) return;
        const desc = describeTrade(st, this.ctx, t);
        const summary = (gives: string[], gets: string[], fromName: string, toName: string) =>
          h('div', { class: 'trade-summary' }, h('div', {}, h('b', {}, `${fromName} give${fromName === 'You' ? '' : 's'}`), gives.join(', ') || 'Nothing'), h('div', {}, h('b', {}, `${toName} give${toName === 'You' ? '' : 's'}`), gets.join(', ') || 'Nothing'));
        if (t.toId === this.me) {
          this.panel.append(
            h('h3', {}, `Trade offer from ${this.nameOf(t.fromId)}`),
            summary(desc.gives, desc.gets, this.nameOf(t.fromId), 'You'),
            h(
              'div',
              { class: 'actions' },
              button('Accept', () => this.act({ type: 'ACCEPT_TRADE' }), { variant: 'success', testid: 'btn-accept-trade' }),
              button('Counteroffer', () => openTradeDialog({ ctx: this.ctx, me: this.me, getState: () => this.display, dispatch: (a) => this.act(a) }, { counter: t }), { disabled: t.counterCount >= 3 }),
              button('Reject', () => this.act({ type: 'REJECT_TRADE' }), { variant: 'danger', testid: 'btn-reject-trade' })
            )
          );
        } else if (t.fromId === this.me) {
          this.panel.append(h('h3', {}, 'Your trade offer'), summary(desc.gives, desc.gets, 'You', this.nameOf(t.toId)), this.waiting(`Waiting for ${this.nameOf(t.toId)}...`), h('div', { class: 'actions', style: 'margin-top:10px' }, button('Withdraw offer', () => this.act({ type: 'CANCEL_TRADE' }), { testid: 'btn-cancel-trade' })));
        } else this.panel.append(this.waiting(`${this.nameOf(t.toId)} is considering a trade from ${this.nameOf(t.fromId)}`));
        return;
      }
      case 'JAIL_DECISION': {
        if (st.turn.playerId !== this.me) {
          this.panel.append(this.waiting(`${actorName} is in Jail and deciding what to do`));
          return;
        }
        this.panel.append(
          h('h3', {}, 'You are in Jail'),
          h('p', {}, `Attempt ${(meP?.jailTurns ?? 0) + 1} of ${st.config.maxJailTurns}. Roll doubles to get out free, pay ${money(st.config.jailFine)}, or use a card. After the last failed roll you must pay and move.`),
          h(
            'div',
            { class: 'actions' },
            button('Roll for doubles', () => this.act({ type: 'ROLL' }), { variant: 'primary', disabled: !legal.canRoll, kbd: 'Space', testid: 'btn-jail-roll' }),
            button(`Pay ${money(st.config.jailFine)}`, () => this.act({ type: 'PAY_JAIL_FINE' }), { disabled: !legal.canPayJailFine, testid: 'btn-pay-fine' }),
            button(`Use Get Out of Jail Free card`, () => this.act({ type: 'USE_JAIL_CARD' }), { disabled: !legal.canUseJailCard, testid: 'btn-use-card' })
          )
        );
        return;
      }
      case 'AWAIT_ROLL':
      case 'TURN_END': {
        if (st.turn.playerId !== this.me) {
          this.panel.append(this.waiting(actorIsBot ? `${actorName} is playing...` : `Waiting for ${actorName}...`));
          return;
        }
        const space = getSpace(this.ctx, meP?.position ?? 0);
        const here = `You are on ${space.name.replace(/\.$/, '')}.`;
        const actions = h('div', { class: 'actions' });
        if (st.phase === 'AWAIT_ROLL') {
          this.panel.append(h('h3', {}, st.turn.extraRoll ? 'Doubles! Roll again' : 'Your turn'), h('p', {}, `${here} ${legal.buildable.length ? 'You can build before rolling.' : ''}`));
          actions.append(button('Roll dice', () => this.act({ type: 'ROLL' }), { variant: 'primary', kbd: 'Space', disabled: !legal.canRoll, testid: 'panel-roll' }));
        } else {
          this.panel.append(h('h3', {}, 'Anything else?'), h('p', {}, `${here} Build, trade or manage properties, then end your turn.`));
          actions.append(button('End turn', () => this.act({ type: 'END_TURN' }), { variant: 'primary', kbd: 'E', disabled: !legal.canEndTurn, testid: 'panel-end-turn' }));
        }
        if (legal.buildable.length) actions.append(button(`Build (${legal.buildable.length} options)`, () => this.openManage(), { variant: 'success' }));
        if (legal.unmortgageable.length) actions.append(button('Lift mortgages', () => this.openManage(), {}));
        this.panel.append(actions);
        return;
      }
      default:
        return;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dialogs                                                              */
  /* ------------------------------------------------------------------ */

  private inspect(index: number): void {
    const r = this.app.renderer;
    r?.setSelected(index);
    void r?.focusTile(index, this.ms(450));
    this.inspector?.handle.close();
    const space = getSpace(this.ctx, index);
    const handle = modal(space.name, {
      narrow: true,
      testid: 'inspector',
      onClose: () => {
        if (this.inspector?.handle === handle) this.inspector = null;
        r?.setSelected(null);
        void r?.resetCamera(this.ms(450));
      }
    });
    this.inspector = { handle, index };
    this.fillInspector();
  }

  private fillInspector(): void {
    if (!this.inspector) return;
    const { handle, index } = this.inspector;
    const st = this.display;
    clear(handle.body);
    clear(handle.foot);
    handle.body.append(propertyCard(this.ctx, st, index));
    const legal = this.playing ? null : getLegalActions(st, this.me, this.ctx);
    const prop = st.properties[index];
    if (legal && prop?.owner === this.me) {
      const s = getSpace(this.ctx, index);
      if (legal.buildable.includes(index)) handle.foot.append(button(prop.houses === 4 ? 'Build hotel' : 'Build house', () => this.act({ type: 'BUILD', space: index }), { variant: 'success', small: true }));
      if (legal.sellable.includes(index)) handle.foot.append(button('Sell building', () => this.act({ type: 'SELL_BUILDING', space: index }), { variant: 'warn', small: true }));
      if (legal.mortgageable.includes(index)) handle.foot.append(button(`Mortgage +${money(s.mortgage ?? 0)}`, () => this.act({ type: 'MORTGAGE', space: index }), { small: true }));
      if (legal.unmortgageable.includes(index)) handle.foot.append(button('Lift mortgage', () => this.act({ type: 'UNMORTGAGE', space: index }), { small: true }));
    }
    if (legal?.canBuy && st.pendingPurchase === index) handle.foot.append(button('Buy', () => this.act({ type: 'BUY' }), { variant: 'success', small: true }));
    handle.foot.append(button('Close', () => handle.close(), { variant: 'ghost', small: true }));
  }

  private refreshInspector(): void {
    if (this.inspector) this.fillInspector();
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
        this.app.renderer?.setSelected(null);
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
        button('Settings', () => {
          m.close();
          const s = modal('Settings', { wide: true });
          s.body.append(settingsForm());
        }, { block: true }),
        button('How to play', () => {
          m.close();
          const s = modal('How to play', { wide: true });
          s.body.append(howToContent());
        }, { block: true }),
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
    m.body.append(table, h('p', { class: 'muted small-text' }, `${st.turn.number} turns played over ${this.roundOf(st)} rounds.`));
    m.foot.append(
      button('View board', () => m.close(), { variant: 'ghost' }),
      button('Main menu', () => {
        m.close();
        this.app.show(menuScreen);
      }, { testid: 'results-menu' }),
      button('Play again', () => {
        m.close();
        this.opts.onPlayAgain();
      }, { variant: 'primary', testid: 'results-again' })
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
