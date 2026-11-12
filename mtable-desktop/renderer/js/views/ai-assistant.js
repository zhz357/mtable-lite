//
// views/ai-assistant.js — 首页 AI 助手（右下角悬浮入口 + 右侧滑出功能面板）
//
// 结构设计：
// · 面板内含「智能聊天」「模型设置」「历史任务」三个视图（左右滑切换，均常驻 DOM，切回不丢状态）
// · 面板左缘可拖动调整宽度（320~720px），宽度在会话期间保持
// · 聊天走后端流式接口 POST /api/ai/chat（SSE 增量渲染），模型配置按用户保存在后端
// · 新建任务：自动把当前对话存入后端历史（POST /api/ai/tasks），再清空开始新对话；
//   历史任务可查看、恢复（完整上下文继续追问）、删除
// · 模型设置页支持对接国内主流大模型厂商（OpenAI 兼容协议），可添加/编辑/启用/测试/删除
//
import { el, clear, toast, confirmModal } from '../ui.js';
import { icon } from '../icons.js';
import { api } from '../api.js';

// 面板宽度（模块级变量：跨视图切换与面板重建均保持，会话期间有效）
let PANEL_WIDTH = null;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 720;

// ---------- 厂商预设（OpenAI 兼容端点；模型 ID 不做硬编码，改由厂商 /models 接口实时拉取） ----------
const PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', logo: 'DS', color: '#4d6bfe', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'qwen', label: '通义千问', logo: '通', color: '#615ced', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'zhipu', label: '智谱 GLM', logo: 'Z', color: '#3859ff', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'moonshot', label: 'Kimi', logo: 'K', color: '#1f2329', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'qianfan', label: '百度千帆', logo: '帆', color: '#2932e1', baseUrl: 'https://qianfan.baidubce.com/v2' },
  { id: 'hunyuan', label: '腾讯混元', logo: '混', color: '#0052d9', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { id: 'minimax', label: 'MiniMax', logo: 'M', color: '#e8552f', baseUrl: 'https://api.minimax.chat/v1' },
  { id: 'xiaomi', label: '小米 MiMo', logo: 'MI', color: '#ff6900', baseUrl: 'https://api.xiaomimimo.com/v1' },
  { id: 'custom', label: '自定义', logo: 'DIY', color: '#7a8699', baseUrl: '' },
];

const providerPreset = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[PROVIDERS.length - 1];

// 厂商展示顺序支持拖动调整并持久化（localStorage，与悬浮球位置记忆同一模式）
const PROVIDER_ORDER_KEY = 'mtable.ai.providers.order';

function loadProviderOrder() {
  try {
    const order = JSON.parse(localStorage.getItem(PROVIDER_ORDER_KEY) || 'null');
    return Array.isArray(order) ? order.filter((x) => typeof x === 'string') : null;
  } catch { return null; }
}

function saveProviderOrder(ids) {
  try { localStorage.setItem(PROVIDER_ORDER_KEY, JSON.stringify(ids)); } catch { /* 忽略 */ }
}

/** 按持久化顺序排列厂商（新增厂商未记录顺序时排在末尾） */
function orderedProviders() {
  const order = loadProviderOrder();
  if (!order?.length) return [...PROVIDERS];
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...PROVIDERS].sort((a, b) =>
    (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

/** 防抖：输入停顿后再触发（用于密钥/地址变化后拉取模型列表） */
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

/** 时间显示：当年省略年份（如 09-24 15:30） */
function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}-`;
  return `${year}${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 视图一：智能聊天 ----------
// state 由面板层持有（切换到设置页再切回时，聊天记录与输入不丢失）
function mountChat(box, ctx, state) {
  const history = state.history; // [{ role: 'user' | 'assistant', text }]
  let busy = false;
  let abortCtrl = null; // 生成中可手动停止

  const list = el('div', { class: 'ai-chat-list' });
  const input = el('input', {
    class: 'field-input ai-chat-input', type: 'text',
    placeholder: '输入问题，Enter 发送…',
    onkeydown: (e) => { if (e.key === 'Enter') send(); },
  });

  const sendBtn = el('button', {
    class: 'ai-chat-send', type: 'button', title: '发送', onclick: () => (busy ? stop() : send()),
  }, el('span', { class: 'icon', innerHTML: icon('paperplane.fill') }));

  /** 消息头像：机器人（紫蓝渐变）/ 当前用户（青绿渐变或自定义头像），一眼区分角色 */
  function msgAvatar(role) {
    if (role === 'assistant') {
      return el('span', { class: 'ai-msg-avatar bot' },
        el('span', { class: 'icon', innerHTML: icon('robot') }));
    }
    const avatar = el('span', { class: 'ai-msg-avatar user' });
    if (ctx.user?.avatar && ctx.user.avatar.startsWith('data:image')) {
      avatar.append(el('img', { src: ctx.user.avatar, alt: '' }));
    } else {
      avatar.append(el('span', { class: 'ai-msg-avatar-char' },
        (ctx.user?.nickname || '我').slice(0, 1)));
    }
    return avatar;
  }

  /** 追加一条消息，返回气泡节点（流式场景由调用方持续改写文本） */
  function appendMsg(role, text, { error = false, action, onAction } = {}) {
    const bubble = el('div', { class: `ai-msg-bubble${error ? ' error' : ''}` });
    const msg = el('div', { class: `ai-msg ${role === 'user' ? 'user' : 'ai'}` },
      msgAvatar(role), bubble);
    if (text) bubble.textContent = text;
    if (action) {
      bubble.append(el('div', { class: 'ai-msg-action' },
        el('button', { class: 'ai-msg-action-btn', type: 'button', onclick: onAction }, action)));
    }
    list.append(msg);
    list.scrollTop = list.scrollHeight;
    return { msg, bubble };
  }

  /** AI 输入中指示（机器人头像 + 三点跳动） */
  function appendTyping() {
    const node = el('div', { class: 'ai-msg ai' },
      msgAvatar('assistant'),
      el('div', { class: 'ai-msg-bubble ai-typing' },
        el('i', {}), el('i', {}), el('i', {})));
    list.append(node);
    list.scrollTop = list.scrollHeight;
    return node;
  }

  /** 未接入大模型时的顶部引导条（供设置页变更模型后刷新） */
  function renderBanner() {
    box.querySelector('.ai-chat-banner')?.remove();
    if (ctx.getActiveModel()) return;
    list.before(el('div', { class: 'ai-chat-banner' },
      el('span', { class: 'icon', innerHTML: icon('bolt') }),
      el('span', { class: 'ai-chat-banner-text' }, '还没有接入大模型，接入后即可开始对话'),
      el('button', {
        class: 'ai-chat-banner-btn', type: 'button',
        onclick: () => ctx.openSettings(),
      }, '去配置')));
  }
  ctx.refreshBanner = renderBanner;

  /** 尽量贴底：仅当用户本就停留在底部附近时才自动滚动，避免打断回看 */
  function paint(node, text) {
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    node.textContent = text;
    if (stick) list.scrollTop = list.scrollHeight;
  }

  async function send(preset) {
    const t = String(preset ?? input.value).trim();
    if (!t || busy) return;
    input.value = '';
    history.push({ role: 'user', text: t });
    appendMsg('user', t);
    busy = true;
    input.disabled = true;
    renderBanner();
    const typing = appendTyping();

    // 流式气泡：首个增量到达时替换 typing
    let streaming = null;
    let full = '';
    abortCtrl = new AbortController();
    const beginStream = () => {
      typing.remove();
      streaming = appendMsg('assistant', '');
      sendBtn.classList.add('stop');
      sendBtn.title = '停止生成';
      sendBtn.querySelector('.icon').innerHTML = icon('stop.fill');
    };
    const finishStream = () => {
      sendBtn.classList.remove('stop');
      sendBtn.title = '发送';
      sendBtn.querySelector('.icon').innerHTML = icon('paperplane.fill');
      abortCtrl = null;
    };

    // 携带最近历史（排除欢迎语等，仅保留 user/assistant 真实对话）
    const messages = history
      .filter((m) => m.text && !m.welcome)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.text }));

    try {
      await api.chatStream(messages, (delta) => {
        if (!streaming) beginStream();
        full += delta;
        paint(streaming.bubble, full);
      }, abortCtrl.signal);
      typing.remove();
      if (full) {
        history.push({ role: 'assistant', text: full });
      } else {
        appendMsg('assistant', '（模型没有返回内容，换个问法试试？）');
      }
    } catch (err) {
      typing.remove();
      if (err?.name === 'AbortError') {
        // 保留已流式生成的内容（气泡仍在），仅追加停止提示
        if (full) history.push({ role: 'assistant', text: full });
        if (full || streaming) {
          list.append(el('div', { class: 'ai-chat-stopnote' }, '已停止生成'));
        }
      } else {
        // 业务错误细分：未配置模型 / 额度受限（429、余额不足等）均可一键前往设置处理
        const msg = err?.message || '发送失败，请稍后重试';
        const noModel = err?.business && /模型设置|配置/.test(msg);
        const quota = err?.business && /429|额度|余额|充值|欠费|频繁/.test(msg);
        appendMsg('assistant', msg, { error: true,
          action: noModel || quota ? '去设置' : null,
          onAction: noModel || quota ? () => ctx.openSettings() : null });
      }
    } finally {
      finishStream();
      busy = false;
      input.disabled = false;
      list.scrollTop = list.scrollHeight;
      input.focus();
    }
  }

  /** 手动停止生成 */
  function stop() {
    if (abortCtrl) abortCtrl.abort();
  }

  // ---------- 任务管理：新建 / 自动保存 / 恢复 ----------
  const welcomeText = () => `你好，${ctx.user?.nickname || ''}！我是 MTable 的 AI 助手。在「模型设置」中接入你的大模型（DeepSeek、通义千问、Kimi 等）后，即可在这里畅聊。`;

  /** 新建任务：清空当前对话区（历史已由调用方先保存） */
  function resetChat() {
    history.length = 0;
    state.taskId = null;
    clear(list);
    history.push({ role: 'assistant', welcome: true, text: welcomeText() });
    appendMsg('assistant', welcomeText());
    renderBanner();
    list.scrollTop = list.scrollHeight;
  }

  /** 将当前对话保存为历史任务（新建任务 / 恢复任务前自动保存复用）；无有效消息时返回 null */
  async function saveCurrent() {
    const msgs = history
      .filter((m) => m.text && !m.welcome)
      .map((m) => ({ role: m.role, content: m.text }));
    if (!msgs.length) return null;
    return api.saveAiTask({ id: state.taskId ?? undefined, messages: msgs });
  }
  ctx.saveCurrent = saveCurrent;
  ctx.isBusy = () => busy;

  /** 恢复历史任务：整体替换当前对话（上下文完整，可继续追问）；忙碌时拒绝 */
  function applyTask(task) {
    if (busy) { toast('请等待当前回答完成后再恢复任务', 'error'); return false; }
    history.length = 0;
    state.taskId = task.id ?? null;
    clear(list);
    for (const m of task.messages || []) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      history.push({ role, text: m.content });
      appendMsg(role, m.content);
    }
    if (!history.length) {
      history.push({ role: 'assistant', welcome: true, text: welcomeText() });
      appendMsg('assistant', welcomeText());
    }
    renderBanner();
    list.scrollTop = list.scrollHeight;
    return true;
  }
  ctx.applyTask = applyTask;

  /** 新建任务：自动保存当前对话到历史记录后，清空对话区开始新任务 */
  async function newTask() {
    if (busy) return toast('请等待当前回答完成后再新建任务', 'error');
    try {
      const saved = await saveCurrent();
      if (saved) toast('当前对话已存入历史记录', 'success');
    } catch (err) {
      // 保存失败不清理，保护用户数据
      return toast(err?.message || '保存失败，暂未新建任务', 'error');
    }
    resetChat();
    input.focus();
  }

  // 渲染：工具栏 + 历史记录重放 + 欢迎语 + 快捷提问 + 输入区
  const toolbar = el('div', { class: 'ai-chat-toolbar' },
    el('button', { class: 'ai-tool-btn', type: 'button', onclick: newTask },
      el('span', { class: 'icon', innerHTML: icon('plus.circle.fill') }), '新建任务'),
    el('button', {
      class: 'ai-tool-btn', type: 'button', title: '查看与恢复历史任务',
      onclick: () => ctx.openHistory(),
    }, el('span', { class: 'icon', innerHTML: icon('clock') }), '历史记录'));
  if (!history.length) {
    history.push({ role: 'assistant', welcome: true, text: welcomeText() });
  }
  for (const m of history) appendMsg(m.role, m.text);
  const chips = el('div', { class: 'ai-chips' },
    ['用一句话介绍你自己', '帮我写一份周报模板', '推荐几个提升效率的小习惯'].map((q) =>
      el('button', { class: 'ai-chip', type: 'button', onclick: () => send(q) }, q)));
  box.append(toolbar, list, chips,
    el('div', { class: 'ai-chat-inputbar' }, input, sendBtn));
  renderBanner();
  list.scrollTop = list.scrollHeight;
  input.focus();
}

// ---------- 视图二：模型设置（列表 + 表单） ----------
function mountSettings(box, ctx) {
  let models = null;      // 后端配置列表
  let form = null;        // 非空 = 表单视图（{} 新增；{...} 编辑）
  let testing = false;    // 连接测试进行中

  const scroll = el('div', { class: 'ai-set-scroll' });

  /** 厂商小徽标（品牌色渐变圆角块） */
  function logoNode(provider, size = 34) {
    const p = providerPreset(provider);
    return el('span', {
      class: 'ai-model-logo',
      style: {
        width: `${size}px`, height: `${size}px`,
        fontSize: `${p.logo.length > 1 ? size * 0.3 : size * 0.42}px`,
        background: `linear-gradient(135deg, ${p.color}, ${p.color}cc)`,
      },
    }, p.logo);
  }

  // ================= 表单视图 =================
  function renderForm() {
    const editing = form.id != null;

    const nameInput = el('input', { class: 'field-input', type: 'text', placeholder: '如：DeepSeek 官方', value: form.name || '', maxlength: 50 });
    const urlInput = el('input', { class: 'field-input', type: 'text', placeholder: 'https://…/v1（OpenAI 兼容根地址）', value: form.baseUrl || '', maxlength: 255 });
    const modelInput = el('input', { class: 'field-input', type: 'text', placeholder: '如：deepseek-chat', value: form.modelId || '', maxlength: 100 });
    const keyInput = el('input', {
      class: 'field-input', type: 'password', placeholder: editing
        ? `已保存 ${form.maskedApiKey || '密钥'}，留空则不修改` : 'sk-…',
      value: '', maxlength: 512,
    });
    const keyWrap = el('div', { class: 'ai-keywrap' }, keyInput,
      el('button', {
        class: 'ai-key-eye', type: 'button', title: '显示/隐藏',
        onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; },
      }, el('span', { class: 'icon', innerHTML: icon('eye') })));

    const testStatus = el('div', { class: 'ai-set-status' });

    /** 厂商网格：点击选择 + 拖动排序（顺序持久化到 localStorage） */
    const modelsWrap = el('div', { class: 'ai-provider-grid' });
    const providerList = orderedProviders();
    let dragId = null;

    function renderProviderGrid() {
      clear(modelsWrap);
      for (const pv of providerList) {
        const chip = el('button', {
          class: `ai-provider-chip${pv.id === form.provider ? ' active' : ''}`,
          type: 'button', draggable: 'true', title: '点击选择，按住拖动排序',
          onclick: () => pickProvider(pv.id),
          ondragstart: (e) => {
            dragId = pv.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', pv.id);
            chip.classList.add('dragging');
          },
          ondragend: () => { dragId = null; chip.classList.remove('dragging'); },
          ondragover: (e) => { e.preventDefault(); if (dragId && dragId !== pv.id) chip.classList.add('drag-over'); },
          ondragleave: () => chip.classList.remove('drag-over'),
          ondrop: (e) => {
            e.preventDefault();
            chip.classList.remove('drag-over');
            if (!dragId || dragId === pv.id) return;
            const from = providerList.findIndex((p) => p.id === dragId);
            const to = providerList.findIndex((p) => p.id === pv.id);
            if (from < 0 || to < 0) return;
            providerList.splice(to, 0, providerList.splice(from, 1)[0]);
            saveProviderOrder(providerList.map((p) => p.id));
            renderProviderGrid();
          },
        },
          el('span', {
            class: 'ai-provider-logo',
            style: { background: `linear-gradient(135deg, ${pv.color}, ${pv.color}cc)` },
          }, pv.logo), pv.label);
        modelsWrap.append(chip);
      }
    }

    /** 选择厂商：自动带出地址 / 名称（模型 ID 不做预设推荐，见远程拉取） */
    function pickProvider(id) {
      form.provider = id;
      const p = providerPreset(id);
      if (!editing) {
        if (!form.nameTouched) nameInput.value = p.label;
        urlInput.value = p.baseUrl;
      }
      renderProviderGrid();
    }

    // 远程模型列表：选择厂商后不硬编码推荐，改为用密钥实时拉取厂商最新模型 ID；拉不到则不显示
    const modelSuggest = el('div', { class: 'ai-chips ai-model-suggest' });
    let remoteModels = [];
    let remoteLoading = false;

    function renderSuggest() {
      clear(modelSuggest);
      if (remoteLoading) {
        modelSuggest.append(el('span', { class: 'ai-suggest-hint' }, '正在获取最新模型列表…'));
        return;
      }
      for (const m of remoteModels) {
        modelSuggest.append(el('button', {
          class: `ai-chip${m === modelInput.value ? ' active' : ''}`, type: 'button',
          onclick: () => { modelInput.value = m; renderSuggest(); },
        }, m));
      }
    }

    async function fetchRemoteModels() {
      if (remoteLoading) return;
      const baseUrl = urlInput.value.trim();
      const apiKey = keyInput.value.trim();
      if (!baseUrl || (!apiKey && !editing)) { remoteModels = []; renderSuggest(); return; }
      remoteLoading = true;
      renderSuggest();
      try {
        const result = await api.listRemoteAiModels({
          id: form.id ?? undefined,
          baseUrl,
          apiKey: apiKey || undefined,
        });
        remoteModels = result.ok ? (result.models || []) : [];
      } catch {
        remoteModels = []; // 拉取失败保持安静：不显示推荐
      } finally {
        remoteLoading = false;
        renderSuggest();
      }
    }
    const scheduleFetch = debounce(fetchRemoteModels, 700);
    urlInput.addEventListener('input', scheduleFetch);
    keyInput.addEventListener('input', scheduleFetch);
    modelInput.addEventListener('input', renderSuggest);

    renderProviderGrid();
    pickProvider(form.provider || 'deepseek');
    if (editing) fetchRemoteModels(); // 编辑已保存配置：用库中密钥直接拉取

    /** 连接测试：已保存配置不回传明文密钥，后端用库中密钥 */
    async function runTest() {
      if (testing) return;
      const apiKey = keyInput.value.trim();
      if (!form.id && !apiKey) { testStatus.className = 'ai-set-status error'; testStatus.textContent = '请先填写 API 密钥'; return; }
      testing = true;
      clear(testStatus).append(el('span', { class: 'spinner dark' }), ' 正在连接…');
      try {
        const result = await api.testAiModel({
          id: form.id ?? undefined,
          baseUrl: urlInput.value.trim(),
          apiKey: apiKey || undefined,
          modelId: modelInput.value.trim(),
        });
        testStatus.className = `ai-set-status ${result.ok ? 'ok' : 'error'}`;
        testStatus.textContent = result.ok
          ? `连接成功（${result.latencyMs}ms）：${result.reply || ''}`
          : `连接失败：${result.error || '未知错误'}`;
      } catch (err) {
        testStatus.className = 'ai-set-status error';
        testStatus.textContent = err?.message || '测试请求失败';
      } finally {
        testing = false;
      }
    }

    const saveBtn = el('button', { class: 'ai-btn-primary', type: 'button', onclick: save }, '保存');

    async function save() {
      const body = {
        name: nameInput.value.trim(),
        provider: form.provider,
        baseUrl: urlInput.value.trim(),
        apiKey: keyInput.value.trim() || undefined,
        modelId: modelInput.value.trim(),
      };
      if (!body.name) return toast('请填写配置名称', 'error');
      if (!body.baseUrl) return toast('请填写 API 地址', 'error');
      if (!body.modelId) return toast('请填写模型 ID', 'error');
      if (!form.id && !body.apiKey) return toast('请填写 API 密钥', 'error');
      saveBtn.disabled = true; // 防重复提交
      try {
        const saved = form.id
          ? await api.updateAiModel(form.id, body)
          : await api.addAiModel(body);
        toast(form.id ? '已保存' : '已添加', 'success');
        form = null;
        await refresh();
        // 保存后处于启用状态的模型：直接回到聊天页，衔接沟通流程不中断
        if (saved?.isActive === 1) ctx.goChat();
      } catch (err) {
        toast(err?.message || '保存失败，请稍后重试', 'error');
      } finally {
        saveBtn.disabled = false;
      }
    }

    clear(box).append(
      el('div', { class: 'ai-set-header' },
        el('button', {
          class: 'ai-set-back', type: 'button', title: '返回列表',
          onclick: () => { form = null; render(); },
        }, el('span', { class: 'icon', innerHTML: icon('chevron.left') })),
        editing ? '编辑模型' : '添加模型'),
      el('div', { class: 'ai-set-scroll' },
        el('div', { class: 'ai-form-label' }, '选择厂商'),
        modelsWrap,
        el('div', { class: 'ai-form-label' }, '配置名称'),
        nameInput,
        el('div', { class: 'ai-form-label' }, 'API 地址'),
        urlInput,
        el('div', { class: 'ai-form-hint' },
          '预设地址来自厂商公开文档，可能随厂商调整而变化；连接失败时请按厂商最新文档修改。'),
        el('div', { class: 'ai-form-label ai-form-label-row' }, '模型 ID',
          el('button', {
            class: 'ai-form-refresh', type: 'button', title: '拉取最新模型列表',
            onclick: () => fetchRemoteModels(),
          }, el('span', { class: 'icon', innerHTML: icon('arrow.clockwise') }))),
        modelInput, modelSuggest,
        el('div', { class: 'ai-form-label' }, 'API 密钥'),
        keyWrap,
        testStatus,
        el('div', { class: 'ai-form-actions' },
          el('button', { class: 'ai-btn-ghost', type: 'button', onclick: runTest }, '测试连接'),
          saveBtn)));
    nameInput.addEventListener('input', () => { form.nameTouched = true; });
  }

  // ================= 列表视图 =================
  function stateNode(text, spinner = false) {
    return el('div', { class: 'ai-set-state' },
      spinner ? el('span', { class: 'spinner dark' }) : null, text);
  }

  async function refresh() {
    try {
      models = await api.getAiModels() || [];
    } catch (err) {
      models = [];
      clear(scroll).append(stateNode(err?.message || '加载失败，请检查后端服务'));
      return;
    }
    const active = models.find((m) => m.isActive === 1) || null;
    ctx.onModelsChanged(active);
    if (form) renderForm();
    else render();
  }

  async function activate(model) {
    try {
      await api.activateAiModel(model.id);
      toast(`已启用「${model.name}」`, 'success');
      await refresh();
    } catch (err) {
      toast(err?.message || '操作失败', 'error');
    }
  }

  async function remove(model) {
    const ok = await confirmModal({
      title: '删除模型配置',
      message: `确定删除「${model.name}」吗？删除后不可恢复。`,
      confirmText: '删除', danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteAiModel(model.id);
      toast('已删除', 'success');
      await refresh();
    } catch (err) {
      toast(err?.message || '删除失败', 'error');
    }
  }

  async function testSaved(model, btn) {
    if (testing) return;
    testing = true;
    btn.classList.add('testing');
    try {
      const result = await api.testAiModel({ id: model.id, baseUrl: model.baseUrl, modelId: model.modelId });
      if (result.ok) toast(`连接成功（${result.latencyMs}ms）`, 'success');
      else toast(`连接失败：${result.error || '未知错误'}`, 'error');
    } catch (err) {
      toast(err?.message || '测试失败', 'error');
    } finally {
      testing = false;
      btn.classList.remove('testing');
    }
  }

  function render() {
    clear(box).append(
      el('div', { class: 'ai-set-header' },
        el('button', {
          class: 'ai-set-back', type: 'button', title: '返回聊天',
          onclick: () => ctx.goChat(),
        }, el('span', { class: 'icon', innerHTML: icon('chevron.left') })),
        el('span', { class: 'ai-set-header-title' }, '模型设置')),
      scroll);
    clear(scroll);

    if (!models) { scroll.append(stateNode('正在加载模型配置…', true)); refresh(); return; }
    if (!models.length) {
      const names = PROVIDERS.filter((p) => p.id !== 'custom').map((p) => p.label).join('、');
      scroll.append(
        el('div', { class: 'ai-set-empty' },
          el('span', { class: 'icon', innerHTML: icon('robot') }),
          el('div', { class: 'ai-set-empty-title' }, '还没有接入大模型'),
          el('div', { class: 'ai-set-empty-sub' }, `支持 ${names} 等`),
          el('button', {
            class: 'ai-btn-primary', type: 'button',
            onclick: () => { form = {}; renderForm(); },
          }, '立即接入')));
      return;
    }

    for (const model of models) {
      const p = providerPreset(model.provider);
      const isActive = model.isActive === 1;
      scroll.append(el('div', { class: `ai-model-item${isActive ? ' active' : ''}` },
        logoNode(model.provider),
        el('div', { class: 'ai-model-main' },
          el('div', { class: 'ai-model-name' }, model.name,
            isActive ? el('span', { class: 'ai-model-badge' }, '使用中') : null),
          el('div', { class: 'ai-model-meta' }, `${p.label} · ${model.modelId}`)),
        el('div', { class: 'ai-model-actions' },
          isActive
            ? el('span', { class: 'ai-model-check' }, el('span', { class: 'icon', innerHTML: icon('checkmark') }))
            : el('button', { class: 'ai-model-use', type: 'button', title: '设为当前使用', onclick: () => activate(model) }, '启用'),
          el('button', { class: 'ai-iconbtn', type: 'button', title: '测试连接', onclick: (e) => testSaved(model, e.currentTarget) },
            el('span', { class: 'icon', innerHTML: icon('bolt') })),
          el('button', { class: 'ai-iconbtn', type: 'button', title: '编辑', onclick: () => { form = { ...model }; renderForm(); } },
            el('span', { class: 'icon', innerHTML: icon('pencil') })),
          el('button', { class: 'ai-iconbtn danger', type: 'button', title: '删除', onclick: () => remove(model) },
            el('span', { class: 'icon', innerHTML: icon('trash') })))));
    }

    scroll.append(el('button', {
      class: 'ai-add-btn', type: 'button',
      onclick: () => { form = {}; renderForm(); },
    }, el('span', { class: 'icon', innerHTML: icon('plus') }), '添加模型'));
  }

  render();
}

// ---------- 视图三：历史任务（列表 / 恢复 / 删除） ----------
function mountHistory(box, ctx) {
  let tasks = null;      // 后端任务列表
  let loading = false;   // 列表加载中

  const scroll = el('div', { class: 'ai-set-scroll' });

  function stateNode(text, spinner = false) {
    return el('div', { class: 'ai-set-state' },
      spinner ? el('span', { class: 'spinner dark' }) : null, text);
  }

  /** 拉取任务列表（进入视图时触发，轻量接口加载高效） */
  async function refresh() {
    if (loading) return;
    loading = true;
    clear(scroll).append(stateNode('正在加载历史任务…', true));
    try {
      tasks = await api.getAiTasks() || [];
    } catch (err) {
      tasks = null;
      clear(scroll).append(stateNode(err?.message || '加载失败，请检查后端服务'));
      return;
    } finally {
      loading = false;
    }
    render();
  }

  /** 恢复任务：先自动保存当前对话（防丢失），再拉取详情并整体替换当前对话 */
  async function openTask(task) {
    if (ctx.chatCtx.isBusy()) return toast('请等待当前回答完成', 'error');
    try {
      const saved = await ctx.chatCtx.saveCurrent();
      if (saved) toast('当前对话已自动保存', 'success');
      const detail = await api.getAiTaskDetail(task.id);
      if (ctx.chatCtx.applyTask(detail)) {
        ctx.goChat();
        toast('已恢复历史任务，可继续提问', 'success');
      }
    } catch (err) {
      toast(err?.message || '恢复失败，请稍后重试', 'error');
    }
  }

  async function remove(task, e) {
    e.stopPropagation(); // 不触发卡片点击（恢复）
    const ok = await confirmModal({
      title: '删除历史任务',
      message: `确定删除「${task.title}」吗？删除后不可恢复。`,
      confirmText: '删除', danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteAiTask(task.id);
      // 删除的是当前打开中的任务时，断开关联（避免下次保存覆盖已删除任务）
      if (ctx.currentTaskId() === task.id) ctx.clearTaskId();
      toast('已删除', 'success');
      await refresh();
    } catch (err) {
      toast(err?.message || '删除失败', 'error');
    }
  }

  function render() {
    clear(box).append(
      el('div', { class: 'ai-set-header' },
        el('button', {
          class: 'ai-set-back', type: 'button', title: '返回聊天',
          onclick: () => ctx.goChat(),
        }, el('span', { class: 'icon', innerHTML: icon('chevron.left') })),
        el('span', { class: 'ai-set-header-title' }, '历史任务')),
      scroll);
    clear(scroll);

    if (!tasks) { scroll.append(stateNode('正在加载历史任务…', true)); refresh(); return; }
    if (!tasks.length) {
      scroll.append(
        el('div', { class: 'ai-set-empty' },
          el('span', { class: 'icon', innerHTML: icon('clock') }),
          el('div', { class: 'ai-set-empty-title' }, '暂无历史任务'),
          el('div', { class: 'ai-set-empty-sub' }, '点击「新建任务」时，当前对话会自动\n保存到这里，随时可以恢复继续提问')));
      return;
    }

    for (const task of tasks) {
      scroll.append(el('div', {
        class: 'ai-history-item', title: '点击恢复该任务',
        onclick: () => openTask(task),
      },
        el('div', { class: 'ai-history-main' },
          el('div', { class: 'ai-history-title' }, task.title),
          el('div', { class: 'ai-history-meta' },
            `${task.messageCount} 条对话 · ${fmtTime(task.updateTime)}`)),
        el('button', {
          class: 'ai-iconbtn danger', type: 'button', title: '删除',
          onclick: (e) => remove(task, e),
        }, el('span', { class: 'icon', innerHTML: icon('trash') }))));
    }
  }

  render();
  return { refresh };
}

/**
 * AI 助手（悬浮入口 + 侧滑面板）
 * @param {object} opts
 * @param {object} [opts.user] 当前用户（聊天称呼与头像）
 */
export function AIAssistant({ user } = {}) {
  const chatState = { history: [], taskId: null }; // 聊天记录与当前任务跨视图切换保留
  let activeModel = null;            // 当前启用的大模型（设置页变更后同步）
  let escHandler = null;

  // ---- 眼睛 SVG 生成器（suffix 区分同页多实例的渐变/裁剪 defs id） ----
  // 分层：.ai-eye-blink 眨眼（scaleY，仅眼部）→ .ai-eye-iris 双眼同步注视 → .ai-eye-pupil 瞳孔缩放 → .ai-mouth 表情嘴
  const eyeSVG = (suffix = '') => `<svg class="ai-eye" viewBox="0 0 32 30" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="ai-iris-grad${suffix}" cx="35%" cy="35%" r="80%">
        <stop offset="0%" stop-color="#7fa3ff"/>
        <stop offset="55%" stop-color="#ff7a47"/>
        <stop offset="100%" stop-color="#f2913f"/>
      </radialGradient>
      <clipPath id="ai-eye-clip-l${suffix}"><ellipse cx="9.8" cy="11" rx="4.6" ry="6.2"/></clipPath>
      <clipPath id="ai-eye-clip-r${suffix}"><ellipse cx="22.2" cy="11" rx="4.6" ry="6.2"/></clipPath>
    </defs>
    <g class="ai-eye-blink">
      <ellipse cx="9.8" cy="11" rx="4.6" ry="6.2" fill="#fff"/>
      <ellipse cx="22.2" cy="11" rx="4.6" ry="6.2" fill="#fff"/>
      <g clip-path="url(#ai-eye-clip-l${suffix})">
        <g class="ai-eye-iris">
          <circle cx="9.8" cy="11" r="3.4" fill="url(#ai-iris-grad${suffix})"/>
          <circle class="ai-eye-pupil" cx="9.8" cy="11" r="1.7" fill="#232a52"/>
        </g>
        <circle cx="8.5" cy="9.3" r=".85" fill="#fff" opacity=".95"/>
      </g>
      <g clip-path="url(#ai-eye-clip-r${suffix})">
        <g class="ai-eye-iris">
          <circle cx="22.2" cy="11" r="3.4" fill="url(#ai-iris-grad${suffix})"/>
          <circle class="ai-eye-pupil" cx="22.2" cy="11" r="1.7" fill="#232a52"/>
        </g>
        <circle cx="20.9" cy="9.3" r=".85" fill="#fff" opacity=".95"/>
      </g>
    </g>
    <g class="ai-mouth"></g>
  </svg>`;

  // ---- 面板：头部 + 三视图（聊天 / 模型设置 / 历史任务，左右滑切换） ----
  const chatBox = el('div', { class: 'ai-view ai-view-chat' });
  const settingsBox = el('div', { class: 'ai-view ai-view-settings' });
  const historyBox = el('div', { class: 'ai-view ai-view-history' });

  const subLabel = el('div', { class: 'ai-panel-sub' }, '智能办公 · 功能持续扩展中');

  /** 右上角设置按钮：聊天 ⇄ 设置双向切换（实心齿轮 + 悬停提示说明功能） */
  const gearBtn = el('button', {
    class: 'ai-panel-btn', type: 'button', title: '模型设置',
    onclick: () => toggleView(),
  }, el('span', { class: 'icon', innerHTML: icon('gearshape.fill') }));

  /** 设置页变更模型后同步：头部副标题 + 聊天页引导条 */
  function onModelsChanged(model) {
    activeModel = model;
    subLabel.textContent = model
      ? `当前模型：${model.name} · ${model.modelId}`
      : '未接入模型 · 点击右上角设置';
    chatCtx.refreshBanner?.();
  }

  const chatCtx = {
    user,
    getActiveModel: () => activeModel,
    openSettings: () => showView('settings'),
    openHistory: () => showView('history'),
  };
  const settingsCtx = { onModelsChanged, goChat: () => showView('chat') };
  const historyCtx = {
    goChat: () => showView('chat'),
    chatCtx,
    currentTaskId: () => chatState.taskId,
    clearTaskId: () => { chatState.taskId = null; },
  };

  mountChat(chatBox, chatCtx, chatState);
  mountSettings(settingsBox, settingsCtx);
  const historyView = mountHistory(historyBox, historyCtx);

  const panel = el('div', { class: 'ai-panel' },
    el('div', { class: 'ai-panel-head' },
      el('span', { class: 'ai-panel-badge' },
        el('span', { class: 'ai-eye-wrap', innerHTML: eyeSVG('-badge') })),
      el('div', { class: 'ai-panel-title-wrap' },
        el('div', { class: 'ai-panel-title' }, 'AI 助手', el('span', { class: 'ai-panel-dot' })),
        subLabel),
      gearBtn,
      el('button', {
        class: 'ai-panel-btn', type: 'button', title: '关闭',
        onclick: () => close(),
      }, el('span', { class: 'icon', innerHTML: icon('xmark') }))),
    el('div', { class: 'ai-panel-body' }, chatBox, settingsBox, historyBox));

  /** 视图切换：聊天 ⇄ 设置 ⇄ 历史（同步齿轮按钮的悬停提示） */
  function showView(name) {
    const toSettings = name === 'settings';
    panel.classList.toggle('show-settings', toSettings);
    panel.classList.toggle('show-history', name === 'history');
    gearBtn.title = (toSettings || name === 'history') ? '返回聊天' : '模型设置';
    if (name === 'history') historyView.refresh?.(); // 每次进入历史视图刷新列表
  }

  /** 齿轮按钮：非聊天视图返回聊天，聊天视图进入设置 */
  function toggleView() {
    showView(panel.classList.contains('show-settings') || panel.classList.contains('show-history')
      ? 'chat' : 'settings');
  }

  // ---- 悬浮入口（渐变能量球 + 会眨眼的双眼 + 随机表情嘴 + 旋转光环 + 呼吸光晕） ----
  // 支持按住拖动调整位置（localStorage 记忆），避免遮挡首页内容；短点击仍为打开面板
  const fab = el('button', {
    class: 'ai-fab', type: 'button', title: 'AI 助手（可拖动调整位置）',
    onclick: () => {
      // 拖动结束的松手不当作点击（suppressClick 由拖拽逻辑置位）
      if (suppressClick) { suppressClick = false; return; }
      // 点击反馈：快速眨眼 + 瞳孔缩放，立即滑出面板（表情仅在悬浮时展示）
      fab.classList.add('blinking', 'poked');
      setTimeout(() => fab.classList.remove('blinking', 'poked'), 540);
      open();
    },
  },
    el('span', { class: 'ai-fab-orbit' }),
    el('span', { class: 'ai-fab-core' },
      el('span', { class: 'ai-eye-wrap', innerHTML: eyeSVG() })));

  // ---------- 表情库：悬停时随机展示一款（含嘴型） ----------
  const MOUTH_FACES = [
    { id: 'smile', svg: '<path d="M12.5 21.5 Q16 24.8 19.5 21.5" stroke="#232a52" stroke-width="1.8" fill="none" stroke-linecap="round"/>' },
    { id: 'happy', svg: '<path d="M11.8 20.8 Q16 27.2 20.2 20.8 Z" fill="#232a52"/>' },
    { id: 'ooh', svg: '<ellipse cx="16" cy="22.8" rx="2.1" ry="2.6" fill="#232a52"/>' },
    { id: 'tongue', svg: '<path d="M12.5 21.3 Q16 24.6 19.5 21.3" stroke="#232a52" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M14.2 22.8 Q16 26.6 17.8 22.8 Z" fill="#ff9db6"/>' },
    { id: 'grin', svg: '<path d="M12 21.8 Q16.5 26.2 20.5 20.4" stroke="#232a52" stroke-width="1.8" fill="none" stroke-linecap="round"/>' },
    { id: 'cat', svg: '<path d="M12.8 21.6 q1.6 2 3.2 0 q1.6 2 3.2 0" stroke="#232a52" stroke-width="1.7" fill="none" stroke-linecap="round"/>' },
  ];
  let lastFaceId = null;
  let faceTimer = null;
  const mouthGroup = fab.querySelector('.ai-mouth');

  /** 随机展示一款表情（避开上一次），1.8s 后自然收起 */
  function showFace() {
    let face;
    do { face = MOUTH_FACES[Math.floor(Math.random() * MOUTH_FACES.length)]; }
    while (MOUTH_FACES.length > 1 && face.id === lastFaceId);
    lastFaceId = face.id;
    mouthGroup.innerHTML = face.svg;
    mouthGroup.classList.add('show');
    clearTimeout(faceTimer);
    faceTimer = setTimeout(() => mouthGroup.classList.remove('show'), 1800);
  }

  // ---- 闲置眨眼：5-8 秒随机一次，18% 概率双眨；面板打开时暂停调度 ----
  let blinkTimer = null;
  const doBlink = () => {
    fab.classList.add('blinking');
    setTimeout(() => fab.classList.remove('blinking'), 400);
  };
  const scheduleBlink = () => {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      if (!fab.classList.contains('open')) {
        doBlink();
        if (Math.random() < .18) setTimeout(doBlink, 430);
      }
      scheduleBlink();
    }, 5000 + Math.random() * 3000);
  };
  scheduleBlink();

  // ---- 瞳孔注视：悬停时双眼朝鼠标方向轻微偏移（CSS 变量设在容器上，两个虹膜组继承），移开复位 ----
  const eyeWrap = fab.querySelector('.ai-eye-wrap');
  fab.addEventListener('mousemove', (e) => {
    const r = fab.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    eyeWrap.style.setProperty('--px', `${(Math.max(-1, Math.min(1, dx)) * 2.2).toFixed(2)}px`);
    eyeWrap.style.setProperty('--py', `${(Math.max(-1, Math.min(1, dy)) * 1.8).toFixed(2)}px`);
  });
  fab.addEventListener('mouseleave', () => {
    eyeWrap.style.setProperty('--px', '0px');
    eyeWrap.style.setProperty('--py', '0px');
  });
  // 悬停时随机做个表情（3s 节流，避免反复扫过时频繁触发）
  let lastHoverFace = 0;
  fab.addEventListener('mouseenter', () => {
    if (fab.classList.contains('open')) return;
    const now = Date.now();
    if (now - lastHoverFace > 3000) { lastHoverFace = now; showFace(); }
  });

  // ---- 可拖拽悬浮：按住入口拖动调整位置，localStorage 记忆，窗口变化时约束在可视区内 ----
  const FAB_POS_KEY = 'mtable.ai.fab.pos';
  const FAB_EDGE = 10; // 距容器边缘的最小间距

  let fabPos = null;      // 当前应用的位置（容器内 left/top；null = 使用 CSS 默认右下角）
  let dragState = null;   // 拖拽中状态 { pointerX, pointerY, startX, startY, moved }
  let suppressClick = false;

  /** 应用位置并约束在容器可视范围内（clamp=false 用于容器尺寸未就绪时的初始化） */
  function applyFabPos(x, y, { clamp = true } = {}) {
    if (clamp) {
      const maxX = Math.max(rootEl.clientWidth - fab.offsetWidth - FAB_EDGE, FAB_EDGE);
      const maxY = Math.max(rootEl.clientHeight - fab.offsetHeight - FAB_EDGE, FAB_EDGE);
      x = Math.min(Math.max(x, FAB_EDGE), maxX);
      y = Math.min(Math.max(y, FAB_EDGE), maxY);
    }
    fabPos = { x: Math.round(x), y: Math.round(y) };
    fab.style.left = `${fabPos.x}px`;
    fab.style.top = `${fabPos.y}px`;
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  }

  function loadFabPos() {
    try {
      const pos = JSON.parse(localStorage.getItem(FAB_POS_KEY) || 'null');
      return pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? pos : null;
    } catch { return null; }
  }

  function saveFabPos() {
    if (!fabPos) return;
    try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(fabPos)); } catch { /* 忽略 */ }
  }

  const rootEl = el('div', { class: 'ai-assistant-root' }, fab, panel);

  // 恢复上次位置（容器尺寸就绪前直接应用，首次布局后由 ResizeObserver 校正边界）
  const storedFabPos = loadFabPos();
  if (storedFabPos) applyFabPos(storedFabPos.x, storedFabPos.y, { clamp: false });

  // ---- 面板宽度拖拽：左缘拖动调整宽度（320~720px），会话期间保持 ----
  if (PANEL_WIDTH) panel.style.width = `${PANEL_WIDTH}px`;
  const resizer = el('div', { class: 'ai-panel-resizer', title: '拖动调整面板宽度' });
  panel.append(resizer);
  let resizeState = null;

  resizer.addEventListener('pointerdown', (e) => {
    resizeState = { startX: e.clientX, startW: panel.getBoundingClientRect().width };
    try { resizer.setPointerCapture(e.pointerId); } catch { /* 无活动指针时忽略 */ }
    panel.classList.add('resizing');
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!resizeState) return;
    const maxW = Math.max(Math.min(PANEL_MAX_WIDTH, rootEl.clientWidth - 24), PANEL_MIN_WIDTH);
    const w = Math.round(Math.min(
      Math.max(resizeState.startW + (resizeState.startX - e.clientX), PANEL_MIN_WIDTH), maxW));
    PANEL_WIDTH = w;
    panel.style.width = `${w}px`;
  });
  const endResize = () => {
    if (!resizeState) return;
    resizeState = null;
    panel.classList.remove('resizing');
  };
  resizer.addEventListener('pointerup', endResize);
  resizer.addEventListener('pointercancel', endResize);

  fab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || fab.classList.contains('open')) return;
    const rootRect = rootEl.getBoundingClientRect();
    const rect = fab.getBoundingClientRect();
    dragState = {
      pointerX: e.clientX, pointerY: e.clientY,
      startX: rect.left - rootRect.left, startY: rect.top - rootRect.top,
      moved: false,
    };
    try { fab.setPointerCapture(e.pointerId); } catch { /* 无活动指针时忽略（拖动仍沿元素表面跟踪） */ }
  });

  fab.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.pointerX;
    const dy = e.clientY - dragState.pointerY;
    if (!dragState.moved && Math.hypot(dx, dy) < 4) return; // 位移 4px 内仍视为点击
    dragState.moved = true;
    fab.classList.add('dragging');
    applyFabPos(dragState.startX + dx, dragState.startY + dy);
  });

  const endFabDrag = () => {
    if (!dragState) return;
    const moved = dragState.moved;
    dragState = null;
    fab.classList.remove('dragging');
    if (moved) {
      suppressClick = true; // 拖动结束的松手不触发打开面板
      saveFabPos();
    }
  };
  fab.addEventListener('pointerup', endFabDrag);
  fab.addEventListener('pointercancel', endFabDrag);
  fab.addEventListener('pointerleave', endFabDrag); // 指针捕获失败时指针滑出即安全收尾

  // 容器尺寸变化（窗口缩放/首次布局）时把入口拉回可视区
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (fabPos && !dragState && rootEl.clientWidth > 0) applyFabPos(fabPos.x, fabPos.y);
    }).observe(rootEl);
  }

  function open() {
    clearTimeout(blinkTimer); // 面板打开后入口隐藏，暂停眨眼调度
    clearTimeout(faceTimer);  // 收起未展示完的悬浮表情
    mouthGroup.classList.remove('show');
    panel.classList.add('open');
    fab.classList.add('open');
    showView('chat'); // 每次打开默认落在聊天页，符合直觉
    chatBox.querySelector('.ai-chat-input')?.focus();
    escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
  }

  function close() {
    panel.classList.remove('open');
    fab.classList.remove('open');
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    scheduleBlink(); // 恢复闲置眨眼
    doBlink();       // 回到闲置态时眨眼示意
  }

  // 启动时拉取一次模型配置，驱动头部副标题与聊天引导条
  api.getAiModels()
    .then((list) => onModelsChanged(list?.find((m) => m.isActive === 1) || null))
    .catch(() => onModelsChanged(null));

  return rootEl;
}
