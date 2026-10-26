# three.js для Динопарка

`js/vendor/three.dino.min.js` — урезанная сборка three.js r170 (MIT, см. `js/vendor/LICENSE-three.txt`),
только нужные классы (список — `tools/three-entry.js`). Глобальная переменная `THREE`, без CDN.

Пересборка:

```sh
mkdir /tmp/tb && cd /tmp/tb && npm init -y && npm i three@0.170.0 esbuild@0.24
cp <repo>/tools/three-entry.js entry.js
npx esbuild entry.js --bundle --minify --format=iife --global-name=THREE --target=es2017 --legal-comments=none --outfile=three.dino.min.js
cp three.dino.min.js <repo>/js/vendor/
```
