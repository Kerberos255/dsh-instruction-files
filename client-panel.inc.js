function PluginPanel({ scope }) {
  const e = React.createElement, snapshot = useFileConfig(scope);
  const [data, setData] = React.useState(null), [editor, setEditor] = React.useState(null), [busy, setBusy] = React.useState(false), [note, setNote] = React.useState(''), [error, setError] = React.useState('');
  const [summary, setSummary] = React.useState(null);
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
    scope.call('getInstructionSummary', {}).then(result => { if (alive.current) setSummary(result); }).catch(() => {});
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
    e('section', { 'aria-label': '指令注入摘要', style: { marginBottom: 36 } },
      e('h3', null, '指令注入摘要'),
      e('p', null, summary?.enabled === false
        ? '总开关已关闭，当前不注入任何工作区 Markdown。'
        : '最近一次装配各工作区实际注入的指令文件与字节数（按注入内容计，去掉尾部空白）；只检查已开启的项，未开启的文件缺失不算问题。只记录文件名和大小，不含文件内容。'),
      !summary ? e('p', null, '读取中…') : summary.entries.length === 0
        ? e('p', null, '还没有装配记录：打开一个会话并发送一次消息后即可看到。')
        : summary.entries.map(entry => e('details', { key: entry.cwd, className: 'dpc-advanced', open: true },
          e('summary', null, `${entry.cwd} · 注入 ${entry.files.length} 个文件 · ${entry.used} B / ${entry.budget} B`),
          entry.files.length ? e('ul', null, ...entry.files.map(file => e('li', { key: file.name }, `${file.name} → ${file.section} · ${file.bytes} B`))) : e('p', null, '没有注入任何受管文件。'),
          entry.identity ? e('p', null, `IDENTITY.md：${entry.identity.injected ? '已注入' : '未注入（' + entry.identity.reason + '）'} · ${entry.identity.bytes} B`) : e('p', null, 'IDENTITY.md：未找到。'),
          entry.projectBytes ? e('p', null, `项目子目录文件：${entry.projectBytes} B`) : null,
          entry.skipped.length ? e('p', { role: 'alert' }, '跳过：' + entry.skipped.map(file => `${file.name}（${file.reason}，${file.bytes} B）`).join('、')) : null,
          entry.missing.length ? e('p', { role: 'alert' }, '缺失（已开启但文件不存在）：' + entry.missing.join('、')) : null,
          entry.optionalMissing?.length ? e('p', null, '可选文件缺失（不影响注入）：' + entry.optionalMissing.join('、')) : null,
          e('p', null, '最近一次装配：' + new Date(entry.at).toLocaleString() + (entry.preset ? ' · 预设 ' + entry.preset : '')),
        ))),
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
