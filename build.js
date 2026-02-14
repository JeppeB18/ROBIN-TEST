const fs = require('fs');
const path = require('path');

const dist = 'dist';
fs.mkdirSync(dist, { recursive: true });

['index.html', 'game.html', 'game.js', 'styles.css', 'manifest.json'].forEach(f => {
  fs.copyFileSync(f, path.join(dist, f));
});

fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });
fs.copyFileSync('icons/icon.svg', path.join(dist, 'icons/icon.svg'));

if (fs.existsSync('assets')) {
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.readdirSync('assets').forEach(f => {
    fs.copyFileSync(path.join('assets', f), path.join(dist, 'assets', f));
  });
}
