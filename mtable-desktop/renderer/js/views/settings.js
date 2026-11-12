//
// views/settings.js — 系统设置（"个人资料" / "壁纸" 标签页，界面文案为汉语）
// 资料保存走 api.updateProfile；改密码走 api.changePassword；
// 壁纸调整实时生效并防抖自动保存（走 wallpaper.js 模块）
//
import { el, clear, toast, avatarNode } from '../ui.js';
import { api, BASE_URL } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import {
  applyWallpaper, getWallpaperState, loadWallpaper, saveWallpaperSetting, scheduleWallpaperSave,
} from '../wallpaper.js';

// ---------- 小工具 ----------
function fieldBox(iconName, input, ...extra) {
  return el('div', { class: 'set-field-box' },
    el('span', { class: 'icon', style: { width: '13px', height: '13px' }, innerHTML: icon(iconName) }),
    input,
    ...extra);
}

function labeledField(label, box) {
  return el('div', { class: 'set-field' },
    el('div', { class: 'set-field-label' }, label),
    box);
}

// ---------- 个人资料（表单 + 头像 + 修改密码） ----------
function profileTab(user, onUserUpdated) {
  let avatarValue = user?.avatar || null;

  // —— 资料表单 ——
  const nicknameInput = el('input', { class: 'set-field-input', placeholder: '请输入昵称' });
  nicknameInput.value = user?.nickname || '';

  const phoneInput = el('input', { class: 'set-field-input', placeholder: '未绑定' });
  phoneInput.value = user?.phone || '';
  phoneInput.disabled = true;

  const mottoInput = el('textarea', { class: 'set-textarea', rows: '3', placeholder: '介绍一下你自己...' });
  mottoInput.value = user?.motto || '';

  // —— 修改密码 ——
  const oldPw = el('input', { class: 'set-pw-input', type: 'password', placeholder: '原密码' });
  const newPw = el('input', { class: 'set-pw-input', type: 'password', placeholder: '新密码（至少 6 位）' });
  const confirmPw = el('input', { class: 'set-pw-input', type: 'password', placeholder: '确认新密码' });
  const pwError = el('div', { class: 'set-form-error', style: { display: 'none' } });
  const pwBtn = el('button', { class: 'set-btn-save' }, '确认修改');
  let pwSubmitting = false;

  function showPwError(msg) {
    if (msg) { pwError.textContent = msg; pwError.style.display = 'block'; }
    else pwError.style.display = 'none';
  }

  pwBtn.addEventListener('click', async () => {
    if (pwSubmitting) return;
    const oldP = oldPw.value;
    const newP = newPw.value;
    if (!oldP) return showPwError('请输入原密码');
    if (newP.length < 6) return showPwError('新密码至少 6 位');
    if (newP !== confirmPw.value) return showPwError('两次输入的新密码不一致');
    pwSubmitting = true;
    showPwError(null);
    pwBtn.disabled = true;
    clear(pwBtn);
    pwBtn.append(el('span', { class: 'spinner' }));
    try {
      await api.changePassword(oldP, newP);
      oldPw.value = '';
      newPw.value = '';
      confirmPw.value = '';
      pwPanel.style.display = 'none';
      toast('密码修改成功', 'success');
    } catch (err) {
      showPwError(err?.message || '密码修改失败，请稍后重试');
    } finally {
      pwSubmitting = false;
      pwBtn.disabled = false;
      clear(pwBtn);
      pwBtn.append('确认修改');
    }
  });
  confirmPw.addEventListener('keydown', (e) => { if (e.key === 'Enter') pwBtn.click(); });

  const pwPanel = el('div', { class: 'set-pw-panel', style: { display: 'none' } },
    oldPw, newPw, confirmPw, pwError,
    el('div', { class: 'set-pw-actions' }, pwBtn));

  const pwToggleLink = el('button', {
    class: 'link-btn set-pw-toggle',
    onclick: () => {
      const show = pwPanel.style.display === 'none';
      pwPanel.style.display = show ? 'flex' : 'none';
      pwToggleLink.querySelector('.set-pw-toggle-text').textContent = show ? '收起' : '修改密码';
      const chev = pwToggleLink.querySelector('.icon');
      if (chev) chev.innerHTML = icon(show ? 'chevron.down' : 'chevron.right');
      if (show) oldPw.focus();
    },
  },
    el('span', { class: 'icon', style: { width: '11px', height: '11px' }, innerHTML: icon('chevron.right') }),
    el('span', { class: 'set-pw-toggle-text' }, '修改密码'));

  // —— 登录有效期 ——
  const TTL_OPTIONS = [[1, '1 天'], [7, '7 天'], [30, '30 天'], [90, '90 天'], [365, '365 天'], [0, '永久有效']];
  const ttlSelect = el('select', { class: 'set-select' });
  for (const [v, t] of TTL_OPTIONS) ttlSelect.append(el('option', { value: String(v) }, t));
  let ttlReady = false;
  api.getSessionTtl().then((d) => {
    ttlSelect.value = String(d.days);
    ttlReady = true;
  }).catch(() => { ttlReady = true; });
  ttlSelect.addEventListener('change', async () => {
    if (!ttlReady) return;
    try {
      await api.setSessionTtl(Number(ttlSelect.value));
      toast(Number(ttlSelect.value) === 0 ? '登录有效期已设为永久' : `登录有效期已设为 ${ttlSelect.value} 天`, 'success');
    } catch (e) {
      toast(e?.message || '保存失败，请稍后重试', 'error');
    }
  });

  // —— 导入项目数据（换电脑迁移） ——
  const importBtn = el('button', { class: 'set-btn-save' }, '导入项目数据');
  let importing = false;
  importBtn.addEventListener('click', async () => {
    if (importing) return;
    const file = await api.pickDbFile();
    if (!file) return;
    importing = true;
    importBtn.disabled = true;
    clear(importBtn);
    importBtn.append(el('span', { class: 'spinner' }));
    try {
      await api.importDb(file);
      toast('项目数据导入成功，请重新登录', 'success');
      store.logout();
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast(e?.message || '导入失败', 'error');
      importing = false;
      importBtn.disabled = false;
      clear(importBtn);
      importBtn.append('导入项目数据');
    }
  });

  // —— 头像 ——
  const avatarSlot = el('div', { class: 'set-avatar-preview' });
  function renderAvatarPreview() {
    clear(avatarSlot);
    avatarSlot.append(avatarNode({ ...(user || {}), avatar: avatarValue }, 72));
  }
  renderAvatarPreview();

  const fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 800 || img.naturalHeight > 800) return toast('图片尺寸不能超过 800×800', 'error');
        avatarValue = dataURL;
        renderAvatarPreview();
      };
      img.onerror = () => toast('图片读取失败', 'error');
      img.src = dataURL;
    };
    reader.onerror = () => toast('图片读取失败', 'error');
    reader.readAsDataURL(file);
  });

  const uploadZone = el('div', { class: 'set-upload-zone', onclick: () => fileInput.click() },
    el('span', { class: 'icon', style: { width: '24px', height: '24px' }, innerHTML: icon('arrow.up.circle') }),
    el('div', { class: 'set-upload-title' }, '点击上传'),
    el('div', { class: 'set-upload-hint' }, '支持 SVG、PNG、JPG 或 GIF · ≤ 800×800px'));

  // —— 保存 / 取消 ——
  async function doSave(btn) {
    const nickname = nicknameInput.value.trim();
    if (!nickname) return toast('昵称不能为空', 'error');
    const motto = mottoInput.value.trim();
    btn.disabled = true;
    clear(btn);
    btn.append(el('span', { class: 'spinner' }));
    try {
      await api.updateProfile(nickname, avatarValue, motto || null);
      onUserUpdated({ ...user, nickname, avatar: avatarValue, motto: motto || null });
      toast('保存成功', 'success');
    } catch (err) {
      toast(err?.message || '保存失败，请稍后重试', 'error');
    } finally {
      btn.disabled = false;
      clear(btn);
      btn.append('保存');
    }
  }
  function resetForm() {
    nicknameInput.value = user?.nickname || '';
    mottoInput.value = user?.motto || '';
    avatarValue = user?.avatar || null;
    renderAvatarPreview();
  }
  const cancelBtn = el('button', { class: 'set-btn-cancel', onclick: resetForm }, '取消');
  const saveBtn = el('button', { class: 'set-btn-save' }, '保存');
  saveBtn.addEventListener('click', () => doSave(saveBtn));

  // —— 布局 ——
  return el('div', { class: 'set-profile' },
    // 左侧：资料表单 + 登录与数据
    el('div', { class: 'set-form-col' },
      el('div', { class: 'set-card set-form' },
        el('div', { class: 'set-card-head' },
          el('span', { class: 'icon', style: { width: '15px', height: '15px' }, innerHTML: icon('person') }),
          '基本信息'),
        el('div', { class: 'set-field-row' },
          labeledField('昵称', fieldBox('person', nicknameInput)),
          labeledField('手机号', fieldBox('phone', phoneInput))),
        labeledField('个人简介', mottoInput),
        // 密码项（无值，仅入口）
        el('div', { class: 'set-field' },
          el('div', { class: 'set-field-label' }, '登录密码'),
          el('div', { class: 'set-pw-inline' },
            el('span', { class: 'icon', style: { width: '13px', height: '13px' }, innerHTML: icon('lock') }),
            el('span', { class: 'set-pw-dots' }, '••••••••'),
            pwToggleLink)),
        pwPanel),

      el('div', { class: 'set-card' },
        el('div', { class: 'set-card-head' },
          el('span', { class: 'icon', style: { width: '15px', height: '15px' }, innerHTML: icon('lock') }),
          '登录与数据'),
        el('div', { class: 'set-row' },
          el('div', { class: 'set-row-text' },
            el('div', { class: 'set-row-title' }, '登录有效期'),
            el('div', { class: 'set-row-desc' }, '超过有效期未使用将自动退出，需重新登录')),
          ttlSelect),
        el('div', { class: 'set-row' },
          el('div', { class: 'set-row-text' },
            el('div', { class: 'set-row-title' }, '导入项目数据'),
            el('div', { class: 'set-row-desc' }, '选择旧电脑拷贝的 db/app.db，全量覆盖本机数据')),
          importBtn))),

    // 右侧：头像
    el('div', { class: 'set-card set-avatar-col' },
      el('div', { class: 'set-card-head' },
        el('span', { class: 'icon', style: { width: '15px', height: '15px' }, innerHTML: icon('person') }),
        '个人头像'),
      el('div', { class: 'set-avatar-body' },
        avatarSlot,
        uploadZone,
        fileInput,
        el('div', { class: 'set-avatar-links' },
          el('button', {
            class: 'set-avatar-link',
            onclick: () => { avatarValue = null; renderAvatarPreview(); },
          }, '删除'),
          el('button', { class: 'set-avatar-link purple', onclick: () => fileInput.click() }, '更换')))),

    // 底部操作栏
    el('div', { class: 'set-actions-bar' },
      el('div', { class: 'set-actions-hint' }, '修改后记得点击保存'),
      el('div', { class: 'set-actions' }, cancelBtn, saveBtn)));
}

// ---------- 壁纸（开关 / 固定 / 亮度模糊滑杆 / 近期图库） ----------
function wallpaperTab() {
  // 本地状态：优先取模块内当前生效设置（已含登录后加载结果）
  const state = {
    enabled: false, pinnedImageId: null, brightness: 100, blur: 0, url: null, title: null,
    ...(getWallpaperState() || {}),
  };
  // 首次进入若模块还没拿到服务端数据，补拉一次
  if (!getWallpaperState()) loadWallpaper().then(renderAll).catch(() => {});

  // —— 预览 ——
  const preview = el('div', { class: 'wp-preview' });
  const caption = el('div', { class: 'wp-preview-caption' });
  function renderPreview() {
    clear(preview);
    if (state.enabled && state.url) {
      preview.classList.remove('empty');
      preview.style.backgroundImage = `url("${BASE_URL}${state.url}")`;
      preview.style.filter = `brightness(${state.brightness}%) blur(${state.blur}px)`;
      caption.textContent = state.title || state.copyright || '';
    } else {
      preview.classList.add('empty');
      preview.style.backgroundImage = '';
      preview.style.filter = '';
      clear(preview);
      preview.append(el('div', { class: 'wp-preview-empty' },
        state.enabled ? '暂无可用壁纸，服务端尚未同步到 Bing 壁纸' : '开启壁纸后在此预览'));
      caption.textContent = '';
    }
  }

  // —— 开关 ——
  const switchBtn = el('button', {
    class: 'wp-switch', title: '开启/关闭壁纸',
    onclick: () => {
      state.enabled = !state.enabled;
      applyWallpaper({ ...state }); // 立即生效（无可用壁纸时自动回退默认外观）
      renderAll();
      scheduleWallpaperSave({ enabled: state.enabled });
    },
  });

  // —— 模式：跟随每日 / 固定当前 ——
  const modeHint = el('span', { class: 'wp-hint' });
  const followBtn = el('button', {
    class: 'wp-mode-btn',
    onclick: async () => {
      if (state.pinnedImageId == null) return;
      state.pinnedImageId = null;
      renderAll();
      try {
        await saveWallpaperSettingNow({ pinnedImageId: null });
        renderAll();
        toast('已跟随每日壁纸', 'success');
      } catch (err) {
        toast(err?.message || '保存失败，请稍后重试', 'error');
      }
    },
  }, '跟随每日');
  const pinBtn = el('button', {
    class: 'wp-mode-btn',
    onclick: async () => {
      if (state.pinnedImageId != null || !state.url) return;
      // 固定需要图片ID：跟随每日时先从近期图库按 URL 匹配当日图
      const match = (galleryCache || []).find((img) => img.url === state.url);
      if (!match) {
        toast('暂未找到当前壁纸的图库记录，请从下方近期壁纸中选择', 'error');
        return;
      }
      state.pinnedImageId = match.id;
      renderAll();
      try {
        await saveWallpaperSettingNow({ pinnedImageId: match.id });
        renderAll();
        toast('已固定当前壁纸', 'success');
      } catch (err) {
        toast(err?.message || '保存失败，请稍后重试', 'error');
      }
    },
  }, '固定此图');
  function renderMode() {
    const pinned = state.pinnedImageId != null;
    followBtn.classList.toggle('active', !pinned);
    pinBtn.classList.toggle('active', pinned);
    modeHint.textContent = pinned ? '已固定，不再自动更换' : '每日自动更换 Bing 壁纸';
  }

  // —— 滑杆 ——
  const brightnessVal = el('span', { class: 'wp-row-value' }, `${state.brightness}%`);
  const blurVal = el('span', { class: 'wp-row-value' }, `${state.blur}px`);
  const brightnessSlider = el('input', {
    class: 'wp-slider', type: 'range', min: '30', max: '150', step: '1',
    oninput: () => {
      state.brightness = Number(brightnessSlider.value);
      brightnessVal.textContent = `${state.brightness}%`;
      applyWallpaper({ ...state }); // 主壁纸层实时生效
      renderPreview();              // 左侧预览同步
      scheduleWallpaperSave({ brightness: state.brightness });
    },
  });
  const blurSlider = el('input', {
    class: 'wp-slider', type: 'range', min: '0', max: '30', step: '1',
    oninput: () => {
      state.blur = Number(blurSlider.value);
      blurVal.textContent = `${state.blur}px`;
      applyWallpaper({ ...state });
      renderPreview();
      scheduleWallpaperSave({ blur: state.blur });
    },
  });

  // —— 壁纸图库（按来源筛选，点击固定） ——
  let galleryCache = null;
  let gallerySource = null; // null=全部 / 'bing' / 'nasa'
  const gallery = el('div', { class: 'wp-gallery' });
  function renderGallery() {
    clear(gallery);
    if (!galleryCache) {
      gallery.append(el('div', { class: 'wp-hint' }, '壁纸加载中...'));
      return;
    }
    if (!galleryCache.length) {
      gallery.append(el('div', { class: 'wp-hint' }, '暂无壁纸，点击右上方「获取最新壁纸」拉取在线壁纸'));
      return;
    }
    galleryCache.forEach((img) => {
      const pinned = img.id === state.pinnedImageId;
      const thumb = el('button', {
        class: `wp-thumb${pinned ? ' active' : ''}`,
        title: img.title || img.copyright || img.url,
        style: { backgroundImage: `url("${BASE_URL}${img.url}")` },
        onclick: async () => {
          state.pinnedImageId = img.id;
          state.url = img.url;
          state.title = img.title;
          renderAll();
          try {
            await saveWallpaperSettingNow({ pinnedImageId: img.id });
            renderAll();
            toast('已固定该壁纸', 'success');
          } catch (err) {
            toast(err?.message || '保存失败，请稍后重试', 'error');
          }
        },
      }, el('span', { class: 'wp-thumb-date' }, img.imageDate || ''));
      if (pinned) thumb.append(el('span', { class: 'wp-thumb-pinned' }, '✓'));
      gallery.append(thumb);
    });
  }
  function loadGallery() {
    galleryCache = null;
    renderGallery();
    api.getWallpaperImages(30, gallerySource).then((list) => {
      galleryCache = list || [];
      renderGallery();
    }).catch(() => {
      galleryCache = [];
      renderGallery();
    });
  }

  // 来源筛选条
  const SOURCES = [
    { key: null, label: '全部' },
    { key: 'bing', label: 'Bing 每日' },
    { key: 'nasa', label: 'NASA 太空' },
  ];
  const sourceChips = el('div', { class: 'wp-source-chips' });
  function renderChips() {
    clear(sourceChips);
    SOURCES.forEach((s) => {
      sourceChips.append(el('button', {
        class: `wp-chip${gallerySource === s.key ? ' active' : ''}`,
        onclick: () => {
          if (gallerySource === s.key) return;
          gallerySource = s.key;
          renderChips();
          loadGallery();
        },
      }, s.label));
    });
  }
  renderChips();
  loadGallery();

  // 获取最新壁纸：从 Bing/NASA 拉取并落盘，完成后刷新预览与图库
  const fetchBtn = el('button', {
    class: 'wp-chip wp-fetch',
    onclick: async () => {
      if (fetchBtn.disabled) return;
      fetchBtn.disabled = true;
      fetchBtn.textContent = '获取中...';
      try {
        const added = await api.syncWallpapers();
        await loadWallpaper();
        loadGallery();
        renderAll();
        toast(added > 0 ? `已获取 ${added} 张新壁纸` : '壁纸已是最新', 'success');
      } catch (err) {
        toast(err?.message || '获取失败，请稍后重试', 'error');
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = '获取最新壁纸';
      }
    },
  }, '获取最新壁纸');

  // 即时保存（模式/固定等离散操作；滑杆走防抖的 scheduleWallpaperSave）。
  // saveWallpaperSetting 返回服务端 VO（含"跟随每日"时计算出的最新 URL），已在模块内应用
  function saveWallpaperSettingNow(patch) {
    return saveWallpaperSetting(patch);
  }

  function renderAll() {
    switchBtn.classList.toggle('on', state.enabled);
    brightnessSlider.value = String(state.brightness);
    blurSlider.value = String(state.blur);
    brightnessVal.textContent = `${state.brightness}%`;
    blurVal.textContent = `${state.blur}px`;
    renderPreview();
    renderMode();
    renderGallery();
  }
  renderAll();

  return el('div', { class: 'set-card' },
    el('div', { class: 'set-card-head' },
      el('span', { class: 'icon', style: { width: '15px', height: '15px' }, innerHTML: icon('paintbrush') }),
      '壁纸'),
    el('div', { class: 'wp-layout' },
      el('div', { class: 'wp-preview-wrap' }, preview, caption),
      el('div', { class: 'wp-controls' },
        el('div', { class: 'wp-row' },
          el('span', { class: 'wp-row-label' }, '开启壁纸'),
          switchBtn),
        el('div', { class: 'wp-row' },
          el('span', { class: 'wp-row-label' }, '更换模式'),
          el('div', { style: { display: 'flex', gap: '8px' } }, followBtn, pinBtn)),
        el('div', { class: 'wp-row' }, modeHint),
        el('div', { class: 'wp-slider-row' },
          el('div', { class: 'wp-row' },
            el('span', { class: 'wp-row-label' }, '亮度'),
            brightnessVal),
          brightnessSlider),
        el('div', { class: 'wp-slider-row' },
          el('div', { class: 'wp-row' },
            el('span', { class: 'wp-row-label' }, '模糊'),
            blurVal),
          blurSlider),
        el('div', { class: 'wp-hint' }, '调整实时生效并自动保存；亮度调低、模糊调高可提升文字可读性'))),
    el('div', { class: 'wp-gallery-head' }, '壁纸图库（点击固定）'),
    el('div', { class: 'wp-chips-row' }, sourceChips, fetchBtn),
    gallery);
}

// ---------- 视图 ----------
export function SettingView({ user, onUserUpdated }) {
  let activeTab = 'profile';
  const content = el('div', { class: 'set-content' });
  const tabProfile = el('button', { class: 'set-tab active' }, '个人资料');
  const tabWallpaper = el('button', { class: 'set-tab' }, '壁纸');

  function renderContent() {
    clear(content);
    if (activeTab === 'wallpaper') {
      content.append(wallpaperTab());
    } else {
      content.append(profileTab(user, onUserUpdated));
    }
    tabProfile.classList.toggle('active', activeTab === 'profile');
    tabWallpaper.classList.toggle('active', activeTab === 'wallpaper');
  }
  tabProfile.addEventListener('click', () => { activeTab = 'profile'; renderContent(); });
  tabWallpaper.addEventListener('click', () => { activeTab = 'wallpaper'; renderContent(); });
  renderContent();

  return el('div', { class: 'set-root' },
    el('div', { class: 'set-header' },
      el('div', { class: 'set-title' }, '设置'),
      el('div', { class: 'set-subtitle' }, '管理你的个人资料与壁纸偏好')),
    el('div', { class: 'set-tabs' }, tabProfile, tabWallpaper),
    el('div', { class: 'set-sep' }),
    content);
}
