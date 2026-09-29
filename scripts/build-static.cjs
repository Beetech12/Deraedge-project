const { readdir, mkdir, copyFile } = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');

async function build() {
  await mkdir(output, { recursive: true });
  await copyFile(path.join(root, 'index.html'), path.join(output, 'index.html'));
  // Explicit public directories/extensions; never copy .env, server, tests or data.
  const folders = {
    'deraedge-enroll': ['.html'], 'deraedege-academy': ['.html'],
    'deraedge-firm': ['.html'], 'deraedge-contact': ['.html'], 'deraedge-partnership': ['.html'],
    js: ['.js'], css: ['.css'], components: ['.html'], asset: ['.png', '.jpg', '.mp4'],
  };
  for (const [folder, extensions] of Object.entries(folders)) {
    await mkdir(path.join(output, folder), { recursive: true });
    for (const file of await readdir(path.join(root, folder), { withFileTypes: true })) {
      if (!file.isFile() || !/^[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(file.name) || !extensions.includes(path.extname(file.name))) continue;
      await copyFile(path.join(root, folder, file.name), path.join(output, folder, file.name));
    }
  }
  console.log('Public website built; private server files and environment files excluded.');
}
if (require.main === module) build().catch(() => { console.error('Website build failed.'); process.exitCode = 1; });
module.exports = { build };
