# Local notebook environment

Use the isolated Python environment in `backend/.venv` for notebook exploration.
The setup was verified on Windows with Python 3.14.5. No global packages or
user-level kernels are required.

## Work in VS Code

1. Open the repository root folder in VS Code, not only `backend`.
2. Ensure the recommended **Python** (`ms-python.python`) and **Jupyter**
   (`ms-toolsai.jupyter`) extensions are enabled. Reload the window if needed.
3. Open `backend/membresias.ipynb` and choose **Select Kernel > Select Another
   Kernel... > Python Environments...**, then select
   `backend/.venv/Scripts/python.exe`. If offered, **Python (EvoGym)** is the
   named-kernel alternative for this environment.
4. Run the safe import cell. Its executable should end in
   `backend\\.venv\\Scripts\\python.exe`; it does not read member data.

No separate JupyterLab server is needed. The workspace's
`python.defaultInterpreterPath` provides an initial default only; it does not
override an interpreter already selected in VS Code. Use the notebook kernel
picker explicitly if an existing selection points elsewhere.

## Setup

Run in PowerShell from the repository root. Adjust the base Python path if needed:

```powershell
New-Item -ItemType Directory -Force .cache/jupyter/tmp | Out-Null
$env:TEMP = (Resolve-Path .cache/jupyter/tmp).Path
$env:TMP = $env:TEMP
& C:\Python314\python.exe -m venv backend/.venv
& .\backend\.venv\Scripts\python.exe -m pip --isolated install --index-url https://pypi.org/simple --cache-dir .cache/jupyter/pip -r backend/requirements-notebooks.txt
& .\backend\.venv\Scripts\python.exe -m ipykernel install --sys-prefix --name evogym --display-name "Python (EvoGym)"
& .\backend\.venv\Scripts\python.exe -m pip check
```

Direct interpreter paths avoid PowerShell activation-policy changes. Direct
dependencies are pinned; transitive dependencies are not a full lockfile.
If environment creation fails during `ensurepip`, run the following before
retrying the package-install command:

```powershell
& .\backend\.venv\Scripts\python.exe -m ensurepip --upgrade --default-pip
```

## Optional: open JupyterLab

From the repository root:

```powershell
Set-Location backend
$cache = Join-Path (Split-Path (Get-Location).Path -Parent) '.cache/jupyter'
$env:JUPYTER_CONFIG_DIR = Join-Path $cache 'config'
$env:JUPYTER_DATA_DIR = Join-Path $cache 'data'
$env:JUPYTER_RUNTIME_DIR = Join-Path $cache 'runtime'
$env:IPYTHONDIR = Join-Path $cache 'ipython'
$env:MPLCONFIGDIR = Join-Path $cache 'matplotlib'
& .\.venv\Scripts\python.exe -m jupyterlab
```

Select **Python (EvoGym)** for a notebook. In notebook-capable editors, select
`backend/.venv/Scripts/python.exe` as the interpreter/kernel if the named kernel
is not shown. Editor notebook support must already be installed separately.
Stop JupyterLab with `Ctrl+C` in its terminal and confirm shutdown when prompted.
The kernel registration lives inside the environment; recreate it after moving
the checkout because its interpreter path is absolute.

## Member-data privacy

Keep source workbooks local. Do not commit membership exports, personal records,
or notebook outputs containing member data. Clear outputs before committing
notebooks and inspect the staged diff. The ignore rules cover environment files,
caches and checkpoints, not every possible private data filename.
