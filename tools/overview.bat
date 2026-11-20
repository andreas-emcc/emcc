@echo off
rem Generates the project overview (tools\out\project-overview.html) and opens it.
rem Double-click it or run it from any folder. It finds Node.js even if it is not on the PATH.
setlocal

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE=%ProgramFiles%\nodejs\node.exe"
  ) else if exist "%LocalAppData%\Programs\nodejs\node.exe" (
    set "NODE=%LocalAppData%\Programs\nodejs\node.exe"
  ) else (
    echo Node.js was not found. Install it from https://nodejs.org or add it to the PATH.
    pause
    exit /b 1
  )
)

rem Work from the repository root, which is the parent of this tools folder.
pushd "%~dp0.."
"%NODE%" tools\overview.mjs
if errorlevel 1 (
  echo.
  echo The overview could not be generated.
  popd
  pause
  exit /b 1
)
start "" "tools\out\project-overview.html"
popd
endlocal
