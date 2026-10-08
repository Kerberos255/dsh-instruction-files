import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const pages = JSON.parse(fs.readFileSync(path.join(here, 'pages.json'), 'utf8'));
const client = fs.readFileSync(path.join(here, 'settings-client.inc.js'), 'utf8');
const embedded = '// BEGIN GENERATED PLUGIN SETTINGS\n' + client + '\n// END GENERATED PLUGIN SETTINGS\n';
const selected = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(pages).filter(name => name !== 'dsh-model-discovery');
for (const name of selected) if (!Object.hasOwn(pages, name)) throw new Error('Unknown plugin: ' + name);
for (const [name, page] of Object.entries(pages)) {
  if (selected.length && !selected.includes(name)) continue;
  const directory = root, lib = name === 'dsh-web-search-router' ? path.join(directory, 'lib') : directory;
  const filename = path.join(lib, 'client.js'), options = { ...page, packageName: name };
  const panelPath=path.join(directory,'client-panel.inc.js'), panel=fs.existsSync(panelPath)?fs.readFileSync(panelPath,'utf8'):'';
  if (page.standalone || name === 'dsh-web-search-router' || name === 'dsh-model-discovery' || name === 'dsh-instruction-files') {
    const credentials = name === 'dsh-web-search-router'
      ? ", credentialApi: ctx.remote.credentials, credentials: () => ({ DEEPSEEK_API_KEY: 'DeepSeek', TAVILY_API_KEY: 'Tavily', BRAVE_API_KEY: 'Brave', EXA_API_KEY: 'Exa', FIRECRAWL_API_KEY: 'Firecrawl', PARALLEL_API_KEY: 'Parallel' })" : page.credentialFields ? ", credentialApi: ctx.remote.credentials, credentials: value => Object.fromEntries(Object.entries("+JSON.stringify(page.credentialFields)+").map(([key,label])=>[value[key],label]))" : '';
    fs.writeFileSync(filename, `window.__ModuleLoader__.load({ id: '${name}', factory: require => {\nconst React = require('react');\n${embedded}\n${panel}\nreturn { inject: ['slots', 'connection'${credentials ? ", 'remote', 'remote.credentials'" : ''}], apply(ctx) { installConfigPage(ctx, { ...${JSON.stringify(options)}, ${panel?'panel: PluginPanel, ':''}${credentials.slice(2)} }); } };\n} });\n`);
  } else {
    let source = fs.readFileSync(filename, 'utf8');
    source = source.replace(/\/\/ BEGIN GENERATED PLUGIN SETTINGS[\s\S]*?\/\/ END GENERATED PLUGIN SETTINGS\n/, '');
    source = source.replace(/\/\/ BEGIN GENERATED PLUGIN PANEL[\s\S]*?\/\/ END GENERATED PLUGIN PANEL\n/, '');
    source = source.replace("    const React = require('react')\n", "    const React = require('react')\n" + embedded + (panel ? '// BEGIN GENERATED PLUGIN PANEL\n'+panel+'\n// END GENERATED PLUGIN PANEL\n' : ''));
    source = source.replace(/\/\/ BEGIN GENERATED CONFIG INSTALL[\s\S]*?\/\/ END GENERATED CONFIG INSTALL/, '');
    source = source.replace('    function apply(ctx) {\n', '    function apply(ctx) {\n// BEGIN GENERATED CONFIG INSTALL\n      const scope = installConfigPage(ctx, ' + (panel ? '{ ...'+JSON.stringify(options)+', panel: PluginPanel }' : JSON.stringify(options)) + ')\n// END GENERATED CONFIG INSTALL\n');
    fs.writeFileSync(filename, source);
  }
  const manifestPath = path.join(directory, 'package.json'), manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.description = page.description;
  manifest.exports ??= { '.': './index.js' };
  manifest.exports['./client'] = name === 'dsh-web-search-router' ? './lib/client.js' : './client.js';
  manifest.exports['./package.json'] = './package.json'; manifest.exports['./locale/*.json'] = './locale/*.json';
  manifest.dsh.client ??= { platform: 'web', inject: [] };
  manifest.dsh.client.inject = manifest.dsh.client.inject.filter(id => !['@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-store'].includes(id));
  for (const id of ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-plugin-manager', '@deepseek-ai/dsh-client-ui-primitives']) {
    if (!manifest.dsh.client.inject.includes(id)) manifest.dsh.client.inject.push(id);
    manifest.peerDependencies[id] = '0.2.0-rc.2 || 0.2.1-alpha.1';
  }
  manifest.peerDependencies['@deepseek-ai/dsh-typert-protocol'] = '0.2.0-rc.2 || 0.2.1-alpha.1';
  for (const file of ['locale/', 'config.example.json', ...(name === 'dsh-web-search-router' ? [] : ['config.js', 'plugin-settings/', 'client.js'])]) if (!manifest.files.includes(file)) manifest.files.push(file);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.mkdirSync(path.join(directory, 'locale'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'locale/zh.json'), JSON.stringify({ meta: { title: page.title, description: page.description } }, null, 2) + '\n');
  // DSH discovers the locale directory through the exported English resource.
  fs.writeFileSync(path.join(directory, 'locale/en.json'), JSON.stringify({ meta: { title: page.title, description: page.description } }, null, 2) + '\n');
  try {
    const { schema } = await import(pathToFileURL(path.join(directory, 'config.js')).href);
    fs.writeFileSync(path.join(directory, 'config.example.json'), JSON.stringify(schema.defaults, null, 2) + '\n');
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    console.warn('Config example kept (install DSH peers to rebuild it): ' + name);
  }
}
console.log('Built Chinese metadata and official configuration pages for ' + (selected.length || Object.keys(pages).length) + ' plugins.');
