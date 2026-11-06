import os
os.chdir(r'C:\Users\uditp\Desktop\Doc_Reader\ufv_rn_poc')
with open(r'src\screens\HomeScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

checks = [
    ('No setPreviewMode', 'setPreviewMode' not in content),
    ('Storage real data (freeBytes)', 'storageUsage.freeBytes' in content),
    ('Legend real data (usedBytes*0.55)', 'usedBytes*0.55' in content),
    ('Continue real pos', 'effectiveContinueFile.pos?.page' in content),
    ('Progress bar inline style', 'effectiveContinueFile?.pos?.page' in content),
    ('No FIGMA_SAMPLE_RECENTS', 'FIGMA_SAMPLE_RECENTS' not in content),
    ('isPopulated from real data', 'isPopulated = displayedRecentFiles.length > 0' in content),
]
for k, v in checks:
    status = 'PASS' if v else 'FAIL'
    print(status + ': ' + k)

