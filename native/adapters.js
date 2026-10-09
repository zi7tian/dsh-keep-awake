import { closeSync } from 'node:fs';

const WHO = 'DSH Keep Awake';
const WHY = 'DeepSeek Harness task is running';

// Loaded only in an isolated helper. No native code runs in the DSH process.
export function acquireWindows(k) {
  const dll = k.load('kernel32.dll');
  const detailed = k.struct({ LocalizedReasonModule: 'void *', LocalizedReasonId: 'uint32_t', ReasonStringCount: 'uint32_t', ReasonStrings: 'void *' });
  const reasonUnion = k.union({ SimpleReasonString: 'str16', Detailed: detailed });
  const reason = k.struct({ Version: 'uint32_t', Flags: 'uint32_t', Reason: reasonUnion });
  const create = dll.func('__stdcall', 'PowerCreateRequest', 'void *', [k.pointer(reason)]);
  const set = dll.func('int __stdcall PowerSetRequest(void *handle, int type)');
  const clear = dll.func('int __stdcall PowerClearRequest(void *handle, int type)');
  const close = dll.func('int __stdcall CloseHandle(void *handle)');
  const text = new k.Union(reasonUnion);
  text.SimpleReasonString = WHY;
  const handle = create({ Version: 0, Flags: 1, Reason: text });
  if (!handle || BigInt.asIntN(k.sizeof('void *') * 8, k.address(handle)) === -1n) throw Error('PowerCreateRequest failed');
  const held = [];
  try {
    for (const type of [0, 1]) {
      if (!set(handle, type)) throw Error('PowerSetRequest failed');
      held.push(type);
    }
  } catch (error) { for (const type of held) clear(handle, type); close(handle); throw error; }
  return { report: { backend: 'Windows Power Request', display: true, sleep: true },
    release() { for (const type of held) clear(handle, type); close(handle); } };
}

export function acquireMac(k) {
  const cf = k.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const io = k.load('/System/Library/Frameworks/IOKit.framework/IOKit');
  const string = cf.func('void *CFStringCreateWithCString(void *allocator, const char *text, uint32_t encoding)');
  const free = cf.func('void CFRelease(void *value)');
  const create = io.func('int IOPMAssertionCreateWithName(void *type, uint32_t level, void *name, _Out_ uint32_t *id)');
  const release = io.func('int IOPMAssertionRelease(uint32_t id)');
  const ids = [];
  try {
    for (const type of ['PreventUserIdleDisplaySleep', 'PreventUserIdleSystemSleep']) {
      const nameRef = string(null, WHY, 0x08000100);
      const typeRef = string(null, type, 0x08000100);
      try {
        if (!nameRef || !typeRef) throw Error('CFString allocation failed');
        const id = [0];
        if (create(typeRef, 255, nameRef, id) !== 0) throw Error('IOPM assertion refused');
        ids.push(id[0]);
      } finally { if (nameRef) free(nameRef); if (typeRef) free(typeRef); }
    }
  } catch (error) { for (const id of ids) release(id); throw error; }
  return { report: { backend: 'macOS IOKit', display: true, sleep: true }, release() { for (const id of ids) release(id); } };
}

export function acquireLinux(k) {
  const dbus = k.load('libdbus-1.so.3');
  const connect = dbus.func('void *dbus_bus_get_private(int type, void *error)');
  const exitOnDisconnect = dbus.func('void dbus_connection_set_exit_on_disconnect(void *bus, int enabled)');
  const close = dbus.func('void dbus_connection_close(void *bus)');
  const unref = dbus.func('void dbus_connection_unref(void *bus)');
  const newMessage = dbus.func('void *dbus_message_new_method_call(const char *dest, const char *path, const char *iface, const char *method)');
  const append = dbus.func('int dbus_message_append_args(void *message, int firstType, ...)');
  const send = dbus.func('void *dbus_connection_send_with_reply_and_block(void *bus, void *message, int timeout, void *error)');
  const read = dbus.func('int dbus_message_get_args(void *message, void *error, int firstType, ...)');
  const free = dbus.func('void dbus_message_unref(void *message)');
  const buses = [], releases = [], checks = [], warnings = [];
  const open = type => {
    const bus = connect(type, null);
    if (!bus) throw Error(type === 0 ? 'Session D-Bus unavailable' : 'System D-Bus unavailable');
    exitOnDisconnect(bus, 0); buses.push(bus); return bus;
  };
  function call(bus, dest, path, iface, method, args = [], output) {
    const message = newMessage(dest, path, iface, method);
    if (!message) throw Error('D-Bus message allocation failed');
    let reply;
    try {
      if (args.length) {
        const values = [];
        for (const [type, value] of args) values.push('int', type.charCodeAt(0), type === 's' ? 'str *' : 'uint32_t *', [value]);
        // The first type is a fixed parameter; every remaining vararg has an explicit C type.
        if (!append(message, values[1], ...values.slice(2), 'int', 0)) throw Error('D-Bus argument encoding failed');
      }
      // No ALLOW_INTERACTIVE_AUTHORIZATION flag: never trigger a privilege prompt.
      reply = send(bus, message, 2000, null);
      if (!reply) throw Error(`${iface}.${method} unavailable or denied`);
      if (!output) return;
      const result = [output === 's' ? null : 0];
      const type = output === 's' ? 'str' : output === 'h' ? 'int' : 'uint32_t';
      if (!read(reply, null, output.charCodeAt(0), k.out(k.pointer(type)), result, 'int', 0)) throw Error('Unexpected D-Bus reply');
      return result[0];
    } finally { if (reply) free(reply); free(message); }
  }
  function trackOwner(bus, destination) {
    const owner = () => call(bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetNameOwner', [['s', destination]], 's');
    const initial = owner();
    checks.push(() => { if (owner() !== initial) throw Error('Inhibitor service restarted'); });
  }
  let display = false, sleep = false;
  try {
    const bus = open(0);
    for (const path of ['/org/freedesktop/ScreenSaver', '/ScreenSaver']) {
      try {
        const dest = 'org.freedesktop.ScreenSaver';
        const cookie = call(bus, dest, path, dest, 'Inhibit', [['s', WHO], ['s', WHY]], 'u');
        releases.push(() => call(bus, dest, path, dest, 'UnInhibit', [['u', cookie]]));
        trackOwner(bus, dest); display = true; break;
      } catch (error) { if (path === '/ScreenSaver') warnings.push(error.message); }
    }
  } catch (error) { warnings.push(error.message); }
  try {
    const bus = open(1);
    const fd = call(bus, 'org.freedesktop.login1', '/org/freedesktop/login1', 'org.freedesktop.login1.Manager', 'Inhibit',
      [['s', 'sleep:idle'], ['s', WHO], ['s', WHY], ['s', 'block']], 'h');
    // libdbus duplicates returned UNIX_FDs; this descriptor belongs to us.
    releases.push(() => closeSync(fd));
    trackOwner(bus, 'org.freedesktop.login1'); sleep = true;
  } catch (error) { warnings.push(error.message); }
  const release = () => {
    for (const cleanup of releases.reverse()) { try { cleanup(); } catch {} }
    for (const bus of buses) { close(bus); unref(bus); }
  };
  if (!display && !sleep) { release(); throw Error(warnings.join('; ')); }
  return { report: { backend: 'Linux D-Bus', display, sleep, warnings }, release, check() { for (const check of checks) check(); } };
}

export async function acquire(platform = process.platform) {
  const { default: koffi } = await import('koffi');
  if (platform === 'win32') return acquireWindows(koffi);
  if (platform === 'darwin') return acquireMac(koffi);
  if (platform === 'linux') return acquireLinux(koffi);
  throw Error(`Native keep-awake is unsupported on ${platform}`);
}
