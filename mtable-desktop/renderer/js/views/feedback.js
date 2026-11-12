//
// views/feedback.js — 问题反馈弹窗：反馈表单（反馈人/账号/时间/类型/描述）+ 反馈历史记录
//
import { el, clear, toast } from '../ui.js';
import { api, APIError } from '../api.js';
import { icon } from '../icons.js';

// 问题类型定义（与后端 AddFeedbackRequest 校验一致）
const FEEDBACK_TYPES = [
  { value: 'BUG', label: '功能异常' },
  { value: 'SUGGESTION', label: '功能建议' },
  { value: 'EXPERIENCE', label: '体验问题' },
  { value: 'OTHER', label: '其他' },
];

const CONTENT_MIN = 5;
const CONTENT_MAX = 2000;

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function typeLabel(value) {
  return FEEDBACK_TYPES.find((t) => t.value === value)?.label || value;
}

export function FeedbackModal({ user }) {
  let selectedType = null;
  let isSubmitting = false;
  let isLoadingHistory = false;
  let feedbacks = [];

  // ---------- 表单控件 ----------
  const now = new Date();
  const nameInput = el('input', {
    class: 'field-input fb-input', type: 'text', maxlength: '50',
    placeholder: '请输入姓名', value: user?.nickname || '',
  });
  const accountInput = el('input', {
    class: 'field-input fb-input', type: 'text', value: user?.phone || '', disabled: true,
  });
  const timeInput = el('input', {
    class: 'field-input fb-input', type: 'text', value: fmtDateTime(now), disabled: true, title: '反馈时间自动生成',
  });
  const contentInput = el('textarea', {
    class: 'field-input fb-textarea', rows: '5', maxlength: String(CONTENT_MAX),
    placeholder: '请详细描述您遇到的问题或建议（5-2000字）...',
  });
  const charCount = el('span', { class: 'fb-char-count' }, `0/${CONTENT_MAX}`);
  contentInput.addEventListener('input', () => {
    charCount.textContent = `${contentInput.value.length}/${CONTENT_MAX}`;
  });

  // ---------- 提示信息 ----------
  const errorBox = el('div', { class: 'fb-msg error', style: { display: 'none' } });
  const successBox = el('div', { class: 'fb-msg success', style: { display: 'none' } });
  function setMessage(box, msg) {
    if (msg) { box.textContent = msg; box.style.display = 'flex'; }
    else box.style.display = 'none';
  }

  // ---------- 问题类型选择（chip 单选） ----------
  const typeWrap = el('div', { class: 'fb-type-wrap' });
  function renderTypes() {
    clear(typeWrap);
    for (const t of FEEDBACK_TYPES) {
      typeWrap.append(el('button', {
        class: `fb-type-chip${selectedType === t.value ? ' active' : ''}`,
        type: 'button',
        onclick: () => { selectedType = t.value; renderTypes(); },
      }, t.label));
    }
  }
  renderTypes();

  // ---------- 提交 ----------
  const submitBtn = el('button', { class: 'fb-submit-btn', type: 'button', onclick: submit }, '提交反馈');

  async function submit() {
    setMessage(errorBox, '');
    setMessage(successBox, '');

    // 前端表单校验
    const name = nameInput.value.trim();
    const content = contentInput.value.trim();
    if (!name) return setMessage(errorBox, '请填写反馈人姓名');
    if (!selectedType) return setMessage(errorBox, '请选择问题类型');
    if (content.length < CONTENT_MIN) return setMessage(errorBox, `问题描述至少 ${CONTENT_MIN} 个字`);
    if (content.length > CONTENT_MAX) return setMessage(errorBox, `问题描述不能超过 ${CONTENT_MAX} 个字`);

    setSubmitting(true);
    try {
      await api.addFeedback({ reporterName: name, feedbackType: selectedType, content });
      setMessage(successBox, '反馈提交成功，感谢您的反馈！');
      toast('反馈提交成功', 'success');
      // 重置表单并切换到历史记录
      selectedType = null;
      renderTypes();
      contentInput.value = '';
      charCount.textContent = `0/${CONTENT_MAX}`;
      await switchTab('history');
    } catch (err) {
      const msg = err instanceof APIError && err.business ? err.message : '提交失败，请稍后重试';
      setMessage(errorBox, msg);
      toast(msg, 'error');
    }
    setSubmitting(false);
  }

  function setSubmitting(loading) {
    isSubmitting = loading;
    submitBtn.disabled = loading;
    clear(submitBtn);
    submitBtn.append(
      loading ? el('span', { class: 'spinner' }) : null,
      loading ? '' : '提交反馈',
    );
  }

  // ---------- 历史记录 ----------
  const historyList = el('div', { class: 'fb-history-list' });
  const historyRefreshBtn = el('button', {
    class: 'fb-history-refresh', title: '刷新',
    onclick: () => loadHistory(),
  }, el('span', { class: 'icon', innerHTML: icon('arrow.clockwise') }), '刷新');

  async function loadHistory() {
    if (isLoadingHistory) return;
    isLoadingHistory = true;
    clear(historyList).append(el('div', { class: 'fb-history-loading' },
      el('span', { class: 'spinner dark' }), '加载中...'));
    try {
      feedbacks = await api.getMyFeedbacks();
      renderHistory();
    } catch (err) {
      clear(historyList).append(el('div', { class: 'fb-history-empty' },
        err instanceof APIError && err.business ? err.message : '加载失败，请稍后重试'));
    }
    isLoadingHistory = false;
  }

  function renderHistory() {
    clear(historyList);
    if (!feedbacks.length) {
      historyList.append(el('div', { class: 'fb-history-empty' },
        el('span', { class: 'icon icon-lg', innerHTML: icon('bubble.left') }),
        el('div', { class: 'title' }, '暂无反馈记录'),
        el('div', {}, '您提交的问题反馈将在这里展示'),
      ));
      return;
    }
    for (const fb of feedbacks) {
      const processed = fb.status === 1;
      historyList.append(
        el('div', { class: 'fb-history-item' },
          el('div', { class: 'fb-history-head' },
            el('span', { class: 'fb-badge type' }, typeLabel(fb.feedbackType)),
            el('span', { class: `fb-badge status ${processed ? 'done' : 'pending'}` },
              processed ? '已处理' : '待处理'),
            el('span', { class: 'fb-history-time' }, fmtDateTime(fb.createTime))),
          el('div', { class: 'fb-history-content' }, fb.content),
        ));
    }
  }

  // ---------- 标签页 ----------
  const formPane = el('div', { class: 'fb-pane' },
    el('div', { class: 'fb-field' }, el('label', { class: 'field-label' }, '反馈人'), nameInput),
    el('div', { class: 'fb-field-row' },
      el('div', { class: 'fb-field' }, el('label', { class: 'field-label' }, '账号'), accountInput),
      el('div', { class: 'fb-field' }, el('label', { class: 'field-label' }, '反馈时间（自动生成）'), timeInput)),
    el('div', { class: 'fb-field' }, el('label', { class: 'field-label' }, '问题类型'), typeWrap),
    el('div', { class: 'fb-field' },
      el('label', { class: 'field-label' }, '问题描述'),
      contentInput,
      el('div', { class: 'fb-textarea-footer' },
        el('span', { class: 'fb-hint' }, '请勿填写敏感信息'),
        charCount)),
    errorBox,
    successBox,
    el('div', { class: 'fb-actions' }, submitBtn),
  );

  const historyPane = el('div', { class: 'fb-pane', style: { display: 'none' } },
    el('div', { class: 'fb-history-head-bar' },
      el('span', { class: 'fb-hint' }, '仅展示您本人提交的反馈'),
      historyRefreshBtn),
    historyList,
  );

  const tabForm = el('button', { class: 'fb-tab active', onclick: () => switchTab('form') }, '提交反馈');
  const tabHistory = el('button', { class: 'fb-tab', onclick: () => switchTab('history') }, '反馈历史');

  async function switchTab(tab) {
    tabForm.classList.toggle('active', tab === 'form');
    tabHistory.classList.toggle('active', tab === 'history');
    formPane.style.display = tab === 'form' ? 'flex' : 'none';
    historyPane.style.display = tab === 'history' ? 'flex' : 'none';
    if (tab === 'history') await loadHistory();
  }

  // ---------- 组装 ----------
  const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } },
    el('div', { class: 'fb-modal' },
      el('div', { class: 'fb-modal-head' },
        el('div', { class: 'fb-modal-title' },
          el('span', { class: 'icon', innerHTML: icon('bubble.left') }),
          '问题反馈'),
        el('button', {
          class: 'fb-modal-close', title: '关闭',
          onclick: () => mask.remove(),
        }, el('span', { class: 'icon', innerHTML: icon('xmark') }))),
      el('div', { class: 'fb-tabs' }, tabForm, tabHistory),
      formPane,
      historyPane,
    ),
  );

  document.getElementById('modal-root').append(mask);
  nameInput.focus();
}
