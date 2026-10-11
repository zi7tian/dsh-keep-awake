// The client only displays and controls host protection. Power assertions
// belong to the host, independently of this page's lifetime or visibility.
window.__ModuleLoader__.load({
  id: '@zi7tian/dsh-keep-awake',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const NS = 'dsh-keep-awake';
    const DICTS = {
      zh: {
        title: '任务亮屏', close: '关闭面板', native: '主机保活',
        idle: '保活待命', active: '主机保活中', requesting: '正在申请保活',
        disabled: '保活已关闭', partial: '部分保活生效', error: '保活失败，稍后自动重试',
        unavailable: '暂时无法获取主机状态', count: '运行任务：{count}',
        nativeHint: '保护运行 DSH 的设备。任务期间关闭网页或进入后台不影响保活，全部任务结束后自动释放。',
        nativeScope: '开关对本次 DSH 进程的所有会话生效，重启后默认开启。',
        nativeEnable: '开启保活', nativeDisable: '关闭保活',
        displayYes: '亮屏请求已持有', displayNo: '亮屏请求未持有',
        sleepYes: '防休眠请求已持有', sleepNo: '防休眠请求未持有',
      },
      en: {
        title: 'Keep awake', close: 'Close panel', native: 'Host protection',
        idle: 'Ready', active: 'Host kept awake', requesting: 'Requesting protection',
        disabled: 'Protection off', partial: 'Partially protected', error: 'Protection failed; retry pending',
        unavailable: 'Host status unavailable', count: 'Running tasks: {count}',
        nativeHint: 'Protects the device running DSH, even with this page closed or hidden. Released when all tasks finish.',
        nativeScope: 'Applies to all sessions in this DSH process. Enabled again after restart.',
        nativeEnable: 'Enable protection', nativeDisable: 'Disable protection',
        displayYes: 'Display request held', displayNo: 'Display request not held',
        sleepYes: 'Sleep request held', sleepNo: 'Sleep request not held',
      },
    };

    async function requestStatus(signal, enabled) {
      const abort = new AbortController();
      const cancel = () => abort.abort();
      if (signal?.aborted) cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 8000);
      try {
        const response = await fetch('/api/keep-awake/native', {
          credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
          ...(enabled === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
          }),
        });
        if (!response.ok) throw Error('Host request failed');
        const value = await response.json();
        if (!['idle', 'active', 'requesting', 'disabled', 'partial', 'error'].includes(value.status)
          || typeof value.enabled !== 'boolean') throw Error('Invalid host status');
        return value;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
      }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, DICTS));
      function Indicator({ t, wide }) {
        const [open, setOpen] = React.useState(false);
        const [native, setNative] = React.useState(null);
        const [nativeBusy, setNativeBusy] = React.useState(false);
        const nativeRequest = React.useRef(0);
        const nativeMutation = React.useRef(false);
        const nativeLife = React.useRef(null);
        React.useEffect(() => {
          const abort = new AbortController();
          nativeLife.current = abort;
          let timer;
          async function refresh() {
            if (nativeMutation.current) {
              timer = setTimeout(refresh, 5000);
              return;
            }
            const revision = ++nativeRequest.current;
            try {
              const value = await requestStatus(abort.signal);
              if (!abort.signal.aborted && revision === nativeRequest.current) setNative(value);
            } catch { if (!abort.signal.aborted && revision === nativeRequest.current) setNative(null); }
            if (!abort.signal.aborted) timer = setTimeout(refresh, 5000);
          }
          void refresh();
          return () => { abort.abort(); clearTimeout(timer); };
        }, []);
        async function toggleNative() {
          if (!native || nativeMutation.current) return;
          nativeMutation.current = true;
          setNativeBusy(true);
          const revision = ++nativeRequest.current;
          try {
            const value = await requestStatus(nativeLife.current?.signal, !native.enabled);
            if (revision === nativeRequest.current) setNative(value);
          } catch { if (!nativeLife.current?.signal.aborted) setNative(null); }
          finally {
            nativeMutation.current = false;
            if (!nativeLife.current?.signal.aborted) setNativeBusy(false);
          }
        }
        const trigger = React.useRef(null);
        const anchor = React.useRef(null);
        const [inlineTarget, setInlineTarget] = React.useState(null);
        const panel = React.useRef(null);
        const [position, setPosition] = React.useState({ left: 12, bottom: 60 });
        const panelId = React.useId();
        React.useLayoutEffect(() => {
          if (!wide) { setInlineTarget(null); return; }
          // DSH 0.2's footer slot is a separate row. Keep its lifecycle seat,
          // but portal our own node into the settings row's flexible space.
          // Match CSS-module role suffixes, never translated labels or hashes.
          const footer = anchor.current?.closest('[class$="_footArea"], [class*="_footArea "]');
          if (!footer) return;
          const mount = document.createElement('span');
          mount.dataset.dshKeepAwakeInline = '';
          Object.assign(mount.style, { display: 'inline-flex', flex: '0 0 32px', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' });
          const sync = () => {
            const row = footer.querySelector('[class$="_triggerRow"], [class*="_triggerRow "]');
            if (!row) { mount.remove(); setInlineTarget(null); return; }
            if (mount.parentElement !== row) {
              row.insertBefore(mount, row.children[1] || null);
              setInlineTarget(mount);
            }
          };
          sync();
          const observer = new MutationObserver(sync);
          observer.observe(footer, { childList: true, subtree: true });
          return () => { observer.disconnect(); mount.remove(); setInlineTarget(null); };
        }, [wide]);
        React.useEffect(() => {
          if (!open) return;
          const place = () => {
            const rect = trigger.current?.getBoundingClientRect();
            if (rect) setPosition({
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
              bottom: Math.max(8, window.innerHeight - rect.top + 8),
            });
          };
          const dismiss = event => {
            if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
          };
          const escape = event => {
            if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
          };
          place();
          panel.current?.querySelector('button')?.focus();
          document.addEventListener('pointerdown', dismiss);
          document.addEventListener('keydown', escape);
          window.addEventListener('resize', place);
          return () => {
            document.removeEventListener('pointerdown', dismiss);
            document.removeEventListener('keydown', escape);
            window.removeEventListener('resize', place);
          };
        }, [open, wide]);
        const buttonStyle = {
          color: 'inherit', font: 'inherit', cursor: 'pointer', background: 'transparent',
          border: '1px solid var(--dsw-line, currentColor)', borderRadius: '6px', padding: '3px 8px',
        };
        const icon = React.createElement('button', {
            ref: trigger, type: 'button', title: t('title') + ' · ' + t(native?.status || 'unavailable'),
            style: { ...buttonStyle, border: 'none', width: '32px', height: '32px', padding: 0, fontSize: '20px', position: 'relative',
              color: 'var(--dsw-alias-label-primary)', background: open ? 'var(--dsw-specific-menu)' : 'transparent' },
            'aria-label': t('title') + ' · ' + t(native?.status || 'unavailable'), 'aria-haspopup': 'dialog', 'aria-controls': open ? panelId : undefined,
            'aria-expanded': open, onClick: () => setOpen(!open),
          }, React.createElement('span', { 'aria-hidden': true }, '☀'),
            native?.display && React.createElement('span', { 'aria-hidden': true, style: {
              position: 'absolute', right: '2px', top: '2px', width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor',
            } }));
        return React.createElement(React.Fragment, null,
          React.createElement('span', { ref: anchor, style: { display: 'none' }, 'aria-hidden': true }),
          inlineTarget ? ReactDOM.createPortal(icon, inlineTarget) : icon,
          open && ReactDOM.createPortal(React.createElement('div', {
            ref: panel, id: panelId, role: 'dialog', 'aria-label': t('title'), style: {
              opacity: 0.92,
              position: 'fixed', ...position, zIndex: 1000, width: '320px', maxWidth: 'calc(100vw - 16px)',
              maxHeight: 'calc(100dvh - 80px)', overflowY: 'auto', boxSizing: 'border-box', padding: '14px', lineHeight: 1.6,
              fontSize: '12px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-specific-menu)',
              border: '1px solid var(--dsw-line)', borderRadius: 'var(--dsw-radius-lg, 12px)', boxShadow: 'var(--dsw-elevation-prominent)',
            },
          },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('strong', null, t('title')),
              React.createElement('button', { type: 'button', style: buttonStyle, 'aria-label': t('close'), onClick: () => { setOpen(false); trigger.current?.focus(); } }, '×')),
            React.createElement('strong', null, t('native')),
            React.createElement('div', { role: 'status' }, t(native?.status || 'unavailable')),
            native && React.createElement('div', null, t('count', { count: native.count })),
            native && React.createElement('div', null, t(native.display ? 'displayYes' : 'displayNo') + ' · ' + t(native.sleep ? 'sleepYes' : 'sleepNo')),
            native?.error && React.createElement('div', { style: { overflowWrap: 'anywhere' } }, native.error),
            native?.warnings?.length > 0 && React.createElement('div', { style: { overflowWrap: 'anywhere' } }, native.warnings.join('; ')),
            React.createElement('div', null, t('nativeHint')),
            React.createElement('div', null, t('nativeScope')),
            native && React.createElement('button', { type: 'button', style: buttonStyle, disabled: nativeBusy, onClick: toggleNative }, t(native.enabled ? 'nativeDisable' : 'nativeEnable')),
          ), document.body),
        );
      }
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'keep-awake', order: 20, locale: NS }, Indicator,
      ));
    }
    return { inject: ['slots', 'locale'], apply };
  },
});
