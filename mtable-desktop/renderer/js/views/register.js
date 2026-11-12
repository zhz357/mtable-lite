//
// views/register.js — 手机号注册页（移植自 RegisterView.swift）
// 复用 base.css 的 auth 通用类，细节样式内联，不新建 css 文件
//
import { el } from '../ui.js';
import { api, APIError } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';

export function RegisterView({ onBack, onRegisterSuccess }) {
  let isLoading = false;

  const phoneInput = el('input', { class: 'field-input', type: 'tel', placeholder: '请输入手机号', maxlength: '11' });
  const nicknameInput = el('input', { class: 'field-input', type: 'text', placeholder: '请输入昵称' });
  const pwdInput = el('input', { class: 'field-input', type: 'password', placeholder: '请输入密码（6-20位）' });
  const confirmInput = el('input', { class: 'field-input', type: 'password', placeholder: '请再次输入密码' });

  const errorBox = el('div', { class: 'form-error', style: { display: 'none' } },
    el('span', { class: 'icon', innerHTML: icon('exclamationmark.circle.fill') }),
    el('span', { class: 'error-text' }),
  );

  const registerBtn = el('button', { class: 'btn-primary', style: { width: '100%' } }, '注册');
  const backBtn = el('button', { class: 'btn-ghost' },
    el('span', { class: 'icon', style: { width: '12px', height: '12px' }, innerHTML: icon('chevron.left') }),
    '返回',
  );

  function setError(msg) {
    if (msg) {
      errorBox.querySelector('.error-text').textContent = msg;
      errorBox.style.display = 'flex';
    } else {
      errorBox.style.display = 'none';
    }
  }

  function clearBtn(btn) { while (btn.firstChild) btn.removeChild(btn.firstChild); }

  function setLoading(loading) {
    isLoading = loading;
    registerBtn.disabled = loading;
    phoneInput.disabled = loading;
    nicknameInput.disabled = loading;
    pwdInput.disabled = loading;
    confirmInput.disabled = loading;
    backBtn.disabled = loading;
    eyeBtn.disabled = loading;
    clearBtn(registerBtn);
    registerBtn.append(
      loading ? el('span', { class: 'spinner' }) : null,
      loading ? '注册中...' : '注册',
    );
    registerBtn.style.opacity = loading ? '.85' : '1';
  }

  async function performRegister() {
    setError('');
    // RegisterView.swift performRegister()：逐条校验
    const phone = phoneInput.value.trim();
    const nickname = nicknameInput.value.trim();
    const password = pwdInput.value.trim();
    const confirm = confirmInput.value.trim();

    if (!/^1[3-9]\d{9}$/.test(phone)) return setError('请输入有效的 11 位手机号');
    if (!nickname) return setError('请输入昵称');
    if (password.length < 6 || password.length > 20) return setError('密码长度必须在 6-20 位之间');
    if (password !== confirm) return setError('两次输入的密码不一致');

    setLoading(true);
    try {
      const user = await api.register(phone, password, nickname);
      store.setToken(user.token);
      store.setUser(user);
      onRegisterSuccess(user);
    } catch (err) {
      setError(err instanceof APIError && err.business ? err.message : '注册失败，请稍后重试');
      setLoading(false);
    }
  }

  registerBtn.addEventListener('click', performRegister);
  confirmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') performRegister(); });
  backBtn.addEventListener('click', () => { if (!isLoading) onBack(); });

  // 密码可见切换（Swift showPassword）
  const eyeBtn = el('button', {
    style: { display: 'flex', alignItems: 'center', padding: '0 8px 0 0', color: 'var(--text-2)' },
    onclick: () => {
      const show = pwdInput.type === 'password';
      pwdInput.type = show ? 'text' : 'password';
      eyeIcon.innerHTML = icon(show ? 'eye.slash' : 'eye');
    },
  }, el('span', { class: 'icon', style: { width: '18px', height: '18px' } }));
  const eyeIcon = eyeBtn.firstChild;
  eyeIcon.innerHTML = icon('eye');

  function pwdField() {
    // 带眼睛按钮的密码输入框（登录页同款布局）
    const wrap = el('div', { style: { display: 'flex', alignItems: 'center', border: '1px solid var(--card-border)', borderRadius: '10px', background: 'var(--surface)' } },
      el('div', { style: { flex: '1' } }, pwdInput),
      eyeBtn,
    );
    pwdInput.style.border = 'none';
    pwdInput.style.outline = 'none';
    pwdInput.style.flex = '1';
    pwdInput.style.padding = '11px 0 11px 14px';
    return wrap;
  }

  const card = el('div', { class: 'auth-card', style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
    el('div', {},
      el('div', { style: { fontSize: '26px', fontWeight: '700', color: 'var(--text-1)' } }, '手机号注册'),
      el('div', { style: { fontSize: '13px', color: 'var(--text-3)', marginTop: '6px' } }, '创建您的 MTable 账号'),
    ),
    el('div', {},
      el('label', { class: 'field-label' }, '手机号'),
      phoneInput,
    ),
    el('div', {},
      el('label', { class: 'field-label' }, '昵称'),
      nicknameInput,
    ),
    el('div', {},
      el('label', { class: 'field-label' }, '密码'),
      pwdField(),
    ),
    el('div', {},
      el('label', { class: 'field-label' }, '确认密码'),
      confirmInput,
    ),
    errorBox,
    registerBtn,
    el('div', { style: { textAlign: 'center', fontSize: '12px', color: 'var(--text-3)' } },
      '已有账号？',
      el('button', { class: 'link-btn', onclick: () => { if (!isLoading) onBack(); } }, '去登录'),
    ),
  );

  return el('div', { class: 'auth-bg' },
    el('div', { style: { paddingTop: '28px' } }, backBtn),
    el('div', { style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, card),
    el('div', { style: { textAlign: 'center', fontSize: '11px', color: 'var(--text-3)', padding: '24px 0' } },
      '注册即表示同意 MTable 服务条款'),
  );
}
