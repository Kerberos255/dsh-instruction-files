import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export class ConfigError extends Error { constructor(code, message = code) { super(message); this.name = 'ConfigError'; this.code = code; } }

const MAX_BYTES = 16 * 1024;
const revisionOf = raw => raw === null ? 'missing' : createHash('sha256').update(raw).digest('hex');

/** One file owns the value. A directory watcher survives editor atomic replacement. */
export class ConfigFile {
  constructor(filename, { defaults, validate, watch = true, debounceMs = 150, onError = () => {} } = {}) {
    this.filename = path.resolve(filename);
    this.onError = onError;
    this.closed = false;
    this.defaults = defaults; this.validate = validate; this.value = defaults;
    this.error = null;
    this.listeners = new Set();
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    this.withLock(() => {
      if (!fs.existsSync(this.filename)) this.write(defaults);
    });
    this.reload(true);
    if (watch) {
      this.watcher = fs.watch(path.dirname(this.filename), { persistent: false }, (_event, changed) => {
        if (changed && String(changed).toLowerCase() !== path.basename(this.filename).toLowerCase()) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reload(), debounceMs);
        this.timer.unref();
      });
      this.watcher.on('error', () => {
        this.error = { code: 'config-watch-failed', message: '配置文件监听失败，请重新启用插件' };
        this.onError(this.error); this.notify();
      });
    }
  }
  read() {
    try {
      const fd = fs.openSync(this.filename, 'r');
      try {
        if (fs.fstatSync(fd).size > MAX_BYTES) throw new ConfigError('invalid-config', '配置文件超过 16 KiB');
        return fs.readFileSync(fd);
      } finally { fs.closeSync(fd) }
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  snapshot() {
    return { value: { ...this.value }, revision: this.revision, configFile: this.filename, error: this.error && { ...this.error } };
  }
  reload(strict = false) {
    if (this.closed) return this.snapshot();
    const before = JSON.stringify(this.snapshot());
    try {
      const raw = this.read();
      this.revision = revisionOf(raw);
      if (raw === null) throw new ConfigError('config-missing', '配置文件已删除，继续使用上一次有效值；保存可恢复文件');
      let input;
      try { input = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')) }
      catch { throw new ConfigError('invalid-config', 'JSON 格式错误，继续使用上一次有效值') }
      this.value = this.validate(input);
      this.error = null;
    } catch (error) {
      this.error = { code: error instanceof ConfigError ? error.code : 'config-read-failed', message: error instanceof ConfigError ? error.message : '配置文件读取失败，继续使用上一次有效值' };
      if (strict) throw new ConfigError(this.error.code, this.error.message);
      if (before !== JSON.stringify(this.snapshot())) this.onError(this.error);
    }
    if (before !== JSON.stringify(this.snapshot())) this.notify();
    return this.snapshot();
  }
  save(input, expectedRevision) {
    if (this.closed) throw new ConfigError('config-closed', '插件已停用');
    const value = this.validate(input);
    if (typeof expectedRevision !== 'string') throw new ConfigError('config-conflict', '保存需要当前配置修订号');
    this.withLock(() => {
      if (revisionOf(this.read()) !== expectedRevision) throw new ConfigError('config-conflict', '配置已被其他页面或文件编辑修改，请重新读取后保存');
      this.write(value, expectedRevision);
    });
    return this.reload();
  }
  write(value, expectedRevision) {
    const temporary = this.filename + '.' + randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd) }
      finally { fs.closeSync(fd) }
      // Recheck after preparing the replacement, immediately before its atomic rename.
      if (expectedRevision !== undefined && revisionOf(this.read()) !== expectedRevision) throw new ConfigError('config-conflict', '配置已修改，请重新读取后保存');
      fs.renameSync(temporary, this.filename);
    } finally {
      try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  withLock(operation) {
    const filename = this.filename + '.lock';
    let fd;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { fd = fs.openSync(filename, 'wx', 0o600); break }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // A crashed writer can leave its lock. Never evict a live or unreadable owner.
        let raw, owner;
        try { raw = fs.readFileSync(filename, 'utf8'); owner = JSON.parse(raw) } catch { break }
        if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) break;
        try { process.kill(owner.pid, 0); break }
        catch (failure) { if (failure.code !== 'ESRCH') break }
        try { if (fs.readFileSync(filename, 'utf8') === raw) fs.unlinkSync(filename) } catch (failure) { if (failure.code !== 'ENOENT') throw failure }
      }
    }
    if (fd === undefined) throw new ConfigError('config-busy', '其他进程正在保存配置，请稍后重试');
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token: randomUUID() })); return operation() }
    finally { fs.closeSync(fd); fs.unlinkSync(filename) }
  }
  subscribe(listener) {
    if (this.closed) throw new ConfigError('config-closed');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() { for (const listener of this.listeners) { try { listener(this.snapshot()) } catch (error) { console.warn("[plugin-config] subscriber failed", error.name) } } }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.watcher?.close();
    this.listeners.clear();
  }
}
