//
// views/pet.js — 顶栏互动宠物陪伴 v2
// 视觉：SVG 分层建模 + 渐变光影/毛发纹理/环境光遮蔽（每只宠物独立渐变 id，避免跨 SVG 冲突）
// 动作：行走/奔跑/跳跃/摆尾/蹭蹭/打滚/伸腰/睡觉/好奇/满足呼噜等大幅动作库（CSS 骨骼式关键帧）
// 交互：点击宠物 = 摸摸 → 按亲密度分层反馈情绪（好奇→开心→撒娇）；⇄ 小按钮或右键打开切换弹层
// 动作随机间隔 3~10s；选择结果与亲密度持久化到 localStorage；全部本地执行，反馈 <100ms
// 新增宠物只需在 PET_REGISTRY 追加一个条目（key + 文案 + build 构造器）
//
import { el, clear } from '../ui.js';

// ---------- 宠物注册表（对外配置接口）：key → 名称/文案/SVG 构造器 ----------
export const PET_REGISTRY = {
  cat: {
    key: 'cat', name: '橘猫', tagline: '慵懒治愈 · 爱打盹', voice: '喵',
    build: buildCatSVG,
  },
  dog: {
    key: 'dog', name: '柴犬', tagline: '元气满满 · 爱摇尾巴', voice: '汪',
    build: buildDogSVG,
  },
};

const STORAGE_KEY = 'mtable.pet.type';
const CLOSENESS_KEY = 'mtable.pet.closeness';

// 渐变 id 计数器：每份 SVG 实例独立 id，防止 stage 与选择卡片间引用串扰
let __uid = 0;

// ---------- 动作库：dur 为动作时长(ms)，bubbles 为气泡台词，fx 为伴生粒子特效 ----------
const ACTIONS = {
  sleep:   { dur: 5200, bubbles: ['Zzz…', '呼噜呼噜…', '做个好梦…'], fx: ['zzz'] },
  stretch: { dur: 2600, bubbles: ['伸个大懒腰~', '哈——啊~', '睡醒了！'], fx: [] },
  walk:    { dur: 3200, bubbles: ['散步散步~', '左脚~右脚~', '哒哒哒…'], fx: [] },
  run:     { dur: 2600, bubbles: ['冲鸭！', '风一样快！', '追上你哦！'], fx: [] },
  jump:    { dur: 2000, bubbles: ['蹦！', '跳高高！', '看我飞起来！'], fx: ['heart'] },
  wag:     { dur: 2400, bubbles: ['尾巴摇起来！', '好开心呀~', '屁股扭扭~'], fx: [] },
  nuzzle:  { dur: 2800, bubbles: ['蹭蹭~', '最喜欢你啦♥', '再摸摸嘛~'], fx: ['heart', 'note'] },
  roll:    { dur: 2800, bubbles: ['打个滚~', '地板好舒服！', '滚滚滚滚…'], fx: ['spark'] },
  happy:   { dur: 2000, bubbles: ['今天也要加油鸭！', '见到你超开心！', '比心 ♥'], fx: ['heart'] },
  wink:    { dur: 1700, bubbles: ['嘿嘿~', '被我发现了吧！', '在看你哦~'], fx: [] },
  look:    { dur: 2400, bubbles: ['咦？', '那边有什么？'], fx: [] },
  curious: { dur: 2400, bubbles: ['嗯？', '你在叫我吗？', '这是什么呀？'], fx: ['spark'] },
  purr:    { dur: 3200, bubbles: ['呼噜呼噜…', '好满足呀~', '就是这样，继续~'], fx: ['note'] },
  sit:       { dur: 3000, bubbles: ['蹲好等你~', '乖乖坐好', '要摸摸头吗？'], fx: [] },
  hop:       { dur: 2400, bubbles: ['蹦跶蹦跶~', '跳跳糖！', '一蹦一跳~'], fx: ['spark'] },
  shake:     { dur: 1600, bubbles: ['甩甩脑袋~', '清醒啦！'], fx: [] },
  groom:     { dur: 3200, bubbles: ['舔舔毛~', '爱干净的我', '理理毛发~'], fx: [] },
  tailflick: { dur: 2200, bubbles: ['甩尾巴~', '心情不错哦~'], fx: [] },
};

// 待机随机池（去掉只在交互时触发的部分高亲密度动作，保持惊喜感）
const IDLE_POOL = ['sleep', 'stretch', 'walk', 'look', 'wink', 'wag', 'curious', 'happy', 'run',
  'sit', 'hop', 'shake', 'groom', 'tailflick', 'walk', 'tailflick', 'sit', 'groom'];

// 交互响应池：按亲密度分档（0-4 初识 → 5-14 熟悉 → 15+ 亲密）
const RESPONSE_TIERS = [
  ['curious', 'look', 'wink', 'curious'],
  ['happy', 'jump', 'wag', 'nuzzle', 'happy'],
  ['nuzzle', 'roll', 'purr', 'happy', 'nuzzle', 'purr'],
];

// 未领养时的爪印入口图标
const PAW_ICON = '<svg viewBox="0 0 24 24" width="24" height="24"><g fill="currentColor">'
  + '<ellipse cx="6.4" cy="9.4" rx="1.9" ry="2.5"/><ellipse cx="12" cy="7.6" rx="2" ry="2.6"/>'
  + '<ellipse cx="17.6" cy="9.4" rx="1.9" ry="2.5"/>'
  + '<path d="M12 11.4c-3.7 0-6.2 2.7-6.2 5.1 0 1.8 1.4 3 3 3 1.1 0 2.1-.5 3.2-.5s2.1.5 3.2.5c1.6 0 3-1.2 3-3 0-2.4-2.5-5.1-6.2-5.1Z"/>'
  + '</g></svg>';

// 更换伙伴的小按钮图标（⇄）
const SWITCH_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M1.5 5h10M9 2.5 11.8 5 9 7.5"/><path d="M14.5 11h-10M6.5 8.5 3.7 11l2.8 2.5"/></svg>';

// ---------- 橘猫 SVG ----------
// 分层：尾巴/身体/爪子/头（供 CSS 按组做骨骼式动画）
// 材质：radialGradient 皮毛渐变 + 腹部奶油渐变 + 顶部受光 + 环境光遮蔽 + 虎斑纹理 + 毛发丝
function buildCatSVG() {
  const u = `cat${++__uid}`;
  return `
    <defs>
      <radialGradient id="${u}-fur" cx="38%" cy="28%" r="88%">
        <stop offset="0%" stop-color="#ffc76e"/>
        <stop offset="55%" stop-color="#f5a742"/>
        <stop offset="100%" stop-color="#e08c2c"/>
      </radialGradient>
      <linearGradient id="${u}-cream" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fff3d6"/>
        <stop offset="100%" stop-color="#f6dcae"/>
      </linearGradient>
      <radialGradient id="${u}-sh" cx="50%" cy="50%" r="55%">
        <stop offset="0%" stop-color="#2b2340" stop-opacity=".30"/>
        <stop offset="100%" stop-color="#2b2340" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${u}-ear" cx="50%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#ffd3dd"/>
        <stop offset="100%" stop-color="#f4a4bb"/>
      </radialGradient>
      <radialGradient id="${u}-vol" cx="34%" cy="26%" r="82%">
        <stop offset="52%" stop-color="#7a4a12" stop-opacity="0"/>
        <stop offset="100%" stop-color="#7a4a12" stop-opacity=".30"/>
      </radialGradient>
    </defs>
    <ellipse class="pet-shadow" cx="60" cy="105" rx="32" ry="5.5" fill="url(#${u}-sh)"/>
    <g class="pet-inner">
      <g class="pet-tail">
        <path d="M82 94 Q107 92 105 67 Q103 53 90 54" fill="none" stroke="#e08a2e" stroke-width="11.5" stroke-linecap="round"/>
        <path d="M82 94 Q105 92 103 70 Q102 60 95 57" fill="none" stroke="#f9b862" stroke-width="4.6" stroke-linecap="round" opacity=".85"/>
      </g>
      <g class="pet-body">
        <path d="M60 58 C36 58 30 86 33 99 C35 108 85 108 87 99 C90 86 84 58 60 58 Z" fill="url(#${u}-fur)"/>
        <path d="M60 58 C36 58 30 86 33 99 C35 108 85 108 87 99 C90 86 84 58 60 58 Z" fill="url(#${u}-vol)"/>
        <path d="M56 59 C41 61 33 75 32.6 92" fill="none" stroke="#ffe7bb" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>
        <g stroke="#d97f22" stroke-width="3" stroke-linecap="round" fill="none" opacity=".5">
          <path d="M45 68 q4.5 5.5 2 12"/><path d="M60 64 q1 7 -1.5 13"/><path d="M75 68 q-4.5 5.5 -2 12"/>
        </g>
        <path d="M60 74 C50 74 45 92 47.5 101 C52.5 105 67.5 105 72.5 101 C75 92 70 74 60 74 Z" fill="url(#${u}-cream)"/>
        <ellipse cx="60" cy="63" rx="15" ry="4.5" fill="#9c5c16" opacity=".22"/>
        <ellipse cx="46" cy="70" rx="14" ry="8" fill="#ffffff" opacity=".13"/>
        <g stroke="#e08a2e" stroke-width="1.1" stroke-linecap="round" opacity=".45" fill="none">
          <path d="M38 84 q-1.5 4 .5 7"/><path d="M82 84 q1.5 4 -.5 7"/>
        </g>
      </g>
      <g class="pet-paw pet-paw-l">
        <ellipse cx="47" cy="101" rx="8.5" ry="5.5" fill="#f5a742"/><ellipse cx="45.5" cy="99.5" rx="4" ry="1.8" fill="#ffffff" opacity=".25"/>
        <path d="M44.5 99.5 v3 M47.5 99.5 v3" stroke="#e08a2e" stroke-width="1" stroke-linecap="round"/>
      </g>
      <g class="pet-paw pet-paw-r">
        <ellipse cx="73" cy="101" rx="8.5" ry="5.5" fill="#f5a742"/><ellipse cx="71.5" cy="99.5" rx="4" ry="1.8" fill="#ffffff" opacity=".25"/>
        <path d="M70.5 99.5 v3 M73.5 99.5 v3" stroke="#e08a2e" stroke-width="1" stroke-linecap="round"/>
      </g>
      <g class="pet-head">
        <g class="pet-ear pet-ear-l">
          <path d="M41 31 L34 7 L58 17 Z" fill="#f5a742"/><path d="M34 7 L58 17 L41 31 Z" fill="#ffffff" opacity=".08"/>
          <path d="M42.5 26 L38.5 13.5 L52.5 19.5 Z" fill="url(#${u}-ear)"/>
        </g>
        <g class="pet-ear pet-ear-r">
          <path d="M79 31 L86 7 L62 17 Z" fill="#f5a742"/><path d="M86 7 L62 17 L79 31 Z" fill="#ffffff" opacity=".08"/>
          <path d="M77.5 26 L81.5 13.5 L67.5 19.5 Z" fill="url(#${u}-ear)"/>
        </g>
        <circle cx="60" cy="40" r="25" fill="url(#${u}-fur)"/>
        <circle cx="60" cy="40" r="25" fill="url(#${u}-vol)"/>
        <g stroke="#d97f22" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".55">
          <path d="M53.5 20 q-.5 3.5 .5 5.5"/><path d="M60 18.5 v6"/><path d="M66.5 20 q.5 3.5 -.5 5.5"/>
        </g>
        <g stroke="#e8a34b" stroke-width="1.4" stroke-linecap="round" fill="none" opacity=".8">
          <path d="M36.5 42 l-2.5 2.2"/><path d="M83.5 42 l2.5 2.2"/>
        </g>
        <path d="M42 23 a21 18 0 0 1 36 0" stroke="#ffffff" stroke-width="2.2" fill="none" opacity=".3" stroke-linecap="round"/>
        <g class="pet-eyes-open">
          <g class="pet-eye pet-eye-l">
            <circle cx="50" cy="40" r="3.8" fill="#3a2e2a"/><circle cx="51.5" cy="38.5" r="1.5" fill="#fff"/><circle cx="49" cy="41.5" r=".7" fill="#fff" opacity=".8"/>
          </g>
          <g class="pet-eye pet-eye-r">
            <circle cx="70" cy="40" r="3.8" fill="#3a2e2a"/><circle cx="71.5" cy="38.5" r="1.5" fill="#fff"/><circle cx="69" cy="41.5" r=".7" fill="#fff" opacity=".8"/>
          </g>
        </g>
        <g class="pet-eyes-closed"><path d="M46 40 q4 3.5 8 0 M66 40 q4 3.5 8 0" stroke="#3a2e2a" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>
        <g class="pet-eyes-happy"><path d="M46 40.5 q4 -4.5 8 0 M66 40.5 q4 -4.5 8 0" stroke="#3a2e2a" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>
        <g class="pet-blush"><ellipse cx="42.5" cy="48" rx="4.8" ry="2.7" fill="#ff9eb0" opacity=".55"/><ellipse cx="77.5" cy="48" rx="4.8" ry="2.7" fill="#ff9eb0" opacity=".55"/></g>
        <ellipse cx="60" cy="49.5" rx="10.5" ry="7" fill="url(#${u}-cream)"/>
        <path class="pet-nose" d="M57 46 h6 l-3 4 Z" fill="#e37b93"/><circle cx="58.8" cy="46.8" r=".85" fill="#fff" opacity=".55"/>
        <path class="pet-mouth-idle" d="M60 50 Q57 54 53 51 M60 50 Q63 54 67 51" stroke="#3a2e2a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <g class="pet-mouth-open">
          <path d="M53.5 51 Q60 62 66.5 51 Q60 55 53.5 51 Z" fill="#9c4f63"/>
          <path class="pet-tongue" d="M57.5 55.5 q2.5 5.5 5 0 v-2 h-5 Z" fill="#ff8fa3"/>
        </g>
        <g class="pet-whiskers" stroke="#d99b3f" stroke-width="1.1" stroke-linecap="round" opacity=".75">
          <path d="M35 37.5 h9 M35.5 44 l8.5 -2 M36 50.5 l8 -4 M85 37.5 h-9 M84.5 44 l-8.5 -2 M84 50.5 l-8 -4"/>
        </g>
      </g>
    </g>`;
}

// ---------- 柴犬 SVG ----------
// 特征：卷尾（柴犬标志）、奶油色脸颊/嘴罩、眉点、红项圈金铃铛；材质光影同猫
function buildDogSVG() {
  const u = `dog${++__uid}`;
  return `
    <defs>
      <radialGradient id="${u}-fur" cx="38%" cy="28%" r="88%">
        <stop offset="0%" stop-color="#fbe0ba"/>
        <stop offset="55%" stop-color="#f2cfa2"/>
        <stop offset="100%" stop-color="#dfa871"/>
      </radialGradient>
      <linearGradient id="${u}-cream" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fdf6e6"/>
        <stop offset="100%" stop-color="#f4e6c8"/>
      </linearGradient>
      <linearGradient id="${u}-bell" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffd964"/>
        <stop offset="100%" stop-color="#e8a93c"/>
      </linearGradient>
      <radialGradient id="${u}-sh" cx="50%" cy="50%" r="55%">
        <stop offset="0%" stop-color="#2b2340" stop-opacity=".30"/>
        <stop offset="100%" stop-color="#2b2340" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${u}-vol" cx="34%" cy="26%" r="82%">
        <stop offset="52%" stop-color="#8a5a24" stop-opacity="0"/>
        <stop offset="100%" stop-color="#8a5a24" stop-opacity=".26"/>
      </radialGradient>
    </defs>
    <ellipse class="pet-shadow" cx="60" cy="105" rx="32" ry="5.5" fill="url(#${u}-sh)"/>
    <g class="pet-inner">
      <g class="pet-tail">
        <path d="M80 89 Q99 87 97 69 Q95 55 83 58 Q74 61 78 70 Q81 76 87 73" fill="none" stroke="#d9a25f" stroke-width="10" stroke-linecap="round"/>
        <path d="M84 59 Q77 62 80 69" fill="none" stroke="#fbeccd" stroke-width="4.2" stroke-linecap="round"/>
      </g>
      <g class="pet-body">
        <path d="M60 58 C36 58 30 86 33 99 C35 108 85 108 87 99 C90 86 84 58 60 58 Z" fill="url(#${u}-fur)"/>
        <path d="M60 58 C36 58 30 86 33 99 C35 108 85 108 87 99 C90 86 84 58 60 58 Z" fill="url(#${u}-vol)"/>
        <path d="M56 59 C41 61 33 75 32.6 92" fill="none" stroke="#fdf0da" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>
        <path d="M60 73 C50 73 45.5 92 48 101 C52.5 105 67.5 105 72 101 C74.5 92 70 73 60 73 Z" fill="url(#${u}-cream)"/>
        <ellipse cx="60" cy="63" rx="15" ry="4.5" fill="#a06a32" opacity=".20"/>
        <ellipse cx="46" cy="70" rx="14" ry="8" fill="#ffffff" opacity=".15"/>
        <g stroke="#d9ab72" stroke-width="1.1" stroke-linecap="round" opacity=".5" fill="none">
          <path d="M38 84 q-1.5 4 .5 7"/><path d="M82 84 q1.5 4 -.5 7"/>
        </g>
      </g>
      <g class="pet-collar-g">
        <path class="pet-collar" d="M42 57 Q60 66 78 57 L79 63 Q60 72 41 63 Z" fill="#e05a5a"/>
        <path d="M42.5 57.5 Q60 66 77.5 57.5" stroke="#f47f7f" stroke-width="1.6" fill="none" opacity=".8"/>
        <circle cx="60" cy="67" r="3.4" fill="url(#${u}-bell)"/><path d="M60 65.5 v1.6" stroke="#b07718" stroke-width="1" stroke-linecap="round"/>
      </g>
      <g class="pet-paw pet-paw-l">
        <ellipse cx="47" cy="101" rx="8.5" ry="5.5" fill="#f2d0a4"/><ellipse cx="45.5" cy="99.5" rx="4" ry="1.8" fill="#ffffff" opacity=".3"/>
        <path d="M44.5 99.5 v3 M47.5 99.5 v3" stroke="#d9ab72" stroke-width="1" stroke-linecap="round"/>
      </g>
      <g class="pet-paw pet-paw-r">
        <ellipse cx="73" cy="101" rx="8.5" ry="5.5" fill="#f2d0a4"/><ellipse cx="71.5" cy="99.5" rx="4" ry="1.8" fill="#ffffff" opacity=".3"/>
        <path d="M70.5 99.5 v3 M73.5 99.5 v3" stroke="#d9ab72" stroke-width="1" stroke-linecap="round"/>
      </g>
      <g class="pet-head">
        <g class="pet-ear pet-ear-l">
          <path d="M42 18 Q26 20 29 44 Q31 52 41 47 Q45 30 42 18 Z" fill="#b07a4a"/>
          <path d="M33 42 Q31.5 36 33 27 Q30 38 33 42 Z" fill="#7d5330" opacity=".55"/>
        </g>
        <g class="pet-ear pet-ear-r">
          <path d="M78 18 Q94 20 91 44 Q89 52 79 47 Q75 30 78 18 Z" fill="#b07a4a"/>
          <path d="M87 42 Q88.5 36 87 27 Q90 38 87 42 Z" fill="#7d5330" opacity=".55"/>
        </g>
        <circle cx="46" cy="42" r="7.5" fill="url(#${u}-cream)"/><circle cx="74" cy="42" r="7.5" fill="url(#${u}-cream)"/>
        <circle cx="60" cy="38" r="25" fill="url(#${u}-fur)"/>
        <circle cx="60" cy="38" r="25" fill="url(#${u}-vol)"/>
        <path d="M60 24.5 Q49 28 47.5 40 Q49 51 60 53 Q71 51 72.5 40 Q71 28 60 24.5 Z" fill="url(#${u}-cream)" opacity=".95"/>
        <g class="pet-brows"><circle cx="50" cy="30" r="1.6" fill="#fbeccd"/><circle cx="70" cy="30" r="1.6" fill="#fbeccd"/></g>
        <path d="M42 22 a20 17 0 0 1 36 0" stroke="#ffffff" stroke-width="2.2" fill="none" opacity=".3" stroke-linecap="round"/>
        <g class="pet-eyes-open">
          <g class="pet-eye pet-eye-l">
            <circle cx="50" cy="34" r="3.6" fill="#4a342a"/><circle cx="51.4" cy="32.6" r="1.4" fill="#fff"/><circle cx="49" cy="35.4" r=".65" fill="#fff" opacity=".8"/>
          </g>
          <g class="pet-eye pet-eye-r">
            <circle cx="70" cy="34" r="3.6" fill="#4a342a"/><circle cx="71.4" cy="32.6" r="1.4" fill="#fff"/><circle cx="69" cy="35.4" r=".65" fill="#fff" opacity=".8"/>
          </g>
        </g>
        <g class="pet-eyes-closed"><path d="M46 34 q4 3.5 8 0 M66 34 q4 3.5 8 0" stroke="#4a342a" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>
        <g class="pet-eyes-happy"><path d="M46 34.5 q4 -4.5 8 0 M66 34.5 q4 -4.5 8 0" stroke="#4a342a" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>
        <g class="pet-blush"><ellipse cx="42.5" cy="42" rx="4.8" ry="2.7" fill="#ff9eb0" opacity=".5"/><ellipse cx="77.5" cy="42" rx="4.8" ry="2.7" fill="#ff9eb0" opacity=".5"/></g>
        <ellipse cx="60" cy="47" rx="12.5" ry="9" fill="url(#${u}-cream)"/>
        <ellipse class="pet-nose" cx="60" cy="44" rx="4.6" ry="3.6" fill="#4a342a"/><ellipse cx="58.5" cy="42.8" rx="1.4" ry=".9" fill="#ffffff" opacity=".35"/>
        <path class="pet-mouth-idle" d="M60 47.5 Q57 51.5 53 48.5 M60 47.5 Q63 51.5 67 48.5" stroke="#4a342a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <g class="pet-mouth-open">
          <path d="M53 48.5 Q60 59 67 48.5 Q60 52.5 53 48.5 Z" fill="#8f4a52"/>
          <path class="pet-tongue" d="M56.5 52 q3.5 6 7 0 v-2 h-7 Z" fill="#ff8fa3"/>
        </g>
      </g>
    </g>`;
}

export function PetView() {
  const root = el('div', { class: 'pet-widget' });

  let selected = loadSavedType();
  let closeness = loadCloseness();
  let actionTimer = null;   // 随机动作循环
  let poseTimer = null;     // 单次动作结束回归待机
  let blendTimer = null;    // 动作切换间的短过渡

  const stage = el('div', { class: 'pet-stage' });
  const btn = el('button', { class: 'pet-btn', title: '宠物伙伴' }, stage);
  // ⇄ 更换伙伴小按钮（有宠物时可见；点击宠物本体 = 摸摸互动）
  const switchBtn = el('button', { class: 'pet-switch', title: '更换伙伴', innerHTML: SWITCH_ICON });
  root.append(btn, switchBtn);

  function loadSavedType() {
    try {
      const t = localStorage.getItem(STORAGE_KEY);
      return PET_REGISTRY[t] ? t : null;
    } catch { return null; }
  }

  function loadCloseness() {
    try { return Math.max(0, Number(localStorage.getItem(CLOSENESS_KEY)) || 0); }
    catch { return 0; }
  }

  function tierOf(n) { return n < 5 ? 0 : n < 15 ? 1 : 2; }

  /** 生成某宠物的 SVG 节点 */
  function svgFor(type) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 112');
    svg.setAttribute('class', 'pet-svg');
    svg.innerHTML = PET_REGISTRY[type].build();
    return svg;
  }

  function renderStage() {
    clear(stage);
    stage.className = 'pet-stage';
    root.classList.toggle('has-pet', !!selected);
    if (!selected) {
      stage.append(el('span', { class: 'pet-paw-icon', innerHTML: PAW_ICON }));
      btn.title = '领养一只宠物伙伴';
    } else {
      stage.classList.add('has-pet');
      stage.append(svgFor(selected));
      btn.title = `${PET_REGISTRY[selected].name} · 点我摸摸，右键或点 ⇄ 换伙伴`;
    }
  }

  // ---------- 选择/切换弹层（fixed 挂 body，避免父层裁剪） ----------
  let picker = null;

  function closePicker() {
    if (picker) { picker.remove(); picker = null; }
    btn.classList.remove('open');
    switchBtn.classList.remove('open');
  }

  function openPicker() {
    if (picker) return closePicker();
    picker = el('div', { class: 'pet-picker' },
      el('div', { class: 'pet-picker-title' }, selected ? '换个伙伴吧' : '领养一只桌面伙伴吧'),
      el('div', { class: 'pet-picker-list' },
        Object.values(PET_REGISTRY).map((def) => el('button', {
          class: `pet-picker-card${def.key === selected ? ' active' : ''}`,
          onclick: () => {
            const isNew = def.key !== selected;
            closePicker();
            if (isNew) selectPet(def.key);
          },
        },
          svgFor(def.key),
          el('span', { class: 'pet-picker-name' }, def.name),
          el('span', { class: 'pet-picker-tag' }, def.tagline),
        )),
      ),
      el('div', { class: 'pet-picker-foot' }, '更多小伙伴，敬请期待…'),
    );
    document.body.append(picker);
    const r = btn.getBoundingClientRect();
    const w = picker.offsetWidth;
    picker.style.top = `${Math.round(r.bottom + 8)}px`;
    picker.style.left = `${Math.max(8, Math.round(r.right - w))}px`;
    btn.classList.add('open');
    switchBtn.classList.add('open');
    if (selected) playAction(selected === 'cat' ? 'curious' : 'wag'); // 打开面板时张望/摇尾
  }

  const onDocDown = (e) => {
    if (!root.isConnected) { document.removeEventListener('mousedown', onDocDown); closePicker(); return; }
    if (picker && !picker.contains(e.target) && !btn.contains(e.target) && !switchBtn.contains(e.target)) closePicker();
  };
  document.addEventListener('mousedown', onDocDown);

  // 点击宠物 = 摸摸互动（即时反馈，全部本地执行 <100ms）；右键 / ⇄ 打开切换弹层
  btn.addEventListener('click', interact);
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openPicker(); });
  switchBtn.addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });

  function selectPet(type) {
    selected = type;
    closeness = 0;
    try {
      localStorage.setItem(STORAGE_KEY, type);
      localStorage.setItem(CLOSENESS_KEY, '0');
    } catch { /* 隐私模式忽略 */ }
    renderStage();
    startLoop();
    playAction('happy'); // 被领养/换新主人，开心一下
  }

  // ---------- 交互：摸摸 → 按亲密度给出情绪反馈 ----------
  function interact() {
    if (!selected) { openPicker(); return; }
    const prevTier = tierOf(closeness);
    closeness += 1;
    try { localStorage.setItem(CLOSENESS_KEY, String(closeness)); } catch { /* 忽略 */ }
    const tier = tierOf(closeness);

    // 触觉级即时反馈：按钮脉冲
    btn.classList.remove('touched');
    void btn.offsetWidth; // 重新触发动画
    btn.classList.add('touched');

    const pool = RESPONSE_TIERS[tier];
    playAction(pool[Math.floor(Math.random() * pool.length)]);

    // 亲密度升级时给一句专属台词
    if (tier > prevTier) {
      setTimeout(() => showBubble(
        tier === 1 ? '我们变熟了耶！' : '你是我最重要的人啦♥',
        2200,
      ), 600);
    }
  }

  // ---------- 动作系统 ----------
  function showBubble(text, dur) {
    stage.querySelector('.pet-bubble')?.remove();
    const b = el('div', { class: 'pet-bubble' }, text);
    stage.append(b);
    setTimeout(() => b.remove(), dur);
  }

  // 粒子特效：heart ♥ / note ♪ / spark ✦ / zzz Z
  function spawnFX(kinds) {
    if (!kinds.length) return;
    const CHARS = { heart: ['♥', '#ff6b8a'], note: ['♪', '#8fb7ff'], spark: ['✦', '#f7c948'], zzz: ['Z', '#9aa7c7'] };
    const wrap = el('div', { class: 'pet-fx' });
    const n = kinds.includes('zzz') ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const kind = kinds[i % kinds.length];
      const [ch, color] = CHARS[kind];
      wrap.append(el('span', {
        class: `pet-fx-item pet-fx-${kind}`,
        style: {
          color,
          left: `${14 + ((i * 61) % 72)}%`,
          animationDelay: `${i * 0.14}s`,
          fontSize: kind === 'zzz' ? `${8 + i * 2}px` : '',
        },
      }, ch));
    }
    stage.append(wrap);
    setTimeout(() => wrap.remove(), 2400);
  }

  /** 播放指定动作（可从外部测试调用） */
  function playAction(key) {
    if (!selected) return;
    const act = ACTIONS[key] || ACTIONS.happy;
    // 台词：30% 概率先叫一声（喵～/汪～）
    const line = act.bubbles[Math.floor(Math.random() * act.bubbles.length)];
    const voice = PET_REGISTRY[selected].voice;
    showBubble(Math.random() < 0.3 ? `${voice}～${line}` : line, act.dur + 500);
    spawnFX(act.fx || []);
    clearTimeout(poseTimer);
    clearTimeout(blendTimer);
    const apply = () => {
      stage.className = `pet-stage has-pet act-${key}`;
      poseTimer = setTimeout(() => { stage.className = 'pet-stage has-pet'; }, act.dur);
    };
    if (stage.className.includes('act-')) {
      stage.className = 'pet-stage has-pet';
      blendTimer = setTimeout(apply, 120);
    } else {
      apply();
    }
  }

  /** 随机动作循环：动作结束后间隔 3~10s 再随机触发下一个 */
  function startLoop() {
    stopLoop();
    const tick = () => {
      actionTimer = setTimeout(() => {
        if (!root.isConnected) { stopLoop(); closePicker(); return; }
        if (selected && !document.hidden && !picker) {
          playAction(IDLE_POOL[Math.floor(Math.random() * IDLE_POOL.length)]);
        }
        tick();
      }, 3000 + Math.random() * 7000);
    };
    tick();
  }

  function stopLoop() { clearTimeout(actionTimer); }

  renderStage();
  if (selected) startLoop();

  // 供外部（如测试/其他视图）触发指定动作
  root.playAction = playAction;
  return root;
}
