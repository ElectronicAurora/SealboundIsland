/* ===========================================================================
 * 末环协议 · AI 刻印策略 · 示例（example）
 * ---------------------------------------------------------------------------
 * 这个文件不是"更强"的策略，只是演示接口能干什么：
 *   1. 选印：残血时优先补「能立刻救命」的项（残锋 / 凌波 / 御灵）
 *   2. 上色：① 给对方厚尘目标上【灰】解掉【尘】（撕开减伤）
 *           ② 对方有高 ATK 且没蓝 → 上蓝
 *           ③ 对方血少 → 上红补撕裂
 *           ④ 其余返回 null 交给内置
 * 装它在开局面板「导入策略…」→ 粘贴 → 应用。
 * =========================================================================== */

const STRATEGY = {
  name: '示例：残血优先 + 解尘灰',

  pickSeal(ctx) {
    const me = ctx.me;
    const lowHp = me.hp <= me.maxHp * 0.4;
    const has = id => (me.seals[id] || 0) > 0;
    const pick = id => ctx.candidates.indexOf(id) >= 0 ? id : null;

    if (lowHp) {
      // 残血时的救命顺位：残锋（低血爆发）> 凌波（闪避）> 御灵（多一个单位）
      const lifesaver = [pick('5'), pick('8a'), pick('10')].find(Boolean);
      if (lifesaver) return lifesaver;
    }
    // 其余情况：交给内置评分（返回 null = 回落）
    // 但如果能补尘梦分支，优先补（这是个演示：只在有基础时生效）
    if (!has('12') && pick('12')) return '12';
    if (has('12') && pick('12b')) return '12b';
    return null;
  },

  pickPaint(ctx) {
    const t = ctx.target;
    if (!t) return null;
    const has6 = ctx.candidates.indexOf('black') >= 0;

    // ① 对方厚尘 → 用灰把【尘】解掉，等于给自己整队开一条伤害通道
    if (has6 && t.dust >= 4 && ctx.candidates.indexOf('grey') >= 0) {
      return { color: 'grey', clearKey: 'dust' };
    }
    // ② 对方攻击高、且还没被蓝 → 上蓝掐一手
    if (t.atk >= 9 && !t.blue && ctx.candidates.indexOf('blue') >= 0) return 'blue';
    // ③ 对方血薄 → 上红补撕裂（撕裂层数不清零，越早挂越赚）
    if (t.hp <= 8 && ctx.candidates.indexOf('red') >= 0) return 'red';
    // ④ 其余交给内置
    return null;
  }
};
