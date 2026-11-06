import os
os.chdir(r'C:\Users\uditp\Desktop\Doc_Reader\ufv_rn_poc')

filepath = r'src\screens\HomeScreen.tsx'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

fixes = []

# Fix progress bar fill: change from style={styles.continueProgressLineFill}
# to inline style that can use real data
old_fill = '<View style={styles.continueProgressLineFill} />'
new_fill = '<View style={[styles.continueProgressLineFill, { width: effectiveContinueFile?.pos?.page && effectiveContinueFile?.pos?.total ? `${Math.round((effectiveContinueFile.pos.page / effectiveContinueFile.pos.total) * 100)}%` : \'25%\' }]} />'

if old_fill in content:
    content = content.replace(old_fill, new_fill)
    fixes.append('Fix 5: progress bar real width (inline style)')
else:
    fixes.append('Fix 5 SKIPPED: not found - checking...')
    idx = content.find('continueProgressLineFill} />')
    fixes.append(f'  found at: {idx}')

# Also remove width from the StyleSheet to avoid conflict
old_style_w = "    width: '28%',\n    backgroundColor: '#016EEF',"
new_style_w = "    backgroundColor: '#016EEF',"
if old_style_w in content:
    content = content.replace(old_style_w, new_style_w)
    fixes.append('Fix 5b: removed hardcoded width from stylesheet')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

for f in fixes:
    print(f)
print('Done')

