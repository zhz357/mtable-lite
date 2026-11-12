//
// views/profile.js — 个人信息编辑弹窗：昵称、头像（base64 dataURI）、座右铭、修改密码
// （移植自 ProfileEditView.swift）
//
import { el, clear, avatarNode } from '../ui.js';
import { api, APIError } from '../api.js';
import { icon } from '../icons.js';

export function ProfileEditView({ user, onSuccess, onCancel }) {
  let nickname = user?.nickname || '';
  let motto = user?.motto || '';
  let avatarBase64 = user?.avatar || null;

  let showPasswordSection = false;
  let isSaving = false;

  // ---------- 输入控件 ----------
  const nicknameInput = el('input', { class: 'field-input profile-input', type: 'text', placeholder: '请输入昵称', value: nickname });
  const mottoInput = el('textarea', { class: 'field-input profile-input', rows: '2', placeholder: '请输入座右铭' }, motto);

  const oldPwdInput = el('input', { class: 'field-input profile-input', type: 'password', placeholder: '请输入原密码' });
  const newPwdInput = el('input', { class: 'field-input profile-input', type: 'password', placeholder: '请输入新密码' });
  const confirmPwdInput = el('input', { class: 'field-input profile-input', type: 'password', placeholder: '请再次输入新密码' });

  const errorBox = el('div', { class: 'profile-msg error', style: { display: 'none' } });
  const successBox = el('div', { class: 'profile-msg success', style: { display: 'none' } });
  function setMessage(box, msg, kind) {
    if (msg) {
      clear(box).append(
        el('span', { class: 'icon', style: { width: '13px', height: '13px', flex: 'none' }, innerHTML: icon(kind === 'success' ? 'checkmark.circle.fill' : 'exclamationmark.circle.fill') }),
        el('span', {}, msg),
      );
      box.style.display = 'flex';
    } else {
      box.style.display = 'none';
    }
  }

  // 字段校验态：输入时清除红框，提供容错恢复
  function markInvalid(input, invalid) { input.classList.toggle('invalid', !!invalid); }
  for (const inp of [nicknameInput, oldPwdInput, newPwdInput, confirmPwdInput]) {
    inp.addEventListener('input', () => markInvalid(inp, false));
  }

  // ---------- 头像 ----------
  const avatarPreview = el('div', { class: 'profile-avatar-ring' });
  const removeBtn = el('button', { class: 'profile-remove-btn', style: { display: 'none' }, onclick: () => { avatarBase64 = null; renderAvatar(); } }, '移除');
  function renderAvatar() {
    clear(avatarPreview).append(avatarNode({ nickname, avatar: avatarBase64 }, 80));
    removeBtn.style.display = avatarBase64 ? 'inline-flex' : 'none';
  }

  // 选择图片：FileReader 转 dataURI，缩放到 128×128 PNG（对应 Swift pickImage/resizeImage）
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/*', style: { display: 'none' } });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        canvas.getContext('2d').drawImage(img, 0, 0, 128, 128);
        avatarBase64 = canvas.toDataURL('image/png');
        renderAvatar();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  const pickBtn = el('button', { class: 'profile-pick-btn', onclick: () => fileInput.click() }, '选择图片');

  // ---------- 修改密码折叠区 ----------
  const pwdFieldsWrap = el('div', { class: 'profile-pwd-fields', style: { display: 'none' } },
    el('div', { class: 'profile-field' }, el('label', { class: 'field-label' }, '原密码'), oldPwdInput),
    el('div', { class: 'profile-field' }, el('label', { class: 'field-label' }, '新密码（6-20位）'), newPwdInput),
    el('div', { class: 'profile-field' }, el('label', { class: 'field-label' }, '确认新密码'), confirmPwdInput),
  );
  const pwdChevron = el('span', { class: 'icon', style: { width: '11px', height: '11px' }, innerHTML: icon('chevron.right') });
  const pwdToggle = el('button', { class: 'profile-pwd-toggle' }, pwdChevron, '修改密码');
  pwdToggle.addEventListener('click', () => {
    showPasswordSection = !showPasswordSection;
    pwdFieldsWrap.style.display = showPasswordSection ? 'flex' : 'none';
    pwdChevron.innerHTML = icon(showPasswordSection ? 'chevron.down' : 'chevron.right');
  });

  // ---------- 按钮 ----------
  const cancelBtn = el('button', { class: 'profile-btn-cancel', onclick: closeForCancel }, '取消');
  const saveBtn = el('button', { class: 'profile-btn-save', onclick: save }, '保存');
  function refreshSaveDisabled() { saveBtn.disabled = isSaving || !nicknameInput.value.trim(); }
  nicknameInput.addEventListener('input', refreshSaveDisabled);

  const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) closeForCancel(); } },
    el('div', { class: 'profile-modal', onclick: (e) => e.stopPropagation() },
      // 头部
      el('div', { class: 'profile-head' },
        el('div', { class: 'profile-head-texts' },
          el('div', { class: 'profile-modal-title' }, '个人信息'),
          el('div', { class: 'profile-head-sub' }, '完善你的资料，让别人更了解你')),
        el('button', { class: 'profile-close', title: '关闭', onclick: closeForCancel },
          el('span', { class: 'icon', style: { width: '16px', height: '16px' }, innerHTML: icon('xmark') }))),

      el('div', { class: 'profile-scroll' },
        // 头像区
        el('div', { class: 'profile-avatar-row' },
          avatarPreview,
          el('div', { class: 'profile-avatar-actions' },
            el('div', { class: 'profile-avatar-label' }, '头像'),
            el('div', { class: 'profile-avatar-btns' }, pickBtn, removeBtn),
            el('div', { class: 'profile-avatar-hint' }, 'PNG / JPG / GIF · ≤ 800px'))),

        // 表单区
        el('div', { class: 'profile-field' }, el('label', { class: 'field-label' }, '昵称'), nicknameInput),
        el('div', { class: 'profile-field' }, el('label', { class: 'field-label' }, '座右铭'), mottoInput),

        // 修改密码折叠区
        el('div', { class: 'profile-divider' }),
        el('div', { class: 'profile-pwd-section' }, pwdToggle, pwdFieldsWrap),
      ),

      errorBox,
      successBox,

      // 底部按钮
      el('div', { class: 'profile-actions' }, cancelBtn, saveBtn),
      fileInput,
    ),
  );

  function closeForCancel() {
    mask.remove();
    if (onCancel) onCancel();
  }

  // ---------- 保存（ProfileEditView.swift save()） ----------
  function setSaving(loading) {
    isSaving = loading;
    saveBtn.disabled = loading || !nicknameInput.value.trim();
    clear(saveBtn);
    saveBtn.append(
      loading ? el('span', { class: 'spinner' }) : null,
      loading ? '' : '保存',
    );
    cancelBtn.disabled = loading;
  }

  async function save() {
    setMessage(errorBox, '');
    setMessage(successBox, '');

    const trimmedNickname = nicknameInput.value.trim();
    const trimmedMotto = mottoInput.value.trim();

    // ---- 前置校验：先验证所有输入，再调用接口（容错，避免半途保存） ----
    let firstInvalid = null;
    const wantPassword = showPasswordSection && oldPwdInput.value;
    markInvalid(nicknameInput, false);
    markInvalid(newPwdInput, false);
    markInvalid(confirmPwdInput, false);
    if (!trimmedNickname) {
      markInvalid(nicknameInput, true);
      firstInvalid = firstInvalid || nicknameInput;
    }
    if (wantPassword) {
      const trimmedNew = newPwdInput.value.trim();
      const trimmedConfirm = confirmPwdInput.value.trim();
      if (trimmedNew.length < 6 || trimmedNew.length > 20) {
        markInvalid(newPwdInput, true);
        setMessage(errorBox, '新密码长度必须在 6-20 位之间');
        firstInvalid = firstInvalid || newPwdInput;
      } else if (trimmedNew !== trimmedConfirm) {
        markInvalid(confirmPwdInput, true);
        setMessage(errorBox, '两次输入的新密码不一致');
        firstInvalid = firstInvalid || confirmPwdInput;
      }
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setSaving(true);
    try {
      // 1. 更新个人资料
      await api.updateProfile(trimmedNickname, avatarBase64, trimmedMotto || null);

      // 2. 如果填写了密码，修改密码
      if (wantPassword) {
        await api.changePassword(oldPwdInput.value, newPwdInput.value.trim());
      }

      // 3. 构建更新后的用户并回调（Swift 保留 token/userId/phone，这里用展开保留其余字段）
      const updated = { ...user, nickname: trimmedNickname, avatar: avatarBase64, motto: trimmedMotto || null };
      setMessage(successBox, '保存成功', 'success');
      setTimeout(() => {
        mask.remove();
        if (onSuccess) onSuccess(updated);
      }, 600);
    } catch (err) {
      setSaving(false);
      setMessage(errorBox, err instanceof APIError && err.business ? err.message : '保存失败，请稍后重试');
    }
  }

  // ---------- 挂载 ----------
  renderAvatar();
  refreshSaveDisabled();
  document.getElementById('modal-root').append(mask);
  nicknameInput.focus();
}
