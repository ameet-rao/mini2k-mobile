@echo off
rem Starts the editable version of the game (src folder) in your browser.
cd /d "%~dp0"
start "" http://localhost:8000/src/index.html
py -m http.server 8000
