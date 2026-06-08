param(
  [Parameter(Mandatory=$true)]
  [string]$RepoUrl,

  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".git")) {
  git init
}

git branch -M $Branch
git add .

try {
  git commit -m "Initial commit: Hermes Router CLI"
} catch {
  Write-Host "No new changes to commit, continuing..."
}

try {
  git remote get-url origin | Out-Null
  git remote set-url origin $RepoUrl
} catch {
  git remote add origin $RepoUrl
}

git push -u origin $Branch
