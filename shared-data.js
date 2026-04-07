// ============================================================
// SHARED DATA LAYER — Card DB + Effect Engine + Storage
// ============================================================

// ─── STORAGE (localStorage wrapper) ─────────────────────────
const DB = {
  KEYS: {
    CARDS: 'duel_cards',
    DECKS: 'duel_decks',
    ADMIN_TOKEN: 'duel_admin_token',
    RESTRICTIONS: 'duel_restrictions', // forbidden/limited/semi-limited
  },
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },
  getCards() {
    return this.get(this.KEYS.CARDS) || DEFAULT_CARDS;
  },
  setCards(cards) {
    this.set(this.KEYS.CARDS, cards);
  },
  getDecks() {
    return this.get(this.KEYS.DECKS) || {};
  },
  saveDeck(name, deck) {
    const decks = this.getDecks();
    decks[name] = { ...deck, updatedAt: Date.now() };
    this.set(this.KEYS.DECKS, decks);
  },
  deleteDeck(name) {
    const decks = this.getDecks();
    delete decks[name];
    this.set(this.KEYS.DECKS, decks);
  },
  getRestrictions() {
    return this.get(this.KEYS.RESTRICTIONS) || {};
    // format: { cardId: 'forbidden' | 'limited' | 'semi-limited' }
  },
  setRestrictions(r) {
    this.set(this.KEYS.RESTRICTIONS, r);
  },
  isAdmin() {
    return this.get(this.KEYS.ADMIN_TOKEN) === 'ADMIN_AUTHENTICATED';
  },
  setAdmin(val) {
    if (val) this.set(this.KEYS.ADMIN_TOKEN, 'ADMIN_AUTHENTICATED');
    else localStorage.removeItem(this.KEYS.ADMIN_TOKEN);
  },
};

// ─── CARD SCHEMA ─────────────────────────────────────────────
// {
//   id: string (unique),
//   name: string,
//   type: 'monster' | 'spell' | 'trap',
//   subtype: string,       // monster: 'normal'|'effect'|'ritual'|'fusion'|'synchro'|'xyz'|'link'
//                          // spell: 'normal'|'continuous'|'quickplay'|'field'|'equip'|'ritual'
//                          // trap: 'normal'|'continuous'|'counter'
//   attribute: string,     // monster only: DARK|LIGHT|FIRE|WATER|EARTH|WIND|DIVINE
//   race: string,          // monster only: Warrior|Spellcaster|Dragon|etc
//   level: number,         // monster: 1-12 (xyz: rank, link: rating)
//   atk: number,
//   def: number,
//   desc: string,          // flavor/lore text
//   effects: Effect[],     // array of Effect objects
//   image: string,         // emoji or base64 or url
//   rarity: 'common'|'rare'|'super'|'ultra'|'secret',
//   frameColor: string,    // hex color for card frame
// }

// ─── EFFECT SCHEMA ───────────────────────────────────────────
// Effect = {
//   id: string,
//   trigger: TriggerType,  // when this effect fires
//   condition: string,     // optional JS expression string for condition check
//   actions: Action[],     // what the effect does
//   cost: Action[],        // what must be paid to activate
//   once: boolean,         // once per turn?
//   description: string,   // human readable
// }
//
// TriggerType:
//   'on_summon'            // when this card is summoned
//   'on_normal_summon'     // when specifically normal summoned
//   'on_special_summon'    // when specifically special summoned
//   'on_destroy'           // when this card is destroyed
//   'on_send_to_gy'        // when sent to graveyard
//   'on_activate'          // spell/trap when activated
//   'on_draw'              // when drawn
//   'on_battle_start'      // at battle phase start
//   'on_attack'            // when this monster attacks
//   'on_attacked'          // when this monster is attacked
//   'on_damage'            // when player takes damage
//   'quick_effect'         // can be used in response (like trap)
//   'continuous'           // persistent while on field
//   'manual'               // player manually activates
//
// Action = {
//   type: ActionType,
//   target: TargetType,
//   value: any,
// }
//
// ActionType:
//   'draw'                 // draw cards
//   'damage'               // deal damage to player
//   'heal'                 // restore LP
//   'destroy'              // destroy card(s)
//   'banish'               // banish card(s)
//   'return_hand'          // return to hand
//   'search'               // search deck for card
//   'special_summon'       // special summon from somewhere
//   'change_atk'           // modify ATK
//   'change_def'           // modify DEF
//   'negate'               // negate effect
//   'set_position'         // change battle position
//   'add_counter'          // add counter
//   'remove_counter'       // remove counter
//   'mill'                 // send top of deck to GY
//
// TargetType:
//   'self'                 // this card
//   'player'               // controller
//   'opponent'             // opponent
//   'any_monster_field'    // any monster on field
//   'opponent_monster'     // opponent's monster
//   'own_monster'          // your monster
//   'any_spell_field'      // any spell/trap on field
//   'any_gy'               // any card in GY
//   'hand'                 // from hand
//   'deck_top'             // top of deck

// ─── EFFECT ENGINE ───────────────────────────────────────────
const EffectEngine = {
  // Execute a list of actions in game state context
  executeActions(actions, ctx) {
    // ctx = { state, sourceCard, controller, target, log }
    const results = [];
    for (const action of actions) {
      try {
        const r = this.executeAction(action, ctx);
        if (r) results.push(r);
      } catch(e) {
        console.warn('Effect action error:', e, action);
      }
    }
    return results;
  },

  executeAction(action, ctx) {
    const { state, controller, log } = ctx;
    const p = state.players[controller];
    const opp = state.players[1 - controller];

    switch(action.type) {
      case 'draw': {
        const count = action.value || 1;
        for (let i = 0; i < count; i++) {
          if (p.deck.length === 0) { log('덱이 없습니다!', 'danger'); return; }
          p.hand.push(p.deck.shift());
        }
        log(`${count}장 드로우!`);
        return { type: 'draw', count };
      }
      case 'damage': {
        const target = action.target === 'opponent' ? opp : p;
        const dmg = action.value || 0;
        target.lp = Math.max(0, target.lp - dmg);
        log(`${dmg} 데미지!`, 'special');
        return { type: 'damage', amount: dmg, to: action.target };
      }
      case 'heal': {
        const hp = action.value || 0;
        p.lp = Math.min(8000, p.lp + hp);
        log(`${hp} LP 회복!`);
        return { type: 'heal', amount: hp };
      }
      case 'destroy': {
        return this.resolveDestroy(action, ctx);
      }
      case 'banish': {
        return this.resolveBanish(action, ctx);
      }
      case 'mill': {
        const count = action.value || 1;
        for (let i = 0; i < count; i++) {
          const target = action.target === 'opponent' ? opp : p;
          if (target.deck.length > 0) target.graveyard.push(target.deck.shift());
        }
        log(`덱 상단 ${count}장을 묘지로.`);
        return { type: 'mill', count };
      }
      case 'return_hand': {
        return this.resolveReturnHand(action, ctx);
      }
      case 'change_atk': {
        if (ctx.sourceCard) {
          ctx.sourceCard._atkBoost = (ctx.sourceCard._atkBoost || 0) + (action.value || 0);
        }
        return { type: 'change_atk', value: action.value };
      }
      case 'negate': {
        log('효과 무효화!', 'special');
        return { type: 'negate' };
      }
      case 'special_summon': {
        return this.resolveSpecialSummon(action, ctx);
      }
      default:
        log(`[효과: ${action.type}]`);
        return null;
    }
  },

  resolveDestroy(action, ctx) {
    const { state, controller, log } = ctx;
    const opp = state.players[1 - controller];
    const p = state.players[controller];

    if (action.target === 'opponent_monster') {
      const zones = opp.monsterZones;
      const targets = zones.map((z,i) => ({z,i})).filter(({z}) => z);
      const count = Math.min(action.value || 1, targets.length);
      for (let i = 0; i < count; i++) {
        const t = targets[i];
        opp.graveyard.push(t.z.cardId);
        opp.monsterZones[t.i] = null;
      }
      log(`상대 몬스터 ${count}체 파괴!`, 'special');
    } else if (action.target === 'any_spell_field') {
      const zones = opp.spellZones;
      const targets = zones.map((z,i) => ({z,i})).filter(({z}) => z);
      if (targets.length > 0) {
        const t = targets[0];
        opp.graveyard.push(t.z.cardId);
        opp.spellZones[t.i] = null;
        log(`마법/함정 파괴!`, 'special');
      }
    } else if (action.target === 'self') {
      // handled by caller usually
      log(`자신을 파괴.`);
    }
    return { type: 'destroy', target: action.target };
  },

  resolveBanish(action, ctx) {
    const { state, controller, log } = ctx;
    const opp = state.players[1 - controller];
    if (action.target === 'opponent_monster') {
      const targets = opp.monsterZones.map((z,i)=>({z,i})).filter(({z})=>z);
      const count = Math.min(action.value||1, targets.length);
      for (let i=0;i<count;i++) {
        const t=targets[i];
        opp.banished.push(t.z.cardId);
        opp.monsterZones[t.i]=null;
      }
      log(`상대 몬스터 ${count}체 제외!`, 'special');
    }
    return { type: 'banish', target: action.target };
  },

  resolveReturnHand(action, ctx) {
    const { state, controller, log } = ctx;
    const opp = state.players[1 - controller];
    if (action.target === 'opponent_monster') {
      const targets = opp.monsterZones.map((z,i)=>({z,i})).filter(({z})=>z);
      if (targets.length > 0) {
        const t = targets[0];
        opp.hand.push(t.z.cardId);
        opp.monsterZones[t.i] = null;
        log(`상대 몬스터를 핸드로 반환!`, 'special');
      }
    }
    return { type: 'return_hand' };
  },

  resolveSpecialSummon(action, ctx) {
    const { state, controller, log } = ctx;
    const p = state.players[controller];
    if (action.target === 'from_gy') {
      // 묘지에서 몬스터만 역순으로 탐색
      const gyIdx = [...p.graveyard].reverse().findIndex(id => {
        const c = ctx.cardDB[id];
        return c && c.type === 'monster' && !isExtraType(c);
      });
      if (gyIdx === -1) { log('묘지에 소환 가능한 몬스터가 없습니다!', 'danger'); return { type: 'special_summon' }; }
      const realIdx = p.graveyard.length - 1 - gyIdx;
      const cardId = p.graveyard[realIdx];
      const zoneIdx = p.monsterZones.findIndex(z => z === null);
      if (zoneIdx === -1) { log('몬스터존이 가득 찼습니다!', 'danger'); return { type: 'special_summon' }; }
      const fc = createFieldCard(cardId, 'ATK', true);
      fc.summonedThisTurn = true;
      p.monsterZones[zoneIdx] = fc;
      p.graveyard.splice(realIdx, 1);
      log(`묘지에서 특수 소환: ${ctx.cardDB[cardId]?.name||cardId}!`, 'special');
    }
    return { type: 'special_summon' };
  },

  // Check trigger and fire effect
  checkAndFire(trigger, fieldCard, ctx) {
    const card = ctx.cardDB[fieldCard.cardId];
    if (!card || !card.effects) return;
    for (const effect of card.effects) {
      if (effect.trigger !== trigger) continue;
      if (effect.once && fieldCard._usedEffects?.includes(effect.id)) continue;
      // Check condition
      if (effect.condition) {
        try {
          const condFn = new Function('ctx', 'state', `return (${effect.condition})`);
          if (!condFn(ctx, ctx.state)) continue;
        } catch(e) { continue; }
      }
      // Pay cost
      if (effect.cost && effect.cost.length > 0) {
        this.executeActions(effect.cost, ctx);
      }
      // Execute
      this.executeActions(effect.actions, ctx);
      if (effect.once) {
        if (!fieldCard._usedEffects) fieldCard._usedEffects = [];
        fieldCard._usedEffects.push(effect.id);
      }
    }
  },
};

// ─── FIELD CARD FACTORY ──────────────────────────────────────
function createFieldCard(cardId, pos='ATK', faceUp=true) {
  return {
    uid: Date.now() + Math.random(),
    cardId,
    position: pos,
    faceUp,
    attacked: false,
    canAttack: false,
    counters: {},
    _usedEffects: [],
    _atkBoost: 0,
    _defBoost: 0,
  };
}

// ─── CARD HELPERS ────────────────────────────────────────────
function isMonster(card) { return card && card.type === 'monster'; }
function isSpell(card) { return card && card.type === 'spell'; }
function isTrap(card) { return card && card.type === 'trap'; }
function isExtraType(card) {
  return card && card.type === 'monster' &&
    ['fusion','synchro','xyz','link'].includes(card.subtype);
}
function getCardAtk(fieldCard, cardDB) {
  const card = cardDB[fieldCard.cardId];
  return (card?.atk || 0) + (fieldCard._atkBoost || 0);
}
function getCardDef(fieldCard, cardDB) {
  const card = cardDB[fieldCard.cardId];
  return (card?.def || 0) + (fieldCard._defBoost || 0);
}

// ─── CARD FRAME COLORS ───────────────────────────────────────
const FRAME_COLORS = {
  normal:     '#c8a84b',
  effect:     '#c06a0a',
  ritual:     '#3a5ba0',
  fusion:     '#6a3a8a',
  synchro:    '#e8e8e8',
  xyz:        '#1a1a1a',
  link:       '#0a4a8a',
  spell:      '#0a6a4a',
  trap:       '#8a0a5a',
};

function getFrameColor(card) {
  if (!card) return '#333';
  if (card.frameColor) return card.frameColor;
  if (card.type === 'spell') return FRAME_COLORS.spell;
  if (card.type === 'trap') return FRAME_COLORS.trap;
  return FRAME_COLORS[card.subtype] || FRAME_COLORS.effect;
}

// ─── ATTRIBUTE COLORS ────────────────────────────────────────
const ATTR_COLORS = {
  DARK: '#6a3a8a', LIGHT: '#c8c840', FIRE: '#cc4400',
  WATER: '#0044cc', EARTH: '#884400', WIND: '#00aa44', DIVINE: '#cc8800',
};

// ─── RARITY STYLES ───────────────────────────────────────────
const RARITY_STYLES = {
  common:  { color: '#888', label: 'C' },
  rare:    { color: '#88aaff', label: 'R' },
  super:   { color: '#ff8800', label: 'SR' },
  ultra:   { color: '#ffdd00', label: 'UR' },
  secret:  { color: '#ff88ff', label: 'SE' },
};

// ─── DEFAULT CARD DATABASE ───────────────────────────────────
// These are fully custom cards that mimic YGO mechanics
const DEFAULT_CARDS = [
  // ── MONSTERS ──────────────────────────────────────────────
  {
    id: 'm001', name: '철의 수호자', type: 'monster', subtype: 'normal',
    attribute: 'EARTH', race: '전사족', level: 4,
    atk: 1800, def: 1200,
    desc: '강철 갑옷을 두른 수호의 전사. 불굴의 의지로 동료를 지킨다.',
    effects: [],
    image: '⚔️', rarity: 'common',
  },
  {
    id: 'm002', name: '폭염의 정령', type: 'monster', subtype: 'effect',
    attribute: 'FIRE', race: '화염족', level: 4,
    atk: 1600, def: 800,
    desc: '소환에 성공했을 때 상대에게 500 데미지를 준다.',
    effects: [
      {
        id: 'e_m002_1',
        trigger: 'on_summon',
        condition: null,
        actions: [{ type: 'damage', target: 'opponent', value: 500 }],
        cost: [],
        once: true,
        description: '소환 시 상대에게 500 데미지',
      }
    ],
    image: '🔥', rarity: 'rare',
  },
  {
    id: 'm003', name: '심해의 여왕', type: 'monster', subtype: 'effect',
    attribute: 'WATER', race: '수족', level: 5,
    atk: 2100, def: 1500,
    desc: '일반 소환 시 1체 릴리스. 소환 성공 시 카드를 1장 드로우한다.',
    effects: [
      {
        id: 'e_m003_1',
        trigger: 'on_summon',
        condition: null,
        actions: [{ type: 'draw', value: 1 }],
        cost: [],
        once: true,
        description: '소환 시 1장 드로우',
      }
    ],
    image: '🌊', rarity: 'super',
  },
  {
    id: 'm004', name: '어둠의 마법사', type: 'monster', subtype: 'effect',
    attribute: 'DARK', race: '마법사족', level: 6,
    atk: 2200, def: 1000,
    desc: '일반 소환 시 2체 릴리스. 이 카드가 전투로 상대 몬스터를 파괴했을 때 상대에게 800 데미지를 준다.',
    effects: [
      {
        id: 'e_m004_1',
        trigger: 'on_attack',
        condition: null,
        actions: [{ type: 'damage', target: 'opponent', value: 800 }],
        cost: [],
        once: false,
        description: '전투 파괴 시 상대에게 800 데미지',
      }
    ],
    image: '🌑', rarity: 'ultra',
  },
  {
    id: 'm005', name: '빛의 천사', type: 'monster', subtype: 'effect',
    attribute: 'LIGHT', race: '천사족', level: 4,
    atk: 1400, def: 1600,
    desc: '이 카드가 묘지로 보내졌을 때 LP를 500 회복한다.',
    effects: [
      {
        id: 'e_m005_1',
        trigger: 'on_send_to_gy',
        condition: null,
        actions: [{ type: 'heal', value: 500 }],
        cost: [],
        once: true,
        description: '묘지로 보내졌을 때 500 LP 회복',
      }
    ],
    image: '👼', rarity: 'rare',
  },
  {
    id: 'm006', name: '폭풍의 용', type: 'monster', subtype: 'effect',
    attribute: 'WIND', race: '드래곤족', level: 7,
    atk: 2600, def: 2000,
    desc: '이 카드를 일반 소환하려면 2체를 릴리스해야 한다. 소환 성공 시 상대 마법/함정 카드 1장을 파괴한다.',
    effects: [
      {
        id: 'e_m006_1',
        trigger: 'on_summon',
        condition: null,
        actions: [{ type: 'destroy', target: 'any_spell_field', value: 1 }],
        cost: [],
        once: true,
        description: '소환 시 상대 마함 1장 파괴',
      }
    ],
    image: '🐉', rarity: 'ultra',
  },
  {
    id: 'm007', name: '그림자 도적', type: 'monster', subtype: 'effect',
    attribute: 'DARK', race: '악마족', level: 3,
    atk: 1200, def: 600,
    desc: '이 카드가 전투로 파괴되었을 때 덱 상단 2장을 묘지로 보낸다.',
    effects: [
      {
        id: 'e_m007_1',
        trigger: 'on_destroy',
        condition: null,
        actions: [{ type: 'mill', target: 'opponent', value: 2 }],
        cost: [],
        once: true,
        description: '전투 파괴 시 상대 덱 2장 묘지로',
      }
    ],
    image: '🗡️', rarity: 'common',
  },
  {
    id: 'm008', name: '대지의 거인', type: 'monster', subtype: 'normal',
    attribute: 'EARTH', race: '암석족', level: 5,
    atk: 1900, def: 2400,
    desc: '대지의 힘으로 만들어진 불굴의 거인. 높은 수비력을 자랑한다.',
    effects: [],
    image: '🪨', rarity: 'common',
  },
  {
    id: 'm009', name: '번개의 무사', type: 'monster', subtype: 'effect',
    attribute: 'LIGHT', race: '전사족', level: 3,
    atk: 1500, def: 900,
    desc: '이 카드가 공격할 때 상대 몬스터의 ATK를 300 감소시킨다.',
    effects: [
      {
        id: 'e_m009_1',
        trigger: 'on_attack',
        condition: null,
        actions: [{ type: 'change_atk', target: 'opponent_monster', value: -300 }],
        cost: [],
        once: false,
        description: '공격 시 대상 ATK -300',
      }
    ],
    image: '⚡', rarity: 'rare',
  },
  {
    id: 'm010', name: '수호 정령', type: 'monster', subtype: 'effect',
    attribute: 'LIGHT', race: '천사족', level: 2,
    atk: 800, def: 1400,
    desc: '이 카드가 필드에 있는 한 자신의 LP가 2000 이하가 될 때 1500 LP를 회복한다. (1회)',
    effects: [
      {
        id: 'e_m010_1',
        trigger: 'continuous',
        condition: 'ctx.state.players[ctx.controller].lp <= 2000',
        actions: [{ type: 'heal', value: 1500 }],
        cost: [],
        once: true,
        description: 'LP 2000 이하 시 1500 회복 (1회)',
      }
    ],
    image: '🌟', rarity: 'super',
  },
  {
    id: 'm011', name: '심연의 군주', type: 'monster', subtype: 'effect',
    attribute: 'DARK', race: '악마족', level: 8,
    atk: 3000, def: 2500,
    desc: '특수 소환 불가. 이 카드를 일반 소환하려면 3체를 릴리스해야 한다. 소환 성공 시 상대 필드의 몬스터를 모두 파괴한다.',
    effects: [
      {
        id: 'e_m011_1',
        trigger: 'on_summon',
        condition: null,
        actions: [{ type: 'destroy', target: 'opponent_monster', value: 99 }],
        cost: [],
        once: true,
        description: '소환 시 상대 몬스터 전체 파괴',
      }
    ],
    image: '💀', rarity: 'secret',
  },
  {
    id: 'm012', name: '초록 요정', type: 'monster', subtype: 'normal',
    attribute: 'WIND', race: '요정족', level: 2,
    atk: 900, def: 700,
    desc: '숲속에 사는 자연의 정령. 작지만 빠르다.',
    effects: [],
    image: '🍃', rarity: 'common',
  },

  // ── FUSION MONSTERS ───────────────────────────────────────
  {
    id: 'f001', name: '혼돈의 쌍룡', type: 'monster', subtype: 'fusion',
    attribute: 'DARK', race: '드래곤족', level: 8,
    atk: 3200, def: 2800,
    desc: '「폭풍의 용」+「어둠의 마법사」 이 카드는 덱에서 융합 소환할 수 없다.',
    effects: [],
    image: '🐲', rarity: 'ultra',
    fusionMaterials: ['m004', 'm006'],
  },

  // ── SPELLS ────────────────────────────────────────────────
  {
    id: 's001', name: '지식의 두루마리', type: 'spell', subtype: 'normal',
    desc: '덱에서 카드를 2장 드로우한다.',
    effects: [
      {
        id: 'e_s001_1',
        trigger: 'on_activate',
        condition: null,
        actions: [{ type: 'draw', value: 2 }],
        cost: [],
        once: true,
        description: '발동 시 2장 드로우',
      }
    ],
    image: '📜', rarity: 'rare',
  },
  {
    id: 's002', name: '섬멸의 빛', type: 'spell', subtype: 'normal',
    desc: '상대 필드의 몬스터를 모두 파괴한다.',
    effects: [
      {
        id: 'e_s002_1',
        trigger: 'on_activate',
        condition: null,
        actions: [{ type: 'destroy', target: 'opponent_monster', value: 99 }],
        cost: [],
        once: true,
        description: '상대 몬스터 전체 파괴',
      }
    ],
    image: '☀️', rarity: 'ultra',
  },
  {
    id: 's003', name: '치유의 샘', type: 'spell', subtype: 'normal',
    desc: 'LP를 1000 회복한다.',
    effects: [
      {
        id: 'e_s003_1',
        trigger: 'on_activate',
        condition: null,
        actions: [{ type: 'heal', value: 1000 }],
        cost: [],
        once: true,
        description: '1000 LP 회복',
      }
    ],
    image: '💧', rarity: 'common',
  },
  {
    id: 's004', name: '마력 폭발', type: 'spell', subtype: 'quickplay',
    desc: '상대에게 1000 데미지를 준다. 속공 마법.',
    effects: [
      {
        id: 'e_s004_1',
        trigger: 'on_activate',
        condition: null,
        actions: [{ type: 'damage', target: 'opponent', value: 1000 }],
        cost: [],
        once: true,
        description: '상대에게 1000 데미지',
      }
    ],
    image: '💥', rarity: 'super',
  },
  {
    id: 's005', name: '강제 귀환', type: 'spell', subtype: 'normal',
    desc: '상대 몬스터 1체를 핸드로 되돌린다.',
    effects: [
      {
        id: 'e_s005_1',
        trigger: 'on_activate',
        condition: null,
        actions: [{ type: 'return_hand', target: 'opponent_monster', value: 1 }],
        cost: [],
        once: true,
        description: '상대 몬스터 1체를 핸드로',
      }
    ],
    image: '↩️', rarity: 'rare',
  },
  {
    id: 's006', name: '봉인의 인장', type: 'spell', subtype: 'continuous',
    desc: '이 카드가 필드에 있는 한 자신의 몬스터 ATK가 200 증가한다.',
    effects: [
      {
        id: 'e_s006_1',
        trigger: 'continuous',
        condition: null,
        actions: [{ type: 'change_atk', target: 'own_monster', value: 200 }],
        cost: [],
        once: false,
        description: '자신 몬스터 ATK +200',
      }
    ],
    image: '🔮', rarity: 'super',
  },
  {
    id: 's007', name: '소생의 빛', type: 'spell', subtype: 'normal',
    desc: '자신의 묘지에서 몬스터 1체를 특수 소환한다.',
    effects: [
      {
        id: 'e_s007_1',
        trigger: 'on_activate',
        condition: null,
        actions: [{ type: 'special_summon', target: 'from_gy' }],
        cost: [],
        once: true,
        description: '묘지에서 몬스터 1체 특수 소환',
      }
    ],
    image: '✨', rarity: 'ultra',
  },
  {
    id: 's008', name: '덱 통찰', type: 'spell', subtype: 'normal',
    desc: '덱 상단 3장을 확인하고 원하는 순서로 되돌린다.',
    effects: [
      {
        id: 'e_s008_1',
        trigger: 'on_activate',
        condition: null,
        actions: [{ type: 'mill', target: 'self', value: 0 }], // special handling
        cost: [],
        once: true,
        description: '덱 상단 3장 확인',
      }
    ],
    image: '🔭', rarity: 'rare',
  },

  // ── TRAPS ─────────────────────────────────────────────────
  {
    id: 't001', name: '반격의 함정', type: 'trap', subtype: 'normal',
    desc: '상대 몬스터의 공격 선언 시 발동. 그 공격을 무효로 하고 상대에게 600 데미지.',
    effects: [
      {
        id: 'e_t001_1',
        trigger: 'quick_effect',
        condition: null,
        actions: [
          { type: 'negate' },
          { type: 'damage', target: 'opponent', value: 600 }
        ],
        cost: [],
        once: true,
        description: '공격 무효 + 600 데미지',
      }
    ],
    image: '⚠️', rarity: 'rare',
  },
  {
    id: 't002', name: '파멸의 罠', type: 'trap', subtype: 'normal',
    desc: '상대 몬스터 1체를 파괴한다.',
    effects: [
      {
        id: 'e_t002_1',
        trigger: 'quick_effect',
        condition: null,
        actions: [{ type: 'destroy', target: 'opponent_monster', value: 1 }],
        cost: [],
        once: true,
        description: '상대 몬스터 1체 파괴',
      }
    ],
    image: '🕳️', rarity: 'super',
  },
  {
    id: 't003', name: '성역의 방패', type: 'trap', subtype: 'continuous',
    desc: '이 카드가 필드에 있는 한 자신이 받는 전투 데미지를 500 감소시킨다.',
    effects: [
      {
        id: 'e_t003_1',
        trigger: 'continuous',
        condition: null,
        actions: [],
        cost: [],
        once: false,
        description: '전투 데미지 500 감소',
        damageReduce: 500,
      }
    ],
    image: '🛡️', rarity: 'rare',
  },
  {
    id: 't004', name: '카운터의 역습', type: 'trap', subtype: 'counter',
    desc: '상대 효과 발동 시 그것을 무효로 한다.',
    effects: [
      {
        id: 'e_t004_1',
        trigger: 'quick_effect',
        condition: null,
        actions: [{ type: 'negate' }],
        cost: [],
        once: true,
        description: '효과 무효',
      }
    ],
    image: '🔄', rarity: 'ultra',
  },
  {
    id: 't005', name: '차원의 균열', type: 'trap', subtype: 'normal',
    desc: '상대 몬스터 1체를 게임에서 제외한다.',
    effects: [
      {
        id: 'e_t005_1',
        trigger: 'quick_effect',
        condition: null,
        actions: [{ type: 'banish', target: 'opponent_monster', value: 1 }],
        cost: [],
        once: true,
        description: '상대 몬스터 1체 제외',
      }
    ],
    image: '🌀', rarity: 'super',
  },
];

// Build card index
function buildCardIndex(cards) {
  const idx = {};
  cards.forEach(c => idx[c.id] = c);
  return idx;
}
