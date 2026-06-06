@echo off
copy scripts\parser.js             tests\parser.mjs
copy scripts\sanitize.js           tests\sanitize.mjs
copy scripts\alarms.js             tests\alarms.mjs
copy scripts\storage.js            tests\storage.mjs
copy scripts\quick-capture-core.js tests\quick-capture-core.mjs
powershell -Command "(Get-Content tests\quick-capture-core.mjs) -replace \"from './parser.js'\", \"from './parser.mjs'\" | Set-Content tests\quick-capture-core.mjs"
copy scripts\utils.js              tests\utils.mjs
copy scripts\editor-url.js    tests\editor-url.mjs
copy scripts\editor-pattern.js tests\editor-pattern.mjs
copy scripts\editor-block-analyzer.js tests\editor-block-analyzer.mjs
copy scripts\editor-selection.js tests\editor-selection.mjs
rem UWAGA: tests\tags.mjs NIE kopiować z scripts/tags.js
rem        Ma własne mocki (saveTags noop + fix ID) — patrz tests\tags.mjs
echo Sync done.
