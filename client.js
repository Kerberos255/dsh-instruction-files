window.__ModuleLoader__.load({ id: 'dsh-instruction-files', factory: require => {
const React = require('react');
// BEGIN GENERATED PLUGIN SETTINGS
// Embedded by build.mjs. React and the official Connection are provided by DSH.
const { Switch: DshSwitch, Button: DshButton } = require('@deepseek-ai/dsh-client-ui-primitives');
function createConfigScope(connection, endpoint) {
  let state = { status: 'loading', writable: connection.isLoopback !== false }, closed = false, serial = 0, saving = false;
  const listeners = new Set(), requests = new Set();
  const publish = next => { if (!closed) { state = next; for (const fn of listeners) fn(); } };
  const call = async (method, args) => {
    if (closed) throw new Error('插件已停用');
    const abort = new AbortController(); requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const result = await connection.rpc.call('/api', endpoint + '/' + method, { args }, abort.signal);
      if (!result.ok) throw Object.assign(new Error(result.error?.message || result.error?.code || '请求失败'), { code: result.error?.code });
      return result.value;
    } finally { clearTimeout(timeout); requests.delete(abort); }
  };
  const accept = value => publish({ ...value, status: 'ready', writable: connection.isLoopback !== false, requestError: '' });
  const scope = {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async reload() {
      const sequence = ++serial;
      try { const value = await call('getConfig', {}); if (sequence === serial) accept(value); return value; }
      catch (error) { if (sequence === serial) publish({ ...state, requestError: error.message }); throw error; }
    },
    async update(value, revision = state.revision) {
      if (saving) throw new Error('正在保存，请稍候');
      saving = true; ++serial;
      try { const result = await call('setConfig', { value, revision }); accept(result); return result; }
      finally { saving = false; }
    },
    set(key, value) { return scope.update({ ...state.value, [key]: value }); },
    call,
    async runAction() { const result = await call('runAction', {}); accept(result); return result; },
    close() { closed = true; ++serial; for (const abort of requests) abort.abort(); listeners.clear(); },
  };
  return scope;
}
function useFileConfig(scope) {
  return React.useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot);
}
const configValue=(value,key)=>key.split('.').reduce((current,part)=>current?.[part],value);
const configChange=(value,key,next)=>{
  const [head,...tail]=key.split('.');
  return {...value,[head]:tail.length?configChange(value[head],tail.join('.'),next):next};
};
function ModelPicker({ scope, kind='chat', provider, model, disabled, label, onChange }) {
  const e=React.createElement, [catalog,setCatalog]=React.useState({groups:[]}), [error,setError]=React.useState('');
  React.useEffect(()=>{
    let active=true,sequence=0;
    const load=()=>{const current=++sequence;scope.call('modelCatalog',{kind}).then(value=>{if(active&&current===sequence){setCatalog(value);setError('');}}).catch(failure=>{if(active&&current===sequence)setError(failure.message);});};
    load();window.addEventListener('focus',load);return()=>{active=false;window.removeEventListener('focus',load);};
  },[scope,kind]);
  const encode=(provider,model)=>JSON.stringify([provider,model]),value=encode(provider||'',model||'');
  const known=catalog.groups.some(group=>group.models.some(entry=>group.id===provider&&entry.id===model));
  return e('div',null,e('select',{'aria-label':label,value,disabled,onChange:event=>{const [provider,model]=JSON.parse(event.target.value);onChange({provider,model});}},
    e('option',{value:encode('','')},kind==='embedding'?'词语检索（不使用向量模型）':'继承 DSH 默认模型'),
    provider&&model&&!known?e('option',{value},`${provider} / ${model}（当前配置）`):null,
    catalog.groups.map(group=>e('optgroup',{key:group.id,label:group.name||group.id},group.models.map(entry=>e('option',{key:entry.id,value:encode(group.id,entry.id)},entry.name||entry.id))))),
    error?e('small',{role:'status'},'模型目录暂不可用：'+error):kind==='embedding'&&!catalog.groups.length?e('small',null,'尚未注册向量模型。'):null);
}
function FileConfigPage({ scope, title, description, fields, actionLabel, credentialApi, credentials, credentialTitle='凭证', credentialsFirst=false }) {
  const e = React.createElement, snapshot = useFileConfig(scope);
  const [editor, setEditor] = React.useState({ base: null, draft: null, error: '', saved: false });
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false), alive = React.useRef(false);
  const dirty = !!editor.base && JSON.stringify(editor.draft) !== JSON.stringify(editor.base.value);
  const external = !!editor.base && snapshot.revision !== editor.base.revision;
  React.useEffect(() => {
    if (snapshot.status !== 'ready') return;
    setEditor(previous => !previous.base || (!busyRef.current && JSON.stringify(previous.draft) === JSON.stringify(previous.base.value))
      ? { base: snapshot, draft: structuredClone(snapshot.value), error: '', saved: previous.saved } : previous);
  }, [snapshot]);
  React.useEffect(() => {
    alive.current = true;
    let reloading = false;
    const reload = () => {
      if (busyRef.current || reloading) return;
      reloading = true;
      void scope.reload().catch(() => {}).finally(() => { reloading = false; });
    };
    reload(); window.addEventListener('focus', reload);
    const interval = actionLabel ? setInterval(() => { if (document.visibilityState !== 'hidden') reload(); }, 2000) : null;
    return () => { alive.current = false; window.removeEventListener('focus', reload); if (interval) clearInterval(interval); };
  }, [scope, actionLabel]);
  const work = async operation => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await operation(); }
    catch (error) { if (alive.current) setEditor(previous => ({ ...previous, error: error.message, errorCode: error.code, saved: false })); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const replace = result => { if (alive.current) setEditor({ base: result, draft: structuredClone(result.value), error: '', saved: false }); };
  const change = (key, value) => setEditor(previous => ({ ...previous, draft: configChange(previous.draft,key,value), error: '', errorCode: '', saved: false }));
  const disabled = busy || !snapshot.writable || !editor.draft;
  const field = spec => {
    const value = configValue(editor.draft,spec.key), id = 'dsh-config-' + spec.key;
    const common = { id, disabled: disabled || spec.disabled, 'aria-label': spec.label };
    let input;
    if (spec.type === 'readonly') input = e('input', { ...common, type: 'text', readOnly: true, value: snapshot.details?.[spec.detail] ?? '', placeholder: spec.placeholder });
    else if (spec.type === 'boolean') input = e(DshSwitch, { label: spec.label, disabled: common.disabled, checked: value, onChange: next => change(spec.key, next) });
    else if (spec.type === 'multiline') input = e('textarea', {...common,rows:5,value,onChange:event=>change(spec.key,event.target.value)});
    else if (spec.type === 'list') input = e('textarea', {...common, rows: Math.max(3,Math.min(8,value.length+1)), value:editor.listText?.[spec.key]??value.join('\n'),
      onChange:event=>{const text=event.target.value;setEditor(previous=>({...previous,draft:configChange(previous.draft,spec.key,text.split(/[\n,]/).map(item=>item.trim()).filter(Boolean)),listText:{...previous.listText,[spec.key]:text},error:'',errorCode:'',saved:false}));} });
    else if (spec.type === 'model') input = e(ModelPicker,{scope,kind:spec.kind,provider:configValue(editor.draft,spec.providerKey),model:value,disabled:common.disabled,label:spec.label,onChange:selection=>setEditor(previous=>({...previous,draft:configChange(configChange(previous.draft,spec.providerKey,selection.provider),spec.key,selection.model),error:'',errorCode:'',saved:false}))});
    else if (spec.type === 'select') input = e('select', { ...common, value, onChange: event => change(spec.key, spec.numeric ? Number(event.target.value) : event.target.value) }, spec.options.map(([key, label]) => e('option', { key, value: key }, label)));
    else if (spec.type === 'order' || spec.type === 'providers') input = e('ol', { className: 'dpc-order' }, value.map((key, index) => e('li', { key },
      e('span', { className: 'dpc-rank', 'aria-hidden': true }, index + 1), e('span', { className: 'dpc-provider-name' }, spec.labels[key] || key),
      spec.type === 'providers' ? e(DshSwitch, { label: '启用 ' + (spec.labels[key] || key), checked: editor.draft.enabledProviders.includes(key), disabled,
        onChange: next => change('enabledProviders', next ? [...editor.draft.enabledProviders, key] : editor.draft.enabledProviders.filter(item => item !== key)) }) : null,
      e('div', { className: 'dpc-order-actions' }, ...[-1, 1].map(delta => e(DshButton, {
        key: delta, type: 'button', disabled: disabled || index + delta < 0 || index + delta >= value.length,
        variant: 'ghost', size: 'sm', className: 'dpc-arrow', title: delta < 0 ? '上移' : '下移',
        'aria-label': (delta < 0 ? '上移 ' : '下移 ') + (spec.labels[key] || key),
        onClick: () => { const next = [...value]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; change(spec.key, next); },
      }, e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
        e('path', { d: delta < 0 ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6' }))))))));
    else if (spec.type === 'choices') input = e('div', null, Object.entries(spec.labels).map(([key, label]) => e('label', { className: 'dpc-choice', key }, e('input', {
      type: 'checkbox', checked: value.includes(key), disabled, onChange: event => change(spec.key, event.target.checked ? [...value, key] : value.filter(x => x !== key)),
    }), ' ', label)));
    else input = e('input', { ...common, type: spec.type === 'number' ? 'number' : 'text', value,
      min: spec.min, max: spec.max, step: spec.step ?? 1,
      onChange: event => change(spec.key, spec.type === 'number' ? Number(event.target.value) : event.target.value),
    });
    return e('div', { className: 'dpc-field dpc-' + spec.type, key: spec.key },
      e('div', { className: 'dpc-label' }, e('label', { htmlFor: spec.type === 'boolean' ? undefined : id }, spec.label), spec.help ? e('small', null, spec.help) : null, spec.emptyHelp&&Array.isArray(value)&&!value.length?e('small',null,spec.emptyHelp):null),
      e('div', { className: 'dpc-control' }, input));
  };
  const visible=spec=>!spec.when||(Array.isArray(spec.when)?spec.when:[spec.when]).some(condition=>Object.entries(condition).every(([key,value])=>configValue(editor.draft,key)===value));
  const grouped=advanced=>{
    const groups=[];
    for(const spec of fields.filter(spec=>!!spec.advanced===advanced&&visible(spec))){
      if(!groups.length||groups.at(-1).title!==(spec.group||''))groups.push({title:spec.group||'',fields:[]});
      groups.at(-1).fields.push(spec);
    }
    return groups.map((group,index)=>e('section',{className:'dpc-group',key:index},group.title?e('h4',null,group.title):null,group.fields.map(field)));
  };
  const credentialView=credentialApi&&credentials&&snapshot.value?e(CredentialsPage,{api:credentialApi,refs:credentials(snapshot.value),writable:snapshot.writable,title:credentialTitle,expanded:credentialsFirst}):null;
  const reloadNeeded = external || snapshot.requestError || editor.errorCode?.includes('conflict');
  return e('form', { className: 'dpc-page', 'aria-label': title, onSubmit: event => { event.preventDefault(); if (disabled || external || (!dirty && !snapshot.error)) return;
    void work(async () => { const result = await scope.update(editor.draft, editor.base.revision); replace(result); if (alive.current) setEditor(previous => ({ ...previous, saved: true })); });
  } },credentialsFirst?credentialView:null,editor.draft?grouped(false):e('p',null,'正在读取配置…'),
    editor.draft&&fields.some(spec=>spec.advanced&&visible(spec))?e('details',{className:'dpc-advanced'},e('summary',null,'高级设置'),grouped(true)):null,
    snapshot.error ? e('p', { role: 'alert' }, '文件有误，运行时保留上一次有效设置。', snapshot.error.message, '；保存可修复文件。') : null,
    external ? e('p', { role: 'alert' }, '配置已被其他页面或文件编辑修改。重新载入后再保存，可避免覆盖外部修改。') : null,
    editor.error || snapshot.requestError ? e('p', { role: 'alert' }, editor.error || snapshot.requestError) : null,
    e('div', { className: 'dpc-actions' }, e(DshButton, { type: 'submit', variant: 'primary', disabled: disabled || external || (!dirty && !snapshot.error) }, busy ? '处理中…' : '保存'),
      reloadNeeded ? e(DshButton, { type: 'button', variant: 'outline', disabled: busy, onClick: () => void work(async () => replace(await scope.reload())) }, dirty ? '放弃草稿并重新载入' : '重新载入') : null,
      actionLabel ? e(DshButton, { type: 'button', variant: 'outline', disabled: busy || !snapshot.writable, onClick: () => void work(async () => { await scope.runAction(); }) }, actionLabel) : null,
      e('span', { role: 'status' }, editor.saved ? '已保存并生效' : dirty ? '尚未保存' : '')),
    snapshot.details ? e('p', { role: 'status' }, snapshot.details.message) : null,
    e('p', { className: 'dpc-note' }, '保存后自动应用，后续操作使用新配置。'),
    snapshot.configFile ? e('details', { className: 'dpc-path' }, e('summary', null, '配置文件'), e('code', null, snapshot.configFile)) : null,
    credentialsFirst?null:credentialView,
  );
}
function CredentialsPage({ api, refs, writable, title, expanded=false }) {
  const e = React.createElement;
  const [status, setStatus] = React.useState({}), [drafts, setDrafts] = React.useState({}), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const alive = React.useRef(false), running = React.useRef(false);
  const identity = JSON.stringify(refs);
  React.useEffect(() => {
    let active = true;
    alive.current = true;
    void api.describe(Object.keys(refs)).then(result => {
      if (!active) return;
      if (!result.ok) throw new Error(result.error?.message || '读取凭证状态失败');
      setStatus(result.value);
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; alive.current = false; };
  }, [api, identity]);
  const save = async (ref, clear) => {
    if (running.current || !writable) return; running.current = true; setBusy(true); setError('');
    try {
      const result = clear ? await api.unset(ref) : await api.set(ref, drafts[ref]);
      if (!result.ok) throw new Error(result.error?.message || '保存凭证失败');
      if (!alive.current) return;
      setDrafts(previous => ({ ...previous, [ref]: '' }));
      setStatus(previous => ({ ...previous, [ref]: { configured: !clear } }));
    } catch (reason) { if (alive.current) setError(reason.message); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  return e(expanded?'section':'details', { className: 'dpc-credentials' }, e(expanded?'h4':'summary', null, title), e('fieldset', { disabled: busy || !writable },
    e('p', null, '密钥单独保存到 DSH 凭证管理；已有密钥只显示配置状态。'),
    Object.entries(refs).map(([ref, label]) => e('div', { className: 'dpc-field', key: ref }, e('label', null, label, ' · ', ref),
      e('input', { type: 'password', autoComplete: 'new-password', 'aria-label': label + ' 密钥', value: drafts[ref] || '', placeholder: status[ref]?.configured ? '已配置；留空保持' : '未配置',
        onChange: event => setDrafts(previous => ({ ...previous, [ref]: event.target.value })) }),
      e('div', { className: 'dpc-actions' }, e(DshButton, { type: 'button', variant: 'outline', disabled: !drafts[ref], onClick: () => void save(ref, false) }, '保存密钥'),
        e(DshButton, { type: 'button', variant: 'ghost', disabled: !status[ref]?.configured, onClick: () => void save(ref, true) }, '清除密钥')))),
    error ? e('p', { role: 'alert' }, error) : null));
}
function installConfigPage(ctx, options) {
  const scope = createConfigScope(ctx.connection, options.endpoint);
  ctx.effect(() => {
    const refresh = () => { void scope.reload().catch(() => {}); };
    refresh(); window.addEventListener?.('focus', refresh);
    if (typeof document === 'undefined') return () => { window.removeEventListener?.('focus', refresh); scope.close(); };
    const style = document.createElement('style'); style.dataset.pluginConfig = options.packageName;
    style.textContent = `
      .dpc-page{max-width:760px;color:var(--dsw-alias-label-primary);font-size:14px}
      .dpc-page p,.dpc-page small{line-height:1.65;color:var(--dsw-alias-label-secondary)}
      .dpc-page [role=alert]{color:var(--dsw-alias-state-error-primary,#d64545)}
      .dpc-group+.dpc-group{margin-top:28px}.dpc-group h4{margin:0 0 8px;font-size:14px;font-weight:600}
      .dpc-field{display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,280px);gap:24px;padding:18px 0;border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center}
      .dpc-label label{line-height:22px;font-weight:500}.dpc-label small{display:block;margin-top:4px;font-size:12px}
      .dpc-control{min-width:0}.dpc-boolean .dpc-control{justify-self:end}
      .dpc-field input:not([type=checkbox]),.dpc-field select,.dpc-field textarea{box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit}.dpc-field textarea{resize:vertical;line-height:1.6}
      .dpc-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:24px}
      .dpc-order{margin:0;padding:0;list-style:none;display:grid;gap:4px}.dpc-order li{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
      .dpc-rank{font-size:12px;color:var(--dsw-alias-label-tertiary);width:20px;text-align:center;font-variant-numeric:tabular-nums}.dpc-provider-name{flex:1}.dpc-order-actions{display:flex;gap:2px}.dpc-arrow{min-width:28px;padding:0!important}
      .dpc-providers,.dpc-order{grid-template-columns:1fr;gap:12px}.dpc-choice{display:inline-flex;gap:4px;margin:4px 12px 4px 0}
      .dpc-note{font-size:12px}.dpc-path{overflow-wrap:anywhere;margin-top:16px;color:var(--dsw-alias-label-tertiary);font-size:12px}.dpc-path code{display:block;margin-top:8px;user-select:text}
      .dpc-credentials{border-top:1px solid var(--dsw-alias-border-l2);margin-top:24px;padding-top:18px}.dpc-credentials fieldset{border:0;padding:0;min-width:0}.dpc-page summary{cursor:pointer;line-height:22px}
      .dpc-credentials:first-child{border-top:0;margin-top:0;padding-top:0;margin-bottom:28px}.dpc-credentials h4{margin:0;font-size:14px;font-weight:600}
      .dpc-advanced{margin-top:28px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}.dpc-advanced>summary{font-weight:500}.dpc-advanced[open]>summary{margin-bottom:20px}
      .dpc-credentials .dpc-field{grid-template-columns:140px minmax(0,1fr) auto;gap:14px}.dpc-credentials .dpc-actions{margin:0}
      .dpc-page :is(select,input,textarea):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:3px}
      [data-plugin-detail="${options.packageName}"] [data-plugin-rows]:has(>ul>[data-plugin-row]:only-child):not(:has([data-state=failed],[data-state=off])){display:none}
      @media(max-width:620px){.dpc-field,.dpc-credentials .dpc-field{grid-template-columns:1fr;gap:10px}.dpc-boolean{grid-template-columns:1fr auto;gap:20px}}
    `;
    document.head.appendChild(style);
    return () => { window.removeEventListener?.('focus', refresh); scope.close(); style.remove(); };
  });
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: options.packageName },
    ({ view }) => view === 'summary' ? options.description : React.createElement(React.Fragment, null,
      options.panel ? React.createElement(options.panel, { scope, connection: ctx.connection }) : null,
      React.createElement(FileConfigPage, { ...options, scope }))));
  return scope;
}

// END GENERATED PLUGIN SETTINGS

function PluginPanel({ scope }) {
  const e = React.createElement, snapshot = useFileConfig(scope);
  const [data, setData] = React.useState(null), [editor, setEditor] = React.useState(null), [busy, setBusy] = React.useState(false), [note, setNote] = React.useState(''), [error, setError] = React.useState('');
  const alive = React.useRef(false), lock = React.useRef(false), serial = React.useRef(0);
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ++serial.current; };
  }, []);
  React.useEffect(() => {
    if (snapshot.status !== 'ready') return;
    const sequence = ++serial.current;
    scope.call('getProfiles', {}).then(result => {
      if (!alive.current || sequence !== serial.current) return;
      setData(result);
      setEditor(previous => !previous || JSON.stringify(previous.draft) === JSON.stringify(previous.base.value.profiles)
        ? { base: result, draft: structuredClone(result.value.profiles) } : previous);
    }).catch(failure => { if (alive.current && sequence === serial.current) setError(failure.message); });
  }, [scope, snapshot.revision, snapshot.status]);
  const work = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNote('');
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure.message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  if (!editor) return null;
  const dirty = JSON.stringify(editor.draft) !== JSON.stringify(editor.base.value.profiles), external = editor.base.revision !== snapshot.revision;
  const disabled = busy || !snapshot.writable, change = (index, key, value) => {
    setEditor(previous => ({ ...previous, draft: previous.draft.map((profile, i) => i === index ? { ...profile, ...(typeof key==='object'?key:{[key]:value}) } : profile) }));
    setNote(''); setError('');
  };
  const save = event => {
    event.preventDefault();
    void work(async () => {
      const saved = await scope.update({ ...editor.base.value, profiles: editor.draft }, editor.base.revision);
      const profiles = await scope.call('getProfiles', {});
      if (alive.current) { setData(profiles); setEditor({ base: saved, draft: structuredClone(saved.value.profiles) }); setNote('已保存。默认模型与权限仅用于新会话；指令文件按会话工作区和开关设置加载。'); }
    });
  };
  const input = (profile, index, key, label, help) => e('div', { className: 'dpc-field', key },
    e('div', { className: 'dpc-label' }, e('label', { htmlFor: `dsh-role-${profile.preset}-${key}` }, label), help ? e('small', null, help) : null),
    e('div', { className: 'dpc-control' }, key === 'permission' ? e('select', { id: `dsh-role-${profile.preset}-${key}`, 'aria-label': `${profile.name} ${label}`, value: profile[key], disabled, onChange: event => change(index, key, event.target.value) },
      ...[['', '继承官方权限默认值'], ['workspace-write', '工作区写入 · 操作按原生审批'], ['read-only', '只读 · 操作按原生审批']].map(([value, text]) => e('option', { key: value, value }, text))) :
      e('input', { id: `dsh-role-${profile.preset}-${key}`, 'aria-label': `${profile.name} ${label}`, value: profile[key], disabled, onChange: event => change(index, key, event.target.value) })));
  return e('section', { className: 'dpc-page', 'aria-label': '角色与工作区', style: { marginBottom: 36 } },
    e('h3', null, '角色与工作区'), e('p', null, '角色沿用 DSH 原生工作区、预设和会话机制，默认模型与权限仅对新会话生效。指令文件按当前会话的工作区读取，受上方开关控制，修改后下一次模型调用生效。'),
    e('form', { onSubmit: save }, ...editor.draft.map((profile, index) => {
      const status = data?.profiles.find(value => value.preset === profile.preset);
      return e('details', { key: profile.preset, className: 'dpc-advanced', open: true },
        e('summary', null, `${profile.name} · ${profile.preset}`),
        input(profile, index, 'name', '角色名称', '仅用于界面显示，不会自动写入系统提示词。'), input(profile, index, 'workspace', '工作区目录', '选择已有目录。更换目录保留原会话和文件，新会话使用新目录。'),
        e('div',{className:'dpc-field'},e('div',{className:'dpc-label'},e('label',null,'默认模型')),e('div',{className:'dpc-control'},e(ModelPicker,{scope,provider:profile.modelProvider,model:profile.model,disabled,label:profile.name+' 默认模型',onChange:selection=>change(index,{modelProvider:selection.provider,model:selection.model})}))),input(profile, index, 'permission', '默认权限'),
        e('p', null, status?.error || (status?.registered ? '工作区和预设已登记' : '等待原生工作区或预设登记')),
        e(DshButton, { type: 'button', disabled: disabled || dirty || external || !status?.registered,
          onClick: () => void work(async () => {
            const result = await scope.call('createProfileSession', { preset: profile.preset, revision: editor.base.revision });
            if (alive.current) setNote(`已新建会话 ${result.sessionId}，可在左侧“${status.workspaceTitle || profile.name}”工作区打开。`);
          }) }, '新建会话'),profile.preset!=='agent'?e(DshButton,{type:'button',variant:'ghost',disabled,'aria-label':'删除角色 '+profile.name,onClick:()=>setEditor(previous=>({...previous,draft:previous.draft.filter(row=>row.preset!==profile.preset)}))},'删除角色'):e('small',null,'默认角色'));
    }), e('div', { className: 'dpc-actions' },e(DshButton,{type:'button',variant:'outline',disabled:disabled||editor.draft.length>=32,onClick:()=>setEditor(previous=>({...previous,draft:[...previous.draft,{preset:'role-'+window.crypto.randomUUID(),name:'新角色',workspace:'',modelProvider:'',model:'',permission:''}]}))},'添加角色'), e(DshButton, { type: 'submit', variant: 'primary', disabled: disabled || !dirty || external }, '保存角色设置'))),
    external ? e('p', { role: 'alert' }, '配置已在其他页面或文件中修改，重新进入设置页后继续编辑。') : null,
    error ? e('p', { role: 'alert' }, error) : null, note ? e('p', { role: 'status' }, note) : null);
}

return { inject: ['slots', 'connection'], apply(ctx) { installConfigPage(ctx, { ...{"rowId":"instruction-files-settings","endpoint":"instructionFilesSettings","title":"指令文件与角色","description":"按工作区分别注入身份、性格、规则和记忆；可逐文件开关。","fields":[{"key":"workspacePromptEnabled","label":"工作区提示词增强","type":"boolean","help":"总开关；关闭时保留 DSH 原生身份，不注入插件管理的 Markdown 区块。"},{"key":"identityAsIdentity","label":"IDENTITY.md · harness:identity","type":"boolean","help":"替换 DSH 原生身份区块。"},{"key":"soulEnabled","label":"SOUL.md · harness:soul","type":"boolean","help":"注入性格与表达风格。"},{"key":"agentsEnabled","label":"AGENTS.md · harness:agent","type":"boolean","help":"注入工作区执行规则。"},{"key":"toolsEnabled","label":"TOOLS.md · harness:tools","type":"boolean","help":"注入工具使用说明。"},{"key":"userEnabled","label":"USER.md · harness:user","type":"boolean","help":"注入当前工作区的用户偏好说明。"},{"key":"memoryEnabled","label":"MEMORY.md · harness:memory","type":"boolean","help":"注入允许访问的人工维护记忆。"}],"packageName":"dsh-instruction-files"}, panel: PluginPanel,  }); } };
} });
