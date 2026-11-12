//
// ui.js — DOM 工具 / Toast / Modal / 通用组件
//

/** 创建元素：el('div', { class: 'x', onclick: fn }, child1, child2) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue; // 布尔属性 false = 不设置
    if (v === true) { node.setAttribute(k, ''); continue; } // 布尔属性 true = 空值
    if (k === 'innerHTML' || k === 'innerText' || k === 'textContent') {
      node[k] = v; // DOM property，setAttribute 不生效
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else {
      node.setAttribute(k, v);
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
}

/** 清空容器 */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** 右上角提示 */
export function toast(message, type = '') {
  const root = document.getElementById('toast-root');
  const item = el('div', { class: `toast ${type}` }, message);
  root.append(item);
  setTimeout(() => {
    item.style.transition = 'opacity .3s';
    item.style.opacity = '0';
    setTimeout(() => item.remove(), 300);
  }, 2400);
}

/** 确认弹窗，resolve(true/false) */
export function confirmModal({ title, message, confirmText = '确认', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const close = (ok) => { mask.remove(); resolve(ok); };
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) close(false); } },
      el('div', { class: 'modal' },
        el('h3', {}, title),
        el('p', {}, message),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn-secondary', onclick: () => close(false) }, cancelText),
          el('button', {
            class: danger ? 'btn-danger' : 'btn-primary',
            style: danger ? {} : { padding: '8px 16px', fontSize: '13px' },
            onclick: () => close(true),
          }, confirmText),
        ),
      ),
    );
    document.getElementById('modal-root').append(mask);
  });
}

/** 加载中占位 */
export function loadingView(text = '加载中...') {
  return el('div', { class: 'loading-wrap' }, el('div', { class: 'spinner dark' }), text);
}

/** 空状态占位 */
export function emptyView({ icon = 'puzzlepiece', title = '', message = '' } = {}) {
  return el('div', { class: 'empty-state' },
    el('span', { class: 'icon icon-lg', innerHTML: getIcon?.(icon) || '' }),
    title ? el('div', { class: 'title' }, title) : null,
    message ? el('div', {}, message) : null,
  );
}

// 延迟引入避免循环依赖
import { icon as getIcon } from './icons.js';

/** 头像（base64 dataURI 或首字母圆形） */
export function avatarNode(user, size = 36) {
  const wrap = el('div', {
    style: {
      width: `${size}px`, height: `${size}px`, borderRadius: '50%',
      background: 'linear-gradient(180deg,#ff7a47,#e85a2c)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', flexShrink: '0',
    },
  });
  if (user?.avatar && user.avatar.startsWith('data:image')) {
    wrap.append(el('img', {
      src: user.avatar,
      style: { width: '100%', height: '100%', objectFit: 'cover' },
    }));
  } else {
    wrap.append(el('span', {
      style: { color: '#fff', fontSize: `${size * 0.42}px`, fontWeight: '700' },
    }, (user?.nickname || 'M').slice(0, 1)));
  }
  return wrap;
}

/** 管理员专属标识（金色徽章，统一用于管理员身份提示与管理员专属功能入口） */
export function adminBadge(title = '管理员专属') {
  return el('span', { class: 'admin-badge', title },
    el('span', { class: 'admin-badge-star' }, '★'), '管理员');
}
