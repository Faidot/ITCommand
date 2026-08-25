'use strict';

/**
 * configManager
 * --------------
 * Reads and writes the runtime-editable settings.json. Caches the parsed
 * config in memory and emits a `change` event whenever a section is updated so
 * that long-lived services (IMAP pool, SMTP transport) can refresh themselves.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const SETTINGS_PATH = path.join(__dirname, 'settings.json');

class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this._cache = null;
  }

  /** Load (and cache) the settings file. */
  load() {
    if (this._cache) return this._cache;
    try {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      this._cache = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to read settings.json: ${err.message}`);
    }
    return this._cache;
  }

  /** Whole config object. */
  get() {
    return this.load();
  }

  /** A single top-level section, e.g. "imap". */
  getSection(name) {
    return this.load()[name];
  }

  /**
   * Shallow-merge `values` into `section` and persist. Returns the new section.
   */
  update(section, values) {
    const cfg = this.load();
    cfg[section] = { ...(cfg[section] || {}), ...values };
    this._persist(cfg);
    this.emit('change', section, cfg[section]);
    return cfg[section];
  }

  /** Replace the entire config object. */
  replace(cfg) {
    this._persist(cfg);
    this.emit('change', '*', cfg);
    return cfg;
  }

  _persist(cfg) {
    // Write atomically-ish: write then rename to avoid half-written files.
    const tmp = `${SETTINGS_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
    fs.renameSync(tmp, SETTINGS_PATH);
    this._cache = cfg;
  }
}

module.exports = new ConfigManager();
