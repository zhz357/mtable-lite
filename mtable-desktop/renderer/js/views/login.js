//
// views/login.js — 手机号登录页（移植自 LoginView.swift）
//
import { el } from '../ui.js';
import { api, APIError } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';

export function LoginView({ onBack, onLoginSuccess, onRegister }) {
  let isLoading = false;
  let rememberAccount = true;

  const saved = store.getSavedLogin();

  const phoneInput = el('input', {
    class: 'field-input', type: 'tel', placeholder: '请输入手机号',
    value: saved.phone || '', maxlength: '11',
  });
  const pwdInput = el('input', {
    class: 'field-input', type: 'password', placeholder: '请输入密码',
    value: saved.password || '',
  });
  const errorBox = el('div', { class: 'form-error', style: { display: 'none' } },
    el('span', { class: 'icon', innerHTML: icon('exclamationmark.circle.fill') }),
    el('span', { class: 'error-text' }),
  );

  const loginBtn = el('button', { class: 'btn-primary', style: { width: '100%' } }, '登录');
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

  function setLoading(loading) {
    isLoading = loading;
    loginBtn.disabled = loading;
    phoneInput.disabled = loading;
    pwdInput.disabled = loading;
    backBtn.disabled = loading;
    clearBtn(loginBtn);
    if (loading) loginBtn.append(el('span', { class: 'spinner' }));
    loginBtn.append(loading ? '登录中...' : '登录');
    loginBtn.style.opacity = loading ? '.85' : '1';
  }

  function clearBtn(btn) { while (btn.firstChild) btn.removeChild(btn.firstChild); }

  async function performLogin() {
    setError('');
    const phone = phoneInput.value.trim();
    const password = pwdInput.value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return setError('请输入有效的 11 位手机号');
    if (!password) return setError('请输入密码');

    setLoading(true);
    try {
      const user = await api.login(phone, password);
      if (rememberAccount) store.setSavedLogin(phone, password);
      else store.clearSavedLogin();
      store.setToken(user.token);
      store.setUser(user);
      onLoginSuccess(user);
    } catch (err) {
      setError(err instanceof APIError && err.business ? err.message : '登录失败，请稍后重试');
      setLoading(false);
    }
  }

  loginBtn.addEventListener('click', performLogin);
  pwdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') performLogin(); });
  backBtn.addEventListener('click', () => { if (!isLoading) onBack(); });

  // 密码可见切换
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

  const rememberCheck = el('input', { type: 'checkbox', checked: '', style: { accentColor: '#ff7a47' } });
  rememberCheck.addEventListener('change', () => { rememberAccount = rememberCheck.checked; });

  const card = el('div', { class: 'auth-card', style: { display: 'flex', flexDirection: 'column', gap: '22px' } },
    el('div', {},
      el('div', { style: { fontSize: '26px', fontWeight: '700', color: 'var(--text-1)' } }, '手机号登录'),
      el('div', { style: { fontSize: '13px', color: 'var(--text-3)', marginTop: '6px' } }, '使用您的手机号继续'),
    ),
    el('div', {},
      el('label', { class: 'field-label' }, '手机号'),
      phoneInput,
    ),
    el('div', {},
      el('label', { class: 'field-label' }, '密码'),
      el('div', { style: { display: 'flex', alignItems: 'center', border: '1px solid var(--card-border)', borderRadius: '10px', background: 'var(--surface)' } },
        el('div', { style: { flex: '1' } }, pwdInput),
        eyeBtn,
      ),
    ),
    errorBox,
    el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-2)', cursor: 'pointer' } },
      rememberCheck, '记住账号',
    ),
    loginBtn,
    el('div', { style: { textAlign: 'center', fontSize: '12px', color: 'var(--text-3)' } },
      '没有账号？',
      el('button', { class: 'link-btn', onclick: () => { if (!isLoading) onRegister(); } }, '立即注册'),
    ),
  );

  pwdInput.parentElement.style.border = 'none';
  pwdInput.style.border = 'none';
  pwdInput.style.outline = 'none';
  pwdInput.style.flex = '1';
  pwdInput.style.padding = '11px 0 11px 14px';

  return el('div', { class: 'auth-bg' },
    el('div', { style: { paddingTop: '28px' } }, backBtn),
    el('div', { style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, card),
    el('div', { style: { textAlign: 'center', fontSize: '11px', color: 'var(--text-3)', padding: '24px 0' } },
      '登录即表示同意 MTable 服务条款'),
  );
}
