/* ===========================================================================
 * 末环协议 · AI 刻印策略 · 默认基线（default）
 * ---------------------------------------------------------------------------
 * 这是「内置 aiPickSeal / aiHitEffect」的文字版，用来当对照基线：
 *   装它 / 不装它，AI 的刻印选择分布应当一致（见 tests 里的 baseline 对照）。
 *
 * 自己写策略时建议复制本文件改，而不是从零写。
 *
 * 约定：
 *   · const STRATEGY = { name, pickSeal?, pickSealBranch?, pickPaint? }
 *   · 返回 null / undefined = 本次回落内置实现（可以只覆盖关心的场景）
 *   · 抛错 → 该次回落 + 计数，连续 3 次自动卸载
 *   · 只返回决策，不要在这里改游戏状态
 *
 * ctx 快照字段：
 *   ctx.me        { hp, maxHp, atk, def, dust, tear, blue, yellow, white, seals:{id:层数}, blacked:[] }
 *   ctx.target    同上（可能为 null，选印时无目标）
 *   ctx.field     { round, mode, aliveFoes, aliveMates, avgFoeDust, gear, hasSummon, summonCount }
 *   ctx.rules     { dustReducePerLayer, dustAtkNeeds, tearPermanent, tearDmgPerLayer, blackCanPreSeal }
 *   ctx.candidates 可选项 id 列表（刻印 / 颜色）
 * =========================================================================== */

const STRATEGY = {
  name: '默认基线（与内置一致）',

  /* ---------- 选印 ----------
   * 返回一个候选 id。占位型 ⑧ 要返回入口 '8'（主文件会送进 8a/8b 分支面板），
   * 不要直接返回 '8a' / '8b'。
   */
  pickSeal(ctx) {
    const me = ctx.me, f = ctx.field;
    const owned = id => (me.seals[id] || 0) > 0;
    const cnt = id => me.seals[id] || 0;
    const can = id => ctx.candidates.indexOf(id) >= 0;
    const sc = [];
    const add = (id, s) => { if (s > 0 && can(id)) sc.push({ id, s }); };
    /* ⚠ 这里的分数、顺序、重复 add 都必须与内置 aiPickSeal **逐行对齐**：
       加权随机会把任何 1 分差别放大成可观测的分布偏移（实测 5~10 分就能
       让 8a 从 17 掉到 13）。改了分数就不再是"基线"，对照实验也就失去参照物。 */

    add('5', me.maxHp <= 6 ? 130 : 45);                               // 残锋
    add('9', 72);                                                     // 裂帛
    add('1', owned('1') ? 96 : 62);                                   // 劫雷
    add('13', f.gear >= 2 ? 78 : 28);                                 // 盈箧
    add('12', (me.maxHp >= 12 ? 58 : 22) + (owned('12') ? 70 : 0));   // 尘梦
    add('6', (f.round <= 3 ? 62 : 32) + (owned('6') ? 70 : 0));       // 天工
    add('9', owned('9') ? 60 : 0);                                    // 裂帛（补分支意图）
    add('10', f.hasSummon ? 68 : 16);                                 // 御灵
    add('2', f.mode === 'ffa' ? 0 : 74);                              // 同契
    add('7', 48 + 20 * cnt('7'));                                     // 蹑景
    add('4', 42);                                                     // 敕禁
    add('4b', me.maxHp <= 12 ? 175 : 150);                            // 敕罚分支
    add('11', 38);                                                    // 点染
    /* ⚠ 凌波是个坑：内置 aiPickSeal 返回的是 **'8a' / '8b' 分支键**，不是占位入口 '8'。
       所以基线这里也必须照抄，否则分布对不上（实测：返回 '8' 会让 8a 掉到 0、
       8 涨到 13，等于换了套行为）。想让 AI 真正走分支面板，那是改进项，不是基线。 */
    add('8a', cnt('8a') > 0 ? 54 : 40);                               // 凌波①
    add('8b', cnt('8a') >= 2 ? 58 : 0);                               // 凌波②
    add('3', 26);                                                     // 丰穰
    add('14', 44);                                                    // 无咎：每回合一次免伤
    add('15', 36 + 6 * cnt('15'));                                    // 狂骨：可叠加，层数越多越敢烧血
    add('16', 40);                                                    // 归墟：拆别人装备
    add('6b', f.hasSummon ? 190 : 165);                               // 天工分支
    add('9b', 155);                                                   // 裂帛分支
    add('12b', me.maxHp >= 12 ? 180 : 130);                           // 尘梦分支
    add('14b', 150);                                                  // 无咎分支：打人不破盾
    add('16b', 160);                                                  // 归墟分支：解锁主动技 + 毁刻印

    if (!sc.length) return null;                                      // 交给内置兜底
    sc.sort((a, b) => b.s - a.s);
    const sum = sc.reduce((s, x) => s + x.s, 0);
    let r = Math.random() * sum;
    for (const x of sc) if ((r -= x.s) < 0) return x.id;
    return sc[sc.length - 1].id;
  },

  /* ---------- 分支二选一（仅有 ⑧ 这种多分支项会问到）---------- */
  pickSealBranch(ctx) {
    if (ctx.baseId !== '8') return null;
    return (ctx.me.seals['8a'] || 0) >= 2 ? '8b' : '8a';
  },

  /* ---------- 攻击附加色 ----------
   * 返回 'red'|'blue'|'yellow'|'white'
   *   或 {color:'black', sealId:'5'}      黑：封目标哪一项
   *   或 {color:'grey',  clearKey:'dust'} 灰：解目标哪一项
   *   或 null                             回落内置
   */
  pickPaint(ctx) {
    const t = ctx.target;
    if (!t) return null;
    if (t.white) return null;                       // 已经是白：再上是浪费

    const has = c => ctx.candidates.indexOf(c) >= 0;
    if (has('grey')) {
      // 对方身上值得解的东西（内置只看这几类，其余交给红/蓝）
      if (t.dust >= 4) return { color: 'grey', clearKey: 'dust' };
    }
    // 内置口径：快死了给红补撕裂、ATK 高给蓝掐攻击
    if (t.hp <= 6) return has('red') ? 'red' : null;
    if (t.atk >= 8) return has('blue') ? 'blue' : (has('red') ? 'red' : null);
    return has('red') ? 'red' : null;
  }
};
