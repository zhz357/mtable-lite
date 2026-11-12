//
// views/welcome.js — 欢迎页（移植自 WelcomeView.swift）
//
import { el } from '../ui.js';

export function WelcomeView({ onStartLogin }) {
  const root = el('div', { class: 'auth-bg', style: { alignItems: 'center' } });

  // Logo
  const logo = el('div', {
    style: {
      width: '112px', height: '112px', borderRadius: '28px',
      background: 'linear-gradient(135deg,#ff7a47,#e85a2c)',
      border: '1.5px solid rgba(255,255,255,.3)',
      boxShadow: '0 14px 24px rgba(232,90,44,.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      marginTop: '56px',
      transform: 'scale(.6)', opacity: '0',
      transition: 'transform .6s ease-out, opacity .6s ease-out',
    },
  }, el('span', {
    style: {
      fontSize: '64px', fontWeight: '700', color: '#fff',
      textShadow: '0 1px 1px rgba(0,0,0,.15)',
    },
  }, 'M'));

  // 标题
  const title = el('div', {
    style: { display: 'flex', gap: '0', marginTop: '32px', opacity: '0', transform: 'translateY(20px)', transition: 'all .7s ease-out .25s' },
  },
    el('span', { style: { fontSize: '38px', fontWeight: '600', color: 'var(--text-1)' } }, '欢迎使用 '),
    el('span', {
      style: {
        fontSize: '38px', fontWeight: '700',
        background: 'linear-gradient(135deg,#ff7a47,#e85a2c)',
        WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
      },
    }, 'MTable'),
  );

  const subtitle = el('div', {
    style: { fontSize: '15px', color: 'var(--text-2)', marginTop: '12px', opacity: '0', transform: 'translateY(20px)', transition: 'all .7s ease-out .25s' },
  }, '打造你的专属工作空间～');

  const startBtn = el('button', {
    class: 'btn-primary',
    style: { marginTop: '40px', opacity: '0', transform: 'translateY(20px)', transition: 'all .7s ease-out .25s' },
    onclick: onStartLogin,
  }, '进入登录');

  const footer = el('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '6px',
      marginTop: '28px', fontSize: '11px', color: 'var(--text-3)',
      opacity: '0', transition: 'opacity .7s ease-out .4s',
    },
  },
    el('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: '#4d8c8c' } }),
    `版本 ${window.mtable?.appVersion || '1.0.0'} · 就绪`,
  );

  requestAnimationFrame(() => requestAnimationFrame(() => {
    logo.style.transform = 'scale(1)';
    logo.style.opacity = '1';
    for (const n of [title, subtitle, startBtn]) { n.style.opacity = '1'; n.style.transform = 'translateY(0)'; }
    footer.style.opacity = '1';
  }));

  root.append(logo, title, subtitle, startBtn, footer);
  return root;
}
