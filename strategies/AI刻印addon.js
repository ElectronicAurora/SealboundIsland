/* ===========================================================================
 * 末环协议 · AI 刻印策略 · smart2
 * =========================================================================== */

const STRATEGY = {
  name: 'smart2：局势感知 + 组合收益 + 破壁',

  pickSeal(ctx) {
    const me = ctx.me, f = ctx.field;
    const owned = id => (me.seals[id] || 0) > 0;
    const cnt   = id => me.seals[id] || 0;
    const can   = id => ctx.candidates.indexOf(id) >= 0;

    /* ================= 0. 局势分档 ================= */
    const hpR      = me.maxHp > 0 ? me.hp / me.maxHp : 1;
    const foeDust  = f.avgFoeDust || 0;
    const selfAtk  = me.atk || 1;
    const layerSum = Object.keys(me.seals || {}).reduce((s, k) => s + (me.seals[k] || 0), 0);

    let phase;
    if (hpR <= 0.3)                            phase = 'pressured';
    else if (foeDust >= 3)                     phase = 'walled';
    else if (f.aliveFoes <= 1 && f.round >= 3) phase = 'endgame';
    else if (selfAtk <= 1 || layerSum === 0)   phase = 'develop';
    else                                       phase = 'engage';

    /* ================= 1. 破壁硬路由 ================= */
    if (phase === 'walled') {
      if (can('9b'))                     return '9b';
      if (can('12b'))                    return '12b';
      if (can('9')  && !owned('9'))      return '9';
      if (can('12') && !owned('12'))     return '12';
    }

    /* ================= 2. 动态评分 ================= */
    const sc = [];
    const add = (id, s) => { if (s > 0 && can(id)) sc.push({ id, s }); };
    /* 5b 的分数集中在一个变量里，避免三重 add 把权重放大 */
    let s5b = 0;

    /* ---- ⑤ 残锋 ---- */
    if (can('5') && !owned('5')) {
      let s;
      if (me.maxHp <= 8)                 s = 130;
      else if (me.hp <= 5)               s = 125;
      else if (me.hp <= 10 && hpR <= .4) s = 95;
      else if (me.maxHp <= 15)           s = 55;
      else                               s = 22;
      add('5', s);
    }

    /* ---- ⑤b 残锋分支：残血时才值 145，否则 90 ---- */
    if (can('5b')) {
      s5b = Math.max(s5b, me.hp <= 10 ? 145 : 90);
    }

    /* ---- ⑨ / ⑨b ---- */
    if (can('9') && !owned('9')) add('9', foeDust >= 2 ? 85 : 68);
    if (owned('9') && can('9b')) s5b = s5b;  // 占位：9b 单独在组合段处理

    /* ---- ① 劫雷 ---- */
    if (can('1')) {
      if (!owned('1')) add('1', selfAtk >= 5 ? 72 : 52);
      else             add('1', 100);
    }

    /* ---- ③ 丰穰 ---- */
    if (can('3')) add('3', phase === 'develop' ? 68 : 32);

    /* ---- ④ / ④b ---- */
    if (can('4') && !owned('4')) add('4', 42);
    if (can('4b'))               add('4b', 150);

    /* ---- ⑥ / ⑥b：前期提到 82，抢得过 ⑨/①/⑫ ---- */
    if (can('6') && !owned('6')) add('6', f.round <= 3 ? 82 : 28);
    if (can('6b'))               add('6b', f.hasSummon ? 175 : 135);

    /* ---- ⑦ 蹑景 ---- */
    if (can('7')) add('7', 45 + 22 * cnt('7'));

    /* ---- ⑧a / ⑧b ---- */
    if (can('8a') && cnt('8a') < 4) add('8a', f.round >= 5 ? 62 : 42);
    if (can('8b') && !owned('8b')) {                 // ★ 修 bug：已持有不再重复拿
      const nA = cnt('8a');
      if (nA >= 1) add('8b', nA >= 2 ? 78 : 52);
    }

    /* ---- ⑩ / ⑩b ---- */
    if (can('10') && !owned('10')) add('10', f.hasSummon ? 68 : 18);
    if (can('10b'))                add('10b', f.hasSummon ? 128 : 88);

    /* ---- ⑪ / ⑪b ---- */
    if (can('11') && !owned('11')) add('11', 38);
    if (can('11b'))                add('11b', 105);

    /* ---- ⑫ / ⑫b ---- */
    if (can('12') && !owned('12')) add('12', me.maxHp >= 15 ? 72 : 28);
    if (can('12b'))                add('12b', foeDust >= 2 ? 130 : (me.maxHp >= 15 ? 125 : 75));

    /* ---- ⑬ / ⑬b ---- */
    if (can('13') && !owned('13')) add('13', f.gear >= 2 ? 78 : 28);
    if (can('13b'))                add('13b', 100);

    /* ---- ② 同契 ---- */
    if (can('2') && !owned('2')) add('2', f.mode === 'ffa' ? 0 : 75);

    /* ================= 3. 组合收益：补分支（取 max 而非累加） ================= */
    if (owned('9')  && can('9b'))  add('9b',  80);
    if (owned('12') && can('12b')) add('12b', 80);
    if (owned('4')  && can('4b'))  add('4b',  60);
    if (owned('5')  && can('5b'))  s5b = Math.max(s5b, 60);         // ★ 改 max
    if (owned('6')  && can('6b'))  add('6b',  60);
    if (owned('10') && can('10b')) add('10b', 60);
    if (owned('11') && can('11b')) add('11b', 60);
    if (owned('13') && can('13b')) add('13b', 60);

    /* 跨项协同：也只取 max，不叠加 */
    if (owned('7') && (owned('9') || owned('9b')) && can('9b'))
      add('9b', Math.max(80, 40));
    if (cnt('8a') >= 2 && owned('8b') && owned('5') && can('5b'))
      s5b = Math.max(s5b, 40);                                     // ★ 改 max
    if (owned('1') && cnt('1') >= 1 && owned('12b') && can('1'))
      add('1', Math.max(100, 30));

    /* 5b 最终只 add 一次 */
    if (s5b > 0 && can('5b')) add('5b', s5b);

    /* ================= 4. 加权随机 ================= */
    if (!sc.length) return null;
    sc.sort((a, b) => b.s - a.s);
    const sum = sc.reduce((s, x) => s + x.s, 0);
    let r = Math.random() * sum;
    for (const x of sc) if ((r -= x.s) < 0) return x.id;
    return sc[sc.length - 1].id;
  },

  /* 占位：本策略 pickSeal 从不返回 '8'，此函数保留给用户改造 */
  pickSealBranch(ctx) {
    if (ctx.baseId !== '8') return null;
    return (ctx.me.seals['8a'] || 0) >= 2 ? '8b' : '8a';
  },

  pickPaint(ctx) {
    const t = ctx.target;
    if (!t) return null;
    const can = c => ctx.candidates.indexOf(c) >= 0;

    if (t.hp <= 4 && can('red'))                       return 'red';
    if (t.atk >= 8 && !t.blue && can('blue'))          return 'blue';
    if (t.dust >= 3 && can('grey'))                    return { color: 'grey', clearKey: 'dust' };
    if (can('black')) {
      const blacked = t.blacked || [];
      if ((t.seals['12'] || 0) > 0 && blacked.indexOf('12') < 0) return { color: 'black', sealId: '12' };
      if (blacked.indexOf('9') < 0)                             return { color: 'black', sealId: '9' };
    }
    return null;
  }
};