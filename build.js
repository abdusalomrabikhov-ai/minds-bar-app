const esbuild = require('esbuild');
const path = require('path');

async function build() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'public/js/app.js')],
    outfile: path.join(__dirname, 'public/js/app.min.js'),
    minify: true,
    sourcemap: true,
    target: 'es2018',
    logLevel: 'info',
  });

  await esbuild.build({
    entryPoints: [path.join(__dirname, 'public/css/style.css')],
    outfile: path.join(__dirname, 'public/css/style.min.css'),
    minify: true,
    sourcemap: true,
    logLevel: 'info',
  });
}

build().catch(e => { console.error(e); process.exit(1); });
